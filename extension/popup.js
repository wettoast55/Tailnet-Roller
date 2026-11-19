/**
 * Popup controller: edit preferences, render results, and dispatch user actions.
 * Closing this popup does not stop the engine running in the Tailscale tab.
 */
(function startPopup() {
  "use strict";

  const messages = globalThis.TailnetMessages;
  const rules = globalThis.TailnetRules;
  const settingsStore = globalThis.TailnetSettings;
  const controls = globalThis.TailnetControls;
  const settingKeys = Object.keys(rules.defaults);
  const element = id => document.getElementById(id);

  let activeTabId = null;
  let connected = false;
  let pollInProgress = false;
  let actionInProgress = false;
  let actionRevision = 0;
  let lastState = null;

  const phaseLabels = {
    idle: "Ready",
    preview: "Names checked",
    checking: "Checking",
    countdown: "Rolling",
    waiting: "Loading options",
    matched: "Match found",
    paused: "Paused",
    limit: "Limit reached",
    error: "Stopped"
  };

  /** Read booleans from checkboxes and leave numeric strings for validation. */
  function readSettings() {
    return Object.fromEntries(settingKeys.map(key => {
      const input = element(key);
      return [key, input.type === "checkbox" ? input.checked : input.value];
    }));
  }

  /** Populate the form from defaults, saved preferences, or a quick preset. */
  function fillSettings(settings) {
    for (const key of settingKeys) {
      const input = element(key);
      if (input.type === "checkbox") {
        input.checked = Boolean(settings[key]);
      } else {
        input.value = settings[key];
      }
    }
  }

  /** An empty message hides the alert and clears an earlier failure. */
  function showError(message = "") {
    element("error").textContent = message;
    element("error").hidden = !message;
  }

  /** Save edits even before a run starts, so reopening restores the form. */
  async function saveSettings() {
    const settings = readSettings();
    await settingsStore.saveSettings(chrome.storage.local, settings);
    return settings;
  }

  /** All page commands go through one checked response path. */
  async function requestPage(type, additionalData = {}) {
    if (!connected) {
      throw new Error("Open the Tailscale DNS tab, then reopen Tailnet Roller.");
    }

    const response = await chrome.tabs.sendMessage(activeTabId, { type, ...additionalData });
    if (!response?.ok) {
      throw new Error(response?.error || "The page did not respond. Refresh Tailscale and reopen Tailnet Roller.");
    }
    return response.state;
  }

  /** Build a read-only result row with its match reason and character counts. */
  function renderCandidates(candidates) {
    element("results").hidden = candidates.length === 0;
    element("candidates").replaceChildren();

    for (const candidate of candidates) {
      const row = document.createElement("li");
      const description = document.createElement("div");
      const name = document.createElement("code");
      const reason = document.createElement("span");
      const lengths = document.createElement("span");

      // textContent keeps page-derived names from being interpreted as markup.
      name.className = "candidate-name";
      name.textContent = candidate.name;
      reason.className = "candidate-reason";
      reason.textContent = candidate.why;
      lengths.className = "candidate-lengths";
      lengths.textContent = `${candidate.lengths.join(" + ")} / ${candidate.total}`;

      if (candidate.match) row.className = "match";
      if (candidate.skipped) row.className = "skipped";
      description.append(name, reason);
      row.append(description, lengths);
      element("candidates").append(row);
    }
  }

  /** One main button represents all start, pause, and skip/continue states. */
  function render(state) {
    lastState = state;
    const primary = controls.primaryActionFor(state);

    element("phase").textContent = phaseLabels[state.phase] || state.phase;
    element("statusBox").dataset.phase = state.phase;
    element("message").textContent = state.message;
    element("stats").textContent = `${state.rolls} rolls / ${state.checked} checked`;
    element("countdown").textContent = state.running && state.phase === "countdown"
      ? `Next roll in ${state.nextIn}s`
      : "";

    element("primaryAction").textContent = primary.label;
    element("primaryAction").disabled = !connected || actionInProgress;
    element("actionHint").textContent = primary.hint;
    element("check").disabled = !connected || state.running || actionInProgress;
    element("fields").disabled = state.running || actionInProgress;

    element("skippedInfo").hidden = !state.skippedCount;
    element("skippedInfo").textContent = `${state.skippedCount || 0} skipped name(s) ignored until this Tailscale tab is refreshed.`;
    renderCandidates(state.candidates);
  }

  /** Validate and send one action at a time; prevent double-click requests. */
  async function performAction(type) {
    if (actionInProgress) return;
    showError();
    actionInProgress = true;
    actionRevision++;
    if (lastState) render(lastState);

    try {
      let settings;
      if (type !== messages.PAUSE) {
        settings = readSettings();
        rules.compile(settings);
        await settingsStore.saveSettings(chrome.storage.local, settings);
      }

      // Pausing never waits for a settings write or validates unrelated inputs.
      lastState = await requestPage(type, { config: settings });
    } catch (error) {
      showError(error.message);
    } finally {
      actionInProgress = false;
      if (lastState) render(lastState);
    }
  }

  /** Read the latest state at click time instead of keeping a stale button action. */
  function handlePrimaryClick() {
    if (!lastState) return;
    const primary = controls.primaryActionFor(lastState);
    const command = {
      start: messages.START,
      pause: messages.PAUSE,
      skip: messages.SKIP_MATCH
    }[primary.action];
    performAction(command);
  }

  /** Change only the relevant length options; preserve entered phrases. */
  async function applyPreset(preset) {
    const settings = readSettings();
    if (preset === "phrases") {
      settings.lengthEnabled = false;
    } else {
      const maximum = preset === "short" ? 4 : 3;
      Object.assign(settings, {
        lengthEnabled: true,
        firstMin: 1,
        firstMax: maximum,
        secondMin: 1,
        secondMax: maximum,
        totalMax: "",
        lengthLogic: preset === "short" ? "both" : "either"
      });
    }
    fillSettings(settings);
    await saveSettings();
  }

  /** Let the user verify desktop notifications without rolling any names. */
  async function testNotification() {
    try {
      const response = await chrome.runtime.sendMessage({ type: messages.TEST_NOTIFICATION });
      if (!response?.ok) throw new Error(response?.error || "Notification failed.");
      element("testNotification").textContent = "Sent - check desktop notifications";
    } catch (error) {
      showError(error.message);
    }
  }

  /** Ignore an older poll if a user action started before its response arrived. */
  async function pollStatus() {
    if (pollInProgress || actionInProgress || !connected) return;
    pollInProgress = true;
    const revisionAtRequest = actionRevision;

    try {
      const state = await requestPage(messages.STATUS);
      if (!actionInProgress && revisionAtRequest === actionRevision) render(state);
    } catch {
      connected = false;
      showError("Page connection lost. Reopen Tailnet Roller on the Tailscale DNS page.");
      element("primaryAction").disabled = true;
      element("check").disabled = true;
    } finally {
      pollInProgress = false;
    }
  }

  /** Restore preferences and connect to the active, supported Tailscale tab. */
  async function initialize() {
    fillSettings(await settingsStore.loadSettings(chrome.storage.local, rules.defaults));
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !rules.allowedURL(tab.url)) {
      throw new Error("Open console.tailscale.com/admin/dns and its name choices, then reopen Tailnet Roller.");
    }
    activeTabId = tab.id;

    // Reuse an existing page controller. Inject it only when none responds.
    try {
      const response = await chrome.tabs.sendMessage(activeTabId, { type: messages.STATUS });
      if (!response?.ok) throw new Error("Page controller is not loaded.");
    } catch {
      await chrome.scripting.executeScript({
        target: { tabId: activeTabId },
        files: ["messages.js", "rules.js", "page.js", "engine.js", "content.js"]
      });
    }

    connected = true;
    render(await requestPage(messages.STATUS));
    setInterval(pollStatus, 500);
  }

  // Wire controls once. The primary button's meaning comes from the current state.
  element("primaryAction").addEventListener("click", handlePrimaryClick);
  element("check").addEventListener("click", () => performAction(messages.PREVIEW));
  element("testNotification").addEventListener("click", testNotification);
  element("settings").addEventListener("submit", event => event.preventDefault());
  element("settings").addEventListener("change", () => {
    saveSettings().catch(error => showError(error.message));
  });

  for (const button of document.querySelectorAll("[data-preset]")) {
    button.addEventListener("click", () => {
      applyPreset(button.dataset.preset).catch(error => showError(error.message));
    });
  }

  initialize().catch(error => {
    element("phase").textContent = "Open Tailscale";
    element("message").textContent = "Your rules can be configured below.";
    showError(error.message);
  });
})();
