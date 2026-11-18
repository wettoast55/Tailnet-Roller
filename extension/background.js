importScripts("rules.js");
const phases = {
  matched: ["YES", "#087f5b"], countdown: ["RUN", "#1d4ed8"],
  checking: ["RUN", "#1d4ed8"], waiting: ["RUN", "#1d4ed8"],
  error: ["!", "#b45309"], limit:["END", "#b45309"], paused:["", "#334155"], preview:["", "#334155"]
};
async function badge(tabId, phase) {
  const [text, color] = phases[phase] || ["", "#334155"];
  await chrome.action.setBadgeBackgroundColor({tabId, color});
  await chrome.action.setBadgeText({tabId, text});
}
async function notify(id, message) {
  await chrome.notifications.create(id, {
    type:"basic", iconUrl:"icon128.png", title:"Tailnet Finder",
    message, priority:2, requireInteraction:true, silent:false
  });
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message.type === "TF_TEST_NOTIFICATION" && !sender.tab) {
    notify("tailnet-test", "Notifications are working. Matching names will stop the search.")
      .then(() => reply({ok:true})).catch(error => reply({ok:false, error:error.message}));
    return true;
  }
  if (!sender.tab || !TailnetRules.allowedURL(sender.url || sender.tab.url)) return;
  if (message.type === "TF_BADGE") {
    badge(sender.tab.id, message.phase).catch(() => {});
  } else if (message.type === "TF_MATCH") {
    badge(sender.tab.id, "matched").catch(() => {});
    if (message.notify && Array.isArray(message.names)) {
      const names = message.names.filter(n => typeof n === "string" && /^[a-z0-9-]+\.ts\.net$/.test(n)).slice(0, 10);
      if (names.length) notify(`tailnet-found-${sender.tab.id}`, `Match found: ${names.join(", ")}\nRerolling has stopped. Click to return to Tailscale.`).catch(() => {});
    }
  }
});
chrome.notifications.onClicked.addListener(async id => {
  const match = /^tailnet-found-(\d+)$/.exec(id);
  if (!match) return;
  try {
    const tab = await chrome.tabs.get(Number(match[1]));
    if (!TailnetRules.allowedURL(tab.url)) return;
    await chrome.tabs.update(tab.id, {active:true});
    await chrome.windows.update(tab.windowId, {focused:true});
    await chrome.notifications.clear(id);
  } catch {}
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === "loading") chrome.action.setBadgeText({tabId, text:""}).catch(() => {});
});
