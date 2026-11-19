(function (root) {
  "use strict";
  class Engine {
    constructor(adapter, rules, options = {}) {
      this.adapter = adapter;
      this.rules = rules;
      this.now = options.now || Date.now;
      this.settle = options.settle ?? 1000;
      this.timeout = options.timeout ?? 30000;
      this.skipped = new Set();
      this.state = {phase:"idle", running:false, message:"Check the current names, then start your search.", rolls:0, checked:0, candidates:[], matches:[], history:[]};
    }
    getState() { return {...this.state, skippedCount:this.skipped.size, nextIn: this.state.running && this.nextAt ? Math.max(0, Math.ceil((this.nextAt - this.now()) / 1000)) : 0}; }
    stop(phase, message) {
      this.state.running = false;
      this.state.phase = phase;
      this.state.message = message;
      this.nextAt = 0;
      this.adapter.stopped?.(this.getState());
      return this.getState();
    }
    pause(message = "Paused. Current options have been preserved.") { return this.stop("paused", message); }
    skipAndContinue(input = this.config) {
      if (this.state.running || !this.state.matches.length) throw new Error("Find a match before choosing Skip & continue.");
      // Validate before recording the rejection. Only previously shown matches
      // are skipped; a new, unseen match on the page must still stop the search.
      this.rules.compile(input);
      const previousCount = this.expectedCount;
      for (const name of this.state.matches) this.skipped.add(name.toLowerCase());
      const result = this.begin(input, true);
      if (this.state.running) this.expectedCount = Math.max(previousCount || 0, this.expectedCount);
      return result;
    }
    scan(snapshot) {
      const candidates = snapshot.names.map(name => {
        const result = this.rules.evaluate(name, this.config);
        return this.skipped.has(name.toLowerCase()) ? {...result, match:false, skipped:true, why:"Skipped for this tab session"} : result;
      });
      this.state.candidates = candidates;
      this.state.matches = candidates.filter(c => c.match).map(c => c.name);
      const fingerprint = [...snapshot.names].sort().join("|");
      if (fingerprint !== this.fingerprint) {
        this.fingerprint = fingerprint;
        this.stableSince = this.now();
        this.state.checked += candidates.length;
        this.state.history.unshift({names:[...snapshot.names], at:this.now()});
        this.state.history = this.state.history.slice(0, 8);
      }
      if (this.state.matches.length) {
        this.stop("matched", "Match found. Select it on Tailscale, or choose Skip & continue to keep searching.");
        this.adapter.matched?.(this.getState(), snapshot, this.config.notify);
        return true;
      }
      return false;
    }
    begin(input, run) {
      this.pause();
      this.config = this.rules.compile(input);
      this.adapter.clear?.();
      this.state = {phase:run ? "checking" : "preview", running:run, message:"Checking current names…", rolls:0, checked:0, candidates:[], matches:[], history:[]};
      this.fingerprint = "";
      this.pending = null;
      this.unreadySince = null;
      if (!this.adapter.allowed()) return this.stop("error", "Use this app on the Tailscale DNS page.");
      const snap = this.adapter.snapshot();
      if (!snap.ok) return this.stop("error", snap.error);
      this.expectedCount = snap.names.length;
      if (this.scan(snap)) return this.getState();
      this.nextAt = this.now() + this.config.interval * 1000;
      this.state.phase = run ? "countdown" : "preview";
      this.state.message = run ? "No match yet. Checking again before every reroll." : "Current names checked. No rerolls were sent.";
      if (!run) this.nextAt = 0;
      this.adapter.started?.(this.getState());
      return this.getState();
    }
    tick() {
      if (!this.state.running || this.ticking) return;
      this.ticking = true;
      try {
        if (!this.adapter.allowed()) return this.stop("error", "Page changed. Search stopped.");
        const now = this.now();
        const snap = this.adapter.snapshot();
        if (!snap.ok) {
          if (!this.pending) return this.stop("error", snap.error);
          if (now - this.pending.at >= this.timeout) return this.stop("error", "New options did not load. Search stopped without another click.");
          return;
        }
        if (this.scan(snap)) return;
        if (snap.disabled || snap.names.length !== this.expectedCount) {
          if (this.unreadySince === null) this.unreadySince = now;
          this.state.phase = "waiting";
          this.state.message = "Waiting for the complete options list…";
          if (now - this.unreadySince >= this.timeout) this.stop("error", "Options are incomplete or the button is unavailable. Search stopped.");
          return;
        }
        this.unreadySince = null;
        if (this.pending) {
          if (this.fingerprint === this.pending.before) {
            this.state.phase = "waiting";
            this.state.message = "Waiting for Tailscale to return new options…";
            if (now - this.pending.at >= this.timeout) this.stop("error", "Names did not change after rerolling. Check the page for an error or rate limit.");
            return;
          }
          if (now - this.stableSince < this.settle) return;
          this.pending = null;
        }
        if (this.state.rolls >= this.config.maxRolls) return this.stop("limit", "Reroll limit reached. Current names have been checked and preserved.");
        this.state.phase = "countdown";
        this.state.message = "No match yet. Checking again before every reroll.";
        if (now < this.nextAt || now - this.stableSince < this.settle) return;
        // Re-read in the same task immediately before clicking. Never click a stale button.
        const fresh = this.adapter.snapshot();
        if (!fresh.ok) return this.stop("error", fresh.error);
        const before = this.fingerprint;
        if (this.scan(fresh)) return;
        if (fresh.disabled || fresh.names.length !== this.expectedCount || before !== this.fingerprint) return;
        this.pending = {before:this.fingerprint, at:now};
        this.nextAt = now + this.config.interval * 1000;
        this.state.rolls++;
        this.state.phase = "waiting";
        this.state.message = "Rerolled once. Waiting for the new names…";
        this.adapter.click(fresh);
      } catch (error) {
        this.stop("error", `Stopped: ${error.message}`);
      } finally { this.ticking = false; }
    }
  }
  root.TailnetEngine = Engine;
  if (typeof module !== "undefined") module.exports = Engine;
})(globalThis);
