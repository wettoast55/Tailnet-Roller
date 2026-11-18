(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const keys = Object.keys(TailnetRules.defaults);
  let tabId = null;
  let connected = false;
  let polling = false;
  let busy = false;
  function config() { return Object.fromEntries(keys.map(key => [key, $(key).type === "checkbox" ? $(key).checked : $(key).value])); }
  function fill(c) { for (const key of keys) $(key).type === "checkbox" ? $(key).checked = Boolean(c[key]) : $(key).value = c[key]; }
  function error(message) { $("error").textContent = message || ""; $("error").hidden = !message; }
  async function save() { const c = config(); await chrome.storage.local.set({tailnetFinderConfig:c}); return c; }
  async function request(type, values = {}) {
    if (!connected) throw new Error("Open the Tailscale DNS tab, then reopen Tailnet Finder.");
    const response = await chrome.tabs.sendMessage(tabId, {type, ...values});
    if (!response?.ok) throw new Error(response?.error || "The page did not respond. Reopen the extension.");
    return response.state;
  }
  const phaseNames = {idle:"Ready", preview:"Checked", checking:"Checking", countdown:"Searching", waiting:"Loading options", matched:"Match found ✓", paused:"Paused", limit:"Limit reached", error:"Stopped"};
  function render(s) {
    $("phase").textContent = phaseNames[s.phase] || s.phase;
    $("statusBox").dataset.phase = s.phase;
    $("message").textContent = s.message;
    $("stats").textContent = `${s.rolls} rolls · ${s.checked} checked`;
    $("countdown").textContent = s.running && s.phase === "countdown" ? `Next reroll in ${s.nextIn}s` : "";
    $("fields").disabled = s.running;
    $("start").disabled = !connected || s.running || busy;
    $("check").disabled = !connected || s.running || busy;
    $("pause").disabled = !connected || !s.running;
    $("results").hidden = !s.candidates.length;
    $("candidates").replaceChildren();
    for (const item of s.candidates) {
      const li = document.createElement("li");
      const name = document.createElement("code");
      const lengths = document.createElement("small");
      name.textContent = (item.match ? "✓ " : "") + item.name;
      lengths.textContent = `${item.lengths.join(" + ")} / ${item.total}`;
      li.title = item.why;
      if (item.match) li.className = "match";
      li.append(name, lengths);
      $("candidates").append(li);
    }
  }
  async function action(type) {
    error(""); busy = true; $("start").disabled = true; $("check").disabled = true;
    try {
      const c = await save();
      if (type !== "TF_PAUSE") TailnetRules.compile(c);
      const state = await request(type, {config:c});
      busy = false; render(state);
    } catch (e) { busy = false; error(e.message); $("start").disabled = !connected; $("check").disabled = !connected; }
  }
  $("start").addEventListener("click", () => action("TF_START"));
  $("check").addEventListener("click", () => action("TF_PREVIEW"));
  $("pause").addEventListener("click", () => action("TF_PAUSE"));
  $("settings").addEventListener("submit", event => event.preventDefault());
  $("settings").addEventListener("change", () => save().catch(e => error(e.message)));
  for (const button of document.querySelectorAll("[data-preset]")) button.addEventListener("click", async () => {
    const c = config();
    if (button.dataset.preset === "phrases") c.lengthEnabled = false;
    else {
      Object.assign(c, {lengthEnabled:true, firstMin:1, secondMin:1, totalMax:"", firstMax:button.dataset.preset === "short" ? 4 : 3, secondMax:button.dataset.preset === "short" ? 4 : 3, lengthLogic:button.dataset.preset === "short" ? "both" : "either"});
    }
    fill(c); await save();
  });
  $("testNotification").addEventListener("click", async () => {
    try {
      const result = await chrome.runtime.sendMessage({type:"TF_TEST_NOTIFICATION"});
      if (!result?.ok) throw new Error(result?.error || "Notification failed.");
      $("testNotification").textContent = "Sent — check your desktop notifications";
    } catch (e) { error(e.message); }
  });
  async function init() {
    const saved = await chrome.storage.local.get("tailnetFinderConfig");
    fill({...TailnetRules.defaults, ...saved.tailnetFinderConfig});
    const [tab] = await chrome.tabs.query({active:true, currentWindow:true});
    if (!tab || !TailnetRules.allowedURL(tab.url)) throw new Error("Open console.tailscale.com/admin/dns and its Rename tailnet choices, then reopen this extension.");
    tabId = tab.id;
    try { await chrome.tabs.sendMessage(tabId, {type:"TF_STATUS"}); }
    catch { await chrome.scripting.executeScript({target:{tabId}, files:["rules.js","page.js","engine.js","content.js"]}); }
    connected = true;
    render(await request("TF_STATUS"));
    setInterval(async () => {
      if (polling || busy) return;
      polling = true;
      try { render(await request("TF_STATUS")); }
      catch { connected = false; error("Page connection lost. Reopen the extension on the Tailscale DNS page."); $("start").disabled = true; $("check").disabled = true; $("pause").disabled = true; }
      finally { polling = false; }
    }, 500);
  }
  init().catch(e => { $("phase").textContent = "Open Tailscale"; $("message").textContent = "Your rules can be configured below."; error(e.message); });
})();
