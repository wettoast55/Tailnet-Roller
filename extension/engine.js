/**
 * Search state machine. The adapter supplies page reads, clicks, and notifications.
 * Time is injected so tests can exercise delayed responses without real waiting.
 *
 * A run checks current names, waits for the configured delay, clicks once, and
 * waits for a different stable set. A match always stops the run before a click.
 */
(function registerEngine(root) {
  "use strict";

  class RollerEngine {
    constructor(adapter, rules, options = {}) {
      this.adapter = adapter;
      this.rules = rules;
      this.clock = options.now || Date.now;
      this.settleDelayMs = options.settle ?? 1000;
      this.responseTimeoutMs = options.timeout ?? 30000;

      // Rejections survive opening/closing the popup and starting another run.
      // A page refresh creates a new engine and clears the rejected names.
      this.skippedNames = new Set();
      this.state = this.createState("idle", false);
      this.state.message = "Check the current names, then start rolling.";
    }

    /** Counters and results reset for each run; skippedNames belongs to the tab. */
    createState(phase, running) {
      return {
        phase,
        running,
        message: "Checking current names.",
        rolls: 0,
        checked: 0,
        candidates: [],
        matches: [],
        history: []
      };
    }

    /** Return serializable data for the popup, without exposing page elements. */
    getState() {
      const secondsUntilRoll = this.state.running && this.nextRollAt
        ? Math.max(0, Math.ceil((this.nextRollAt - this.clock()) / 1000))
        : 0;

      return {
        ...this.state,
        skippedCount: this.skippedNames.size,
        nextIn: secondsUntilRoll
      };
    }

    /** Cancel future clicks while keeping the current results available to inspect. */
    stop(phase, message) {
      this.state.running = false;
      this.state.phase = phase;
      this.state.message = message;
      this.nextRollAt = 0;
      this.adapter.stopped?.(this.getState());
      return this.getState();
    }

    /** Manual stops use a reusable paused state instead of discarding the engine. */
    pause(message = "Paused. Current options have been preserved.") {
      return this.stop("paused", message);
    }

    /** Reject only the matches already shown, then start a fresh roll budget. */
    skipAndContinue(input = this.config) {
      if (this.state.running || this.state.matches.length === 0) {
        throw new Error("Find a match before choosing to skip it.");
      }

      // Bad settings must not silently record rejections or discard a result.
      this.rules.compile(input);
      const previousOptionCount = this.expectedCount;

      for (const name of this.state.matches) {
        this.skippedNames.add(name.toLowerCase());
      }

      this.begin(input, true);

      // A match can appear halfway through a page update. Preserve the known
      // full list size so continuing cannot roll past an incomplete list.
      if (this.state.running) {
        this.expectedCount = Math.max(previousOptionCount || 0, this.expectedCount);
      }

      return this.getState();
    }

    /** Evaluate all currently readable choices. Returns true when a match stops us. */
    scan(snapshot) {
      this.state.candidates = snapshot.names.map(name => {
        const decision = this.rules.evaluate(name, this.config);
        if (this.skippedNames.has(name.toLowerCase())) {
          return {
            ...decision,
            match: false,
            skipped: true,
            why: "Skipped for this tab session"
          };
        }
        return decision;
      });

      this.state.matches = this.state.candidates
        .filter(candidate => candidate.match)
        .map(candidate => candidate.name);

      // Sorting makes a reordered list count as the same set of names.
      const signature = [...snapshot.names].sort().join("|");
      if (signature !== this.optionSignature) {
        this.optionSignature = signature;
        this.stableSince = this.clock();
        this.state.checked += this.state.candidates.length;
        this.state.history.unshift({ names: [...snapshot.names], at: this.clock() });
        this.state.history = this.state.history.slice(0, 8);
      }

      if (this.state.matches.length > 0) {
        this.stop(
          "matched",
          "Match found. Select it on Tailscale, or use the main button to skip it and keep rolling."
        );
        this.adapter.matched?.(this.getState(), snapshot, this.config.notify);
        return true;
      }

      return false;
    }

    /** Start a run, or inspect once when shouldRoll is false. */
    begin(input, shouldRoll) {
      this.pause();
      this.config = this.rules.compile(input);
      this.adapter.clear?.();
      this.state = this.createState(shouldRoll ? "checking" : "preview", shouldRoll);
      this.optionSignature = "";
      this.pendingRoll = null;
      this.unreadySince = null;

      if (!this.adapter.allowed()) {
        return this.stop("error", "Use Tailnet Roller on the Tailscale DNS page.");
      }

      const snapshot = this.adapter.snapshot();
      if (!snapshot.ok) {
        return this.stop("error", snapshot.error);
      }

      this.expectedCount = snapshot.names.length;
      if (this.scan(snapshot)) {
        return this.getState();
      }

      this.nextRollAt = shouldRoll ? this.clock() + this.config.interval * 1000 : 0;
      this.state.phase = shouldRoll ? "countdown" : "preview";
      this.state.message = shouldRoll
        ? "No match yet. Names are checked again before every roll."
        : "Current names checked. No rolls were sent.";
      this.adapter.started?.(this.getState());
      return this.getState();
    }

    /** Return true while the button is busy or the list has the wrong size. */
    waitForCompleteOptions(snapshot, now) {
      if (!snapshot.disabled && snapshot.names.length === this.expectedCount) {
        this.unreadySince = null;
        return false;
      }

      if (this.unreadySince === null) this.unreadySince = now;
      this.state.phase = "waiting";
      this.state.message = "Waiting for the complete options list.";

      if (now - this.unreadySince >= this.responseTimeoutMs) {
        this.stop("error", "The options are incomplete or the button is unavailable.");
      }

      return true;
    }

    /** Require a changed, stable set before sending another click. */
    waitForRollResponse(now) {
      if (!this.pendingRoll) return false;

      if (this.optionSignature === this.pendingRoll.before) {
        this.state.phase = "waiting";
        this.state.message = "Waiting for Tailscale to return new options.";

        if (now - this.pendingRoll.at >= this.responseTimeoutMs) {
          this.stop("error", "Names did not change. Check Tailscale for an error or rate limit.");
        }
        return true;
      }

      if (now - this.stableSince < this.settleDelayMs) return true;

      this.pendingRoll = null;
      return false;
    }

    /** Re-read immediately before clicking so an incoming match is not discarded. */
    rollIfReady(now) {
      if (now < this.nextRollAt || now - this.stableSince < this.settleDelayMs) return;

      const freshSnapshot = this.adapter.snapshot();
      if (!freshSnapshot.ok) {
        this.stop("error", freshSnapshot.error);
        return;
      }

      const previousSignature = this.optionSignature;
      if (this.scan(freshSnapshot)) return;

      if (freshSnapshot.disabled
          || freshSnapshot.names.length !== this.expectedCount
          || previousSignature !== this.optionSignature) {
        return;
      }

      // Record the pending response before clicking; page listeners can run
      // synchronously during click(), and must not cause a second click.
      this.pendingRoll = { before: this.optionSignature, at: now };
      this.nextRollAt = now + this.config.interval * 1000;
      this.state.rolls++;
      this.state.phase = "waiting";
      this.state.message = "Rolled once. Waiting for the new names.";
      this.adapter.click(freshSnapshot);
    }

    /** One safe polling step. The page controller calls this after timers and edits. */
    tick() {
      if (!this.state.running || this.isTicking) return;
      this.isTicking = true;

      try {
        if (!this.adapter.allowed()) {
          this.stop("error", "Page changed. Rolling stopped.");
          return;
        }

        const now = this.clock();
        const snapshot = this.adapter.snapshot();

        if (!snapshot.ok) {
          if (!this.pendingRoll) {
            this.stop("error", snapshot.error);
          } else if (now - this.pendingRoll.at >= this.responseTimeoutMs) {
            this.stop("error", "New options did not load. No further click was sent.");
          }
          return;
        }

        // Even a partly loaded set can reveal a match. Stop before waiting.
        if (this.scan(snapshot)) return;
        if (this.waitForCompleteOptions(snapshot, now)) return;
        if (this.waitForRollResponse(now)) return;

        // Check final results before enforcing the limit, so the last roll counts.
        if (this.state.rolls >= this.config.maxRolls) {
          this.stop("limit", "Roll limit reached. Current names have been checked and preserved.");
          return;
        }

        this.state.phase = "countdown";
        this.state.message = "No match yet. Names are checked again before every roll.";
        this.rollIfReady(now);
      } catch (error) {
        this.stop("error", `Stopped: ${error.message}`);
      } finally {
        this.isTicking = false;
      }
    }
  }

  root.TailnetEngine = RollerEngine;

  if (typeof module !== "undefined") {
    module.exports = RollerEngine;
  }
})(globalThis);
