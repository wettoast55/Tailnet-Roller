/**
 * Runs in the Tailscale tab after the user opens Tailnet Roller.
 * Connects the pure engine to page reads, the one permitted click, and messages.
 */
(function startPageController() {
  "use strict";

  // Opening the popup again must reuse the running search, not add another timer.
  if (globalThis.__tailnetRoller) return;

  const rules = globalThis.TailnetRules;
  const pageReader = globalThis.TailnetPage;
  const messages = globalThis.TailnetMessages;
  const runtimeId = chrome.runtime.id;
  const MATCH_TITLE_PREFIX = "Match found: ";
  let highlightedElements = [];
  let originalTitle = null;

  /** A closed/updated extension can invalidate its message channel. */
  function sendToBackground(message) {
    try {
      chrome.runtime.sendMessage(message).catch(() => {});
    } catch {
      // The engine also checks runtime validity before every potential click.
    }
  }

  /** Restore the page's original title and outlines before another check or run. */
  function clearMatchDisplay() {
    sendToBackground({ type: messages.CLEAR_MATCH });

    for (const saved of highlightedElements) {
      saved.element.style.outline = saved.outline;
      saved.element.style.outlineOffset = saved.offset;
    }
    highlightedElements = [];

    if (originalTitle !== null && document.title.startsWith(MATCH_TITLE_PREFIX)) {
      document.title = originalTitle;
    }
    originalTitle = null;
  }

  /** Highlight results without checking their radio buttons or confirming a name. */
  function showMatch(state, snapshot, notify) {
    for (const option of snapshot.options) {
      if (!state.matches.includes(option.name)) continue;

      highlightedElements.push({
        element: option.node,
        outline: option.node.style.outline,
        offset: option.node.style.outlineOffset
      });
      option.node.style.outline = "3px solid #12b886";
      option.node.style.outlineOffset = "4px";
    }

    originalTitle = document.title;
    document.title = `${MATCH_TITLE_PREFIX}${state.matches[0]}`;
    sendToBackground({ type: messages.MATCH_FOUND, names: state.matches, notify });
  }

  /** Forward state changes to the worker that owns toolbar permissions. */
  function updateBadge(state) {
    sendToBackground({ type: messages.SET_BADGE, phase: state.phase });
  }

  const engine = new globalThis.TailnetEngine({
    allowed() {
      return chrome.runtime?.id === runtimeId && rules.allowedURL(location.href);
    },
    snapshot() {
      return pageReader.snapshot(document);
    },
    click(snapshot) {
      const button = snapshot.button;
      if (!button.isConnected || !pageReader.isReroll(button) || !pageReader.visible(button)) {
        throw new Error("The Re-roll options button changed.");
      }
      button.click();
    },
    clear: clearMatchDisplay,
    started: updateBadge,
    stopped: updateBadge,
    matched: showMatch
  }, rules);

  globalThis.__tailnetRoller = engine;

  // Polling covers timing; the observer catches name replacements immediately.
  const pollTimer = setInterval(() => engine.tick(), 250);
  const observer = new MutationObserver(() => engine.tick());
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["disabled", "aria-disabled", "aria-busy"]
  });

  // Real interaction with the dialog pauses automation. Our synthetic button
  // clicks have isTrusted=false and therefore do not pause their own run.
  document.addEventListener("click", event => {
    if (!event.isTrusted || !engine.state.running) return;
    const snapshot = pageReader.snapshot(document);
    if (snapshot.ok && snapshot.scope.contains(event.target)) {
      engine.pause("Paused because you interacted with the Tailscale dialog.");
    }
  }, true);

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && engine.state.running) {
      engine.pause("Paused with Escape.");
    }
  }, true);

  window.addEventListener("pagehide", () => {
    engine.pause("Page closed or changed.");
    clearInterval(pollTimer);
    observer.disconnect();
  });

  // Only messages from this extension can control the search.
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== runtimeId) return;

    try {
      let state;
      switch (message.type) {
        case messages.STATUS:
          state = engine.getState();
          break;
        case messages.START:
          state = engine.begin(message.config, true);
          break;
        case messages.SKIP_MATCH:
          state = engine.skipAndContinue(message.config);
          break;
        case messages.PREVIEW:
          state = engine.begin(message.config, false);
          break;
        case messages.PAUSE:
          state = engine.pause();
          break;
        default:
          return;
      }
      respond({ ok: true, state });
    } catch (error) {
      respond({ ok: false, error: error.message });
    }
  });
})();
