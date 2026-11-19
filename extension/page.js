/**
 * Read the name choices and locate the exact Re-roll options button.
 * Ambiguous or unreadable pages return an error instead of guessing what to click.
 */
(function registerPageReader(root) {
  "use strict";

  const BUTTON_SELECTOR = 'button,[role="button"],input[type="button"]';
  const CHOICE_SELECTOR = 'input[type="radio"],[role="radio"]';
  const DIALOG_SELECTOR = 'dialog,[role="dialog"],[aria-modal="true"]';

  /** Hidden controls may have visible labels, so callers check both when needed. */
  function visible(element) {
    if (!element || !element.isConnected || element.closest('[hidden],[aria-hidden="true"]')) {
      return false;
    }

    const style = element.ownerDocument.defaultView.getComputedStyle(element);
    return style.display !== "none"
      && style.visibility !== "hidden"
      && style.visibility !== "collapse"
      && element.getClientRects().length > 0;
  }

  /** Prefer rendered text, with a textContent fallback for simple elements. */
  function elementText(element) {
    return element?.innerText || element?.textContent || "";
  }

  /** Ignore spacing and typographic hyphens, but require the full button name. */
  function normalizeButtonLabel(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[\s\-\u2010-\u2015]+/g, "")
      .trim();
  }

  /** Check visible text, accessibility text, and input-button values. */
  function isReroll(element) {
    const labels = [
      element.getAttribute("aria-label"),
      elementText(element),
      element.value
    ];

    return labels.some(label => normalizeButtonLabel(label) === "rerolloptions");
  }

  /** Join suffix fragments such as "blue-fox . ts.net" before reading a name. */
  function nameFrom(rawText) {
    const joined = String(rawText || "").toLowerCase().replace(/\s*\.\s*/g, ".");
    const fullNames = [...new Set(
      joined.match(/\b[a-z0-9]+(?:-[a-z0-9]+)*\.ts\.net\b/g) || []
    )];

    if (fullNames.length === 1) {
      return fullNames[0];
    }

    // Some radio labels contain only the prefix, with the suffix drawn elsewhere.
    const bareName = String(rawText || "").trim().toLowerCase();
    return /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(bareName)
      ? `${bareName}.ts.net`
      : null;
  }

  /** Support normal labels, ARIA labels, and custom radio-button components. */
  function labelsFor(control) {
    const labels = [...(control.labels || [])];
    const wrappingLabel = control.closest("label");

    if (wrappingLabel && !labels.includes(wrappingLabel)) {
      labels.push(wrappingLabel);
    }

    const labelIds = (control.getAttribute("aria-labelledby") || "")
      .split(/\s+/)
      .filter(Boolean);

    for (const id of labelIds) {
      const label = control.ownerDocument.getElementById(id);
      if (label) labels.push(label);
    }

    // A parent is safe to read only when it describes a single choice.
    const parent = control.parentElement;
    if (parent && parent.querySelectorAll(CHOICE_SELECTOR).length === 1) {
      labels.push(parent);
    }

    return labels;
  }

  /** Return unique selectable fun names and count any choices we cannot read. */
  function optionsIn(scope) {
    const foundOptions = [];
    let unreadableCount = 0;

    for (const control of scope.querySelectorAll(CHOICE_SELECTOR)) {
      const labels = labelsFor(control);
      const visibleLabels = labels.filter(visible);

      if (!visible(control) && visibleLabels.length === 0) continue;
      if (control.disabled || control.getAttribute("aria-disabled") === "true") continue;

      const textSources = [
        control.getAttribute("aria-label"),
        ...visibleLabels.map(elementText),
        control.value
      ];
      const possibleNames = [...new Set(textSources.map(nameFrom).filter(Boolean))];

      if (possibleNames.length !== 1) {
        unreadableCount++;
        continue;
      }

      const name = possibleNames[0];
      if (/^tail[0-9a-f]+\.ts\.net$/i.test(name)) {
        continue; // The default hexadecimal name is not one of the random choices.
      }

      foundOptions.push({ name, node: visibleLabels[0] || control, control });
    }

    const uniqueOptions = [...new Map(
      foundOptions.map(option => [option.name, option])
    ).values()];
    uniqueOptions.unreadable = unreadableCount;
    return uniqueOptions;
  }

  /** Read one complete view of the name dialog without modifying it. */
  function snapshot(documentRoot = document) {
    const buttons = [...documentRoot.querySelectorAll(BUTTON_SELECTOR)]
      .filter(button => visible(button) && isReroll(button));

    if (buttons.length !== 1) {
      return {
        ok: false,
        error: buttons.length > 0
          ? "More than one Re-roll options button is visible. Close the extra dialog."
          : "Open the Rename tailnet choices so Re-roll options is visible."
      };
    }

    const button = buttons[0];
    let scope = button.closest(DIALOG_SELECTOR);
    let options = scope ? optionsIn(scope) : [];

    // Fall back to the nearest container that holds both the choices and button.
    // Never scan unrelated radio buttons across the entire page.
    if (!scope) {
      let parent = button.parentElement;
      while (parent && parent !== documentRoot.body && parent !== documentRoot.documentElement) {
        const candidates = optionsIn(parent);
        if (candidates.length >= 2) {
          scope = parent;
          options = candidates;
          break;
        }
        parent = parent.parentElement;
      }
    }

    if (!scope || options.length === 0) {
      return {
        ok: false,
        error: "No selectable names detected beside Re-roll options. No click was sent."
      };
    }

    if (options.unreadable > 0) {
      return {
        ok: false,
        error: "Some choices could not be read reliably. The current options have been preserved."
      };
    }

    const busy = button.disabled
      || button.getAttribute("aria-disabled") === "true"
      || button.getAttribute("aria-busy") === "true"
      || scope.getAttribute("aria-busy") === "true";

    return {
      ok: true,
      button,
      scope,
      options,
      names: options.map(option => option.name),
      disabled: Boolean(busy)
    };
  }

  root.TailnetPage = { snapshot, visible, isReroll, optionsIn, nameFrom };

  if (typeof module !== "undefined") {
    module.exports = root.TailnetPage;
  }
})(globalThis);
