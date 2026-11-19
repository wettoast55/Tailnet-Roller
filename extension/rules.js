/**
 * Validate the search settings and decide whether a tailnet name matches them.
 * Matching is pure: it reads no page elements and never sends a click.
 */
(function registerRules(root) {
  "use strict";

  const defaults = Object.freeze({
    phrases: "",
    phraseMode: "word",
    phraseLogic: "any",
    phraseScope: "name",
    excludes: "",
    lengthEnabled: true,
    firstMin: 1,
    firstMax: 5,
    secondMin: 1,
    secondMax: 5,
    lengthLogic: "both",
    totalMax: "",
    combine: "both",
    interval: 5,
    maxRolls: 200,
    notify: true
  });

  const allowedChoices = {
    phraseMode: ["contains", "word", "exact", "starts", "ends"],
    phraseLogic: ["any", "all"],
    phraseScope: ["name", "first", "second"],
    lengthLogic: ["both", "either"],
    combine: ["both", "either"]
  };

  /** Treat "Blue-Fox", "blue fox", and "blue-fox.ts.net" as equivalent phrases. */
  function normalize(value) {
    return String(value || "")
      .toLowerCase()
      .trim()
      .replace(/\.ts\.net\.?$/i, "")
      .replace(/[-\s]+/g, " ");
  }

  /** Split the user's comma/newline list, removing empty and duplicate phrases. */
  function list(value) {
    const phrases = String(value || "")
      .split(/[,\n]+/)
      .map(normalize)
      .filter(Boolean);

    return [...new Set(phrases)];
  }

  /** Accept blank fields as defaults, but reject fractions and out-of-range values. */
  function readInteger(value, fallback, minimum, maximum, label) {
    if (value === "" || value === null || value === undefined) {
      return fallback;
    }

    const number = Number(value);
    if (!Number.isInteger(number) || number < minimum || number > maximum) {
      throw new Error(`${label} must be ${minimum}-${maximum}.`);
    }

    return number;
  }

  /** Convert form strings into a validated configuration for a search run. */
  function compile(input = {}) {
    const settings = { ...defaults, ...input };

    for (const [key, choices] of Object.entries(allowedChoices)) {
      if (!choices.includes(settings[key])) {
        throw new Error(`Invalid ${key}.`);
      }
    }

    settings.lengthEnabled = Boolean(settings.lengthEnabled);
    settings.notify = Boolean(settings.notify);
    settings.terms = list(settings.phrases);
    settings.omit = list(settings.excludes);

    for (const word of ["first", "second"]) {
      const minimumKey = `${word}Min`;
      const maximumKey = `${word}Max`;

      settings[minimumKey] = readInteger(
        settings[minimumKey], 1, 1, 63, `${word} word minimum`
      );
      settings[maximumKey] = readInteger(
        settings[maximumKey], 63, 1, 63, `${word} word maximum`
      );

      if (settings[minimumKey] > settings[maximumKey]) {
        throw new Error(`${word} word minimum exceeds its maximum.`);
      }
    }

    // The name prefix is a DNS label: a blank total limit still caps it at 63.
    settings.totalMax = readInteger(settings.totalMax, 63, 1, 63, "Total name length");
    settings.interval = readInteger(settings.interval, 5, 3, 120, "Roll delay (seconds)");
    settings.maxRolls = readInteger(settings.maxRolls, 200, 1, 10000, "Roll limit");

    if (settings.terms.length === 0 && !settings.lengthEnabled) {
      throw new Error("Enter a phrase or enable word-length filtering.");
    }

    return settings;
  }

  /** Compare one normalized phrase with the selected part of a name. */
  function phraseMatches(target, phrase, mode) {
    switch (mode) {
      case "word":
        return ` ${target} `.includes(` ${phrase} `);
      case "exact":
        return target === phrase;
      case "starts":
        return target.startsWith(phrase);
      case "ends":
        return target.endsWith(phrase);
      default:
        return target.includes(phrase);
    }
  }

  /** Missing words never satisfy a length range. Bounds are inclusive. */
  function wordLengthFits(word, minimum, maximum) {
    return Boolean(word && word.length >= minimum && word.length <= maximum);
  }

  /** Return a match decision together with a readable explanation and lengths. */
  function evaluate(name, settings) {
    const prefix = String(name).toLowerCase().trim().replace(/\.ts\.net\.?$/i, "");
    const words = prefix.split("-");
    let phraseTarget = prefix;

    if (settings.phraseScope === "first") {
      phraseTarget = words[0];
    } else if (settings.phraseScope === "second") {
      phraseTarget = words[1];
    }

    const target = normalize(phraseTarget);
    const checkPhrase = phrase => phraseMatches(target, phrase, settings.phraseMode);

    // null means a filter is off; it must not affect an AND/OR decision.
    let phrasePasses = null;
    if (settings.terms.length > 0) {
      phrasePasses = settings.phraseLogic === "all"
        ? settings.terms.every(checkPhrase)
        : settings.terms.some(checkPhrase);
    }

    let lengthPasses = null;
    if (settings.lengthEnabled) {
      const firstFits = wordLengthFits(words[0], settings.firstMin, settings.firstMax);
      const secondFits = wordLengthFits(words[1], settings.secondMin, settings.secondMax);
      const wordsFit = settings.lengthLogic === "both"
        ? firstFits && secondFits
        : firstFits || secondFits;

      lengthPasses = words.length === 2 && wordsFit && prefix.length <= settings.totalMax;
    }

    const enabledChecks = [phrasePasses, lengthPasses].filter(result => result !== null);
    const excludedPhrase = settings.omit.find(phrase => normalize(prefix).includes(phrase));
    const filtersPass = settings.combine === "either"
      ? enabledChecks.some(Boolean)
      : enabledChecks.every(Boolean);
    const match = !excludedPhrase && enabledChecks.length > 0 && filtersPass;

    let reason = "Matches your rules";
    if (excludedPhrase) {
      reason = `Excluded: ${excludedPhrase}`;
    } else if (!match) {
      const failures = [];
      if (phrasePasses === false) failures.push("Phrase mismatch");
      if (lengthPasses === false) failures.push("Length mismatch");
      reason = failures.join("; ");
    }

    return {
      name,
      match: Boolean(match),
      why: reason,
      lengths: words.map(word => word.length),
      total: prefix.length
    };
  }

  /** Restrict activation to the two supported Tailscale DNS page addresses. */
  function allowedURL(address) {
    try {
      const url = new URL(address);
      const supportedHost = ["console.tailscale.com", "login.tailscale.com"]
        .includes(url.hostname);

      return url.protocol === "https:"
        && supportedHost
        && /^\/admin\/dns\/?$/.test(url.pathname);
    } catch {
      return false;
    }
  }

  root.TailnetRules = { defaults, normalize, list, compile, evaluate, allowedURL };

  if (typeof module !== "undefined") {
    module.exports = root.TailnetRules;
  }
})(globalThis);
