/**
 * Shared message names for the popup, page controller, and background worker.
 * Keeping them together prevents a spelling change from breaking one endpoint.
 */
(function registerMessages(root) {
  "use strict";

  const messages = Object.freeze({
    STATUS: "ROLLER_STATUS",
    START: "ROLLER_START",
    SKIP_MATCH: "ROLLER_SKIP_MATCH",
    PAUSE: "ROLLER_PAUSE",
    PREVIEW: "ROLLER_PREVIEW",
    SET_BADGE: "ROLLER_SET_BADGE",
    MATCH_FOUND: "ROLLER_MATCH_FOUND",
    CLEAR_MATCH: "ROLLER_CLEAR_MATCH",
    TEST_NOTIFICATION: "ROLLER_TEST_NOTIFICATION"
  });

  root.TailnetMessages = messages;

  // CommonJS exports let the tests use the same code as the browser.
  if (typeof module !== "undefined") {
    module.exports = messages;
  }
})(globalThis);
