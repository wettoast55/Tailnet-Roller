/** Desktop notifications and toolbar badges live in the background worker. */
importScripts("messages.js", "rules.js");

const messages = globalThis.TailnetMessages;
const badgeStyles = {
  matched: { text: "YES", color: "#087f5b" },
  countdown: { text: "RUN", color: "#1d4ed8" },
  checking: { text: "RUN", color: "#1d4ed8" },
  waiting: { text: "RUN", color: "#1d4ed8" },
  error: { text: "!", color: "#b45309" },
  limit: { text: "END", color: "#b45309" }
};

/** Keep the toolbar indicator specific to the tab that owns the run. */
async function setBadge(tabId, phase) {
  const style = badgeStyles[phase] || { text: "", color: "#334155" };
  await chrome.action.setBadgeBackgroundColor({ tabId, color: style.color });
  await chrome.action.setBadgeText({ tabId, text: style.text });
}

/** Reuse a notification ID so one run does not accumulate duplicate notices. */
async function showNotification(id, message) {
  await chrome.notifications.create(id, {
    type: "basic",
    iconUrl: "icon128.png",
    title: "Tailnet Roller",
    message,
    priority: 2,
    requireInteraction: true,
    silent: false
  });
}

/** Limit notifications to names in the expected format, from the allowed page. */
function handleMatch(message, tabId) {
  setBadge(tabId, "matched").catch(() => {});
  if (!message.notify || !Array.isArray(message.names)) return;

  const names = message.names
    .filter(name => typeof name === "string" && /^[a-z0-9-]+\.ts\.net$/.test(name))
    .slice(0, 10);

  if (names.length > 0) {
    showNotification(
      `tailnet-roller-match-${tabId}`,
      `Match found: ${names.join(", ")}\nRolling has stopped. Click to return to Tailscale.`
    ).catch(() => {});
  }
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;

  // The popup can test desktop notifications without starting a page search.
  if (message.type === messages.TEST_NOTIFICATION && !sender.tab) {
    showNotification("tailnet-roller-test", "Notifications work. A matching name will stop rolling.")
      .then(() => reply({ ok: true }))
      .catch(error => reply({ ok: false, error: error.message }));
    return true; // Keep the reply channel open for the asynchronous notification.
  }

  if (!sender.tab || !TailnetRules.allowedURL(sender.url || sender.tab.url)) return;
  const tabId = sender.tab.id;

  switch (message.type) {
    case messages.CLEAR_MATCH:
      chrome.notifications.clear(`tailnet-roller-match-${tabId}`).catch(() => {});
      break;
    case messages.SET_BADGE:
      setBadge(tabId, message.phase).catch(() => {});
      break;
    case messages.MATCH_FOUND:
      handleMatch(message, tabId);
      break;
  }
});

// Notification IDs encode the originating tab, so they survive worker restarts.
chrome.notifications.onClicked.addListener(async notificationId => {
  const match = /^tailnet-roller-match-(\d+)$/.exec(notificationId);
  if (!match) return;

  try {
    const tab = await chrome.tabs.get(Number(match[1]));
    if (!TailnetRules.allowedURL(tab.url)) return;
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    await chrome.notifications.clear(notificationId);
  } catch {
    // A closed tab cannot be focused; the notification has no other side effects.
  }
});

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === "loading") {
    chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
  }
});
