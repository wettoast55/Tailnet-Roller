(function (root) {
  "use strict";
  const BUTTON = 'button,[role="button"],input[type="button"]';
  const CHOICE = 'input[type="radio"],[role="radio"]';
  const normalizeButton = value => String(value || "").toLowerCase().replace(/[\s\-\u2010-\u2015]+/g, "").trim();
  function visible(el) {
    if (!el || !el.isConnected || el.closest('[hidden],[aria-hidden="true"]')) return false;
    const style = el.ownerDocument.defaultView.getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse" && el.getClientRects().length > 0;
  }
  const text = el => el?.innerText || el?.textContent || "";
  function isReroll(el) {
    return [el.getAttribute("aria-label"), text(el), el.value].some(v => normalizeButton(v) === "rerolloptions");
  }
  function domains(raw) {
    const joined = String(raw || "").toLowerCase().replace(/\s*\.\s*/g, ".");
    return [...new Set(joined.match(/\b[a-z0-9]+(?:-[a-z0-9]+)*\.ts\.net\b/g) || [])];
  }
  function nameFrom(raw) {
    const full = domains(raw);
    if (full.length === 1) return full[0];
    const bare = String(raw || "").trim().toLowerCase();
    return /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(bare) ? `${bare}.ts.net` : null;
  }
  function optionsIn(scope) {
    const found = [];
    let unreadable = 0;
    for (const control of scope.querySelectorAll(CHOICE)) {
      const labels = [...(control.labels || [])];
      const wrapping = control.closest("label");
      if (wrapping && !labels.includes(wrapping)) labels.push(wrapping);
      const ids = (control.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean);
      labels.push(...ids.map(id => control.ownerDocument.getElementById(id)).filter(Boolean));
      const parent = control.parentElement;
      if (parent && parent.querySelectorAll(CHOICE).length === 1) labels.push(parent);
      if (!visible(control) && !labels.some(visible)) continue;
      if (control.disabled || control.getAttribute("aria-disabled") === "true") continue;
      const sources = [control.getAttribute("aria-label"), ...labels.filter(visible).map(text), control.value];
      const possible = [...new Set(sources.map(nameFrom).filter(Boolean))];
      if (possible.length !== 1) { unreadable++; continue; }
      const name = possible[0];
      if (/^tail[0-9a-f]+\.ts\.net$/i.test(name)) continue;
      const node = labels.find(visible) || control;
      found.push({name, node, control});
    }
    const unique = [...new Map(found.map(o => [o.name, o])).values()];
    unique.unreadable = unreadable;
    return unique;
  }
  function snapshot(doc = document) {
    const buttons = [...doc.querySelectorAll(BUTTON)].filter(el => visible(el) && isReroll(el));
    if (buttons.length !== 1) return {ok:false, error: buttons.length ? "More than one Re-roll options button is visible. Close the extra dialog." : "Open the Rename tailnet choices so Re-roll options is visible."};
    const button = buttons[0];
    const dialog = button.closest('dialog,[role="dialog"],[aria-modal="true"]');
    let scope = dialog;
    let options = scope ? optionsIn(scope) : [];
    if (!scope) {
      let parent = button.parentElement;
      while (parent && parent !== doc.body && parent !== doc.documentElement) {
        const candidates = optionsIn(parent);
        if (candidates.length >= 2) { scope = parent; options = candidates; break; }
        parent = parent.parentElement;
      }
    }
    if (!scope || options.length < 1) return {ok:false, error:"No selectable tailnet names detected beside Re-roll options. No click was sent."};
    if (options.unreadable) return {ok:false, error:"Some tailnet choices could not be read reliably. Search stopped to preserve the current options."};
    const busy = button.disabled || button.getAttribute("aria-disabled") === "true" || button.getAttribute("aria-busy") === "true" || scope.getAttribute("aria-busy") === "true";
    return {ok:true, button, scope, options, names: options.map(o => o.name), disabled:Boolean(busy)};
  }
  root.TailnetPage = {snapshot, visible, isReroll, optionsIn, nameFrom};
  if (typeof module !== "undefined") module.exports = root.TailnetPage;
})(globalThis);
