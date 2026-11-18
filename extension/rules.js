(function (root) {
  "use strict";
  const defaults = Object.freeze({
    phrases: "", phraseMode: "word", phraseLogic: "any", phraseScope: "name",
    excludes: "", lengthEnabled: true, firstMin: 1, firstMax: 5,
    secondMin: 1, secondMax: 5, lengthLogic: "both", totalMax: "",
    combine: "both", interval: 5, maxRolls: 200, notify: true
  });
  const normalize = value => String(value || "").toLowerCase().trim().replace(/\.ts\.net\.?$/i, "").replace(/[-\s]+/g, " ");
  const list = value => [...new Set(String(value || "").split(/[,\n]+/).map(normalize).filter(Boolean))];
  function integer(value, fallback, min, max, label) {
    if (value === "" || value === null || value === undefined) return fallback;
    const n = Number(value);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${label} must be ${min}–${max}.`);
    return n;
  }
  function compile(input = {}) {
    const c = { ...defaults, ...input };
    const options = {phraseMode:["contains","word","exact","starts","ends"],phraseLogic:["any","all"],phraseScope:["name","first","second"],lengthLogic:["both","either"],combine:["both","either"]};
    for (const [key, values] of Object.entries(options)) if (!values.includes(c[key])) throw new Error(`Invalid ${key}.`);
    c.lengthEnabled = Boolean(c.lengthEnabled);
    c.notify = Boolean(c.notify);
    c.terms = list(c.phrases);
    c.omit = list(c.excludes);
    for (const word of ["first", "second"]) {
      c[`${word}Min`] = integer(c[`${word}Min`], 1, 1, 63, `${word} word minimum`);
      c[`${word}Max`] = integer(c[`${word}Max`], 63, 1, 63, `${word} word maximum`);
      if (c[`${word}Min`] > c[`${word}Max`]) throw new Error(`${word} word minimum exceeds its maximum.`);
    }
    c.totalMax = integer(c.totalMax, 63, 1, 63, "Total name length");
    c.interval = integer(c.interval, 5, 3, 120, "Reroll delay (seconds)");
    c.maxRolls = integer(c.maxRolls, 200, 1, 10000, "Reroll limit");
    if (!c.terms.length && !c.lengthEnabled) throw new Error("Enter a phrase or enable word-length filtering.");
    return c;
  }
  function evaluate(name, c) {
    const base = String(name).toLowerCase().trim().replace(/\.ts\.net\.?$/i, "");
    const words = base.split("-");
    const target = normalize(c.phraseScope === "first" ? words[0] : c.phraseScope === "second" ? words[1] : base);
    const phraseCheck = term => {
      switch (c.phraseMode) {
        case "word": return (` ${target} `).includes(` ${term} `);
        case "exact": return target === term;
        case "starts": return target.startsWith(term);
        case "ends": return target.endsWith(term);
        default: return target.includes(term);
      }
    };
    const phrase = c.terms.length ? (c.phraseLogic === "all" ? c.terms.every(phraseCheck) : c.terms.some(phraseCheck)) : null;
    const first = words[0]?.length >= c.firstMin && words[0]?.length <= c.firstMax;
    const second = words[1]?.length >= c.secondMin && words[1]?.length <= c.secondMax;
    const lengths = c.lengthEnabled ? words.length === 2 && (c.lengthLogic === "both" ? first && second : first || second) && base.length <= c.totalMax : null;
    const checks = [phrase, lengths].filter(v => v !== null);
    const excluded = c.omit.find(term => normalize(base).includes(term));
    const match = !excluded && checks.length > 0 && (c.combine === "either" ? checks.some(Boolean) : checks.every(Boolean));
    const why = excluded ? `Excluded: ${excluded}` : match ? "Matches your rules" : [phrase === false ? "Phrase mismatch" : "", lengths === false ? "Length mismatch" : ""].filter(Boolean).join(" · ");
    return {name, match: Boolean(match), why, lengths: words.map(w => w.length), total: base.length};
  }
  function allowedURL(url) {
    try {
      const u = new URL(url);
      return u.protocol === "https:" && ["console.tailscale.com", "login.tailscale.com"].includes(u.hostname) && /^\/admin\/dns\/?$/.test(u.pathname);
    } catch { return false; }
  }
  const api = {defaults, normalize, list, compile, evaluate, allowedURL};
  root.TailnetRules = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
