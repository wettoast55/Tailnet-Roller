(() => {
  "use strict";
  if (globalThis.__tailnetFinder) return;
  const rules = globalThis.TailnetRules;
  const page = globalThis.TailnetPage;
  const runtimeId = chrome.runtime.id;
  let outlines = [];
  let originalTitle = null;
  const send = message => { try { chrome.runtime.sendMessage(message).catch(() => {}); } catch {} };
  const clear = () => {
    send({type:"TF_CLEAR_MATCH"});
    for (const [node, outline, offset] of outlines) { node.style.outline = outline; node.style.outlineOffset = offset; }
    outlines = [];
    if (originalTitle !== null && document.title.startsWith("✓ Tailnet match")) document.title = originalTitle;
    originalTitle = null;
  };
  const engine = new globalThis.TailnetEngine({
    allowed: () => chrome.runtime?.id === runtimeId && rules.allowedURL(location.href),
    snapshot: () => page.snapshot(document),
    click: snap => {
      if (!snap.button.isConnected || !page.isReroll(snap.button) || !page.visible(snap.button)) throw new Error("Reroll button changed.");
      snap.button.click();
    },
    clear,
    started: state => send({type:"TF_BADGE", phase:state.phase}),
    stopped: state => send({type:"TF_BADGE", phase:state.phase}),
    matched: (state, snap, notify) => {
      for (const option of snap.options) if (state.matches.includes(option.name)) {
        outlines.push([option.node, option.node.style.outline, option.node.style.outlineOffset]);
        option.node.style.outline = "3px solid #12b886";
        option.node.style.outlineOffset = "4px";
      }
      originalTitle = document.title;
      document.title = `✓ Tailnet match: ${state.matches[0]}`;
      send({type:"TF_MATCH", names:state.matches, notify});
    }
  }, rules);
  globalThis.__tailnetFinder = engine;
  const interval = setInterval(() => engine.tick(), 250);
  // Observe name replacements immediately, including the final allowed reroll.
  const observer = new MutationObserver(() => engine.tick());
  observer.observe(document.documentElement, {childList:true, subtree:true, characterData:true, attributes:true, attributeFilter:["disabled","aria-disabled","aria-busy"]});
  // User interaction with the underlying name dialog always cancels automation.
  document.addEventListener("click", event => {
    if (!event.isTrusted || !engine.state.running) return;
    const snap = page.snapshot(document);
    if (snap.ok && snap.scope.contains(event.target)) engine.pause("Paused because you interacted with the Tailscale dialog.");
  }, true);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && engine.state.running) engine.pause("Paused with Escape.");
  }, true);
  window.addEventListener("pagehide", () => {engine.pause("Page closed or changed."); clearInterval(interval); observer.disconnect();});
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !message?.type?.startsWith("TF_")) return;
    try {
      switch (message.type) {
        case "TF_STATUS": respond({ok:true, state:engine.getState()}); break;
        case "TF_START": respond({ok:true, state:engine.begin(message.config, true)}); break;
        case "TF_SKIP_MATCH": respond({ok:true, state:engine.skipAndContinue(message.config)}); break;
        case "TF_PREVIEW": respond({ok:true, state:engine.begin(message.config, false)}); break;
        case "TF_PAUSE": respond({ok:true, state:engine.pause()}); break;
      }
    } catch (error) { respond({ok:false, error:error.message}); }
  });
})();
