/**
 * Choose the one main button's action from the current search state.
 * This module has no DOM or browser API dependencies, so transitions are testable.
 */
(function registerControls(root) {
  "use strict";

  function primaryActionFor(state) {
    // While rolling, the same button becomes the stop control.
    if (state.running) {
      return {
        action: "pause",
        label: "Pause rolling",
        hint: "Pause without changing the current names."
      };
    }

    // Explicitly rejecting a result is different from starting a fresh check.
    // Never discard matching names merely because a stopped search is reopened.
    if (state.matches.length > 0) {
      return {
        action: "skip",
        label: state.matches.length === 1
          ? "Skip match & keep rolling"
          : "Skip matches & keep rolling",
        hint: "Ignore these matches for this tab session and start a fresh roll budget."
      };
    }

    return {
      action: "start",
      label: "Start rolling",
      hint: "Check the current names first, then roll when none match."
    };
  }

  root.TailnetControls = { primaryActionFor };

  if (typeof module !== "undefined") {
    module.exports = root.TailnetControls;
  }
})(globalThis);
