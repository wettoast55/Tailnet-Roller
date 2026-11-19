/** Store preferences locally and carry them forward from the previous release. */
(function registerSettings(root) {
  "use strict";

  const STORAGE_KEY = "tailnetRollerSettings";
  const LEGACY_STORAGE_KEY = "tailnetFinderConfig";

  /** Merge saved values over defaults so future settings gain sensible values. */
  async function loadSettings(storage, defaults) {
    const saved = await storage.get([STORAGE_KEY, LEGACY_STORAGE_KEY]);
    const currentSettings = saved[STORAGE_KEY];
    const previousSettings = saved[LEGACY_STORAGE_KEY];
    const settings = {
      ...defaults,
      ...(currentSettings || previousSettings || {})
    };

    // Preserve the user's filters when they reload the renamed extension.
    // Keep the old value intact in case they temporarily use the older release.
    if (!currentSettings && previousSettings) {
      await saveSettings(storage, settings);
    }

    return settings;
  }

  /** New writes use only the current app's preference key. */
  async function saveSettings(storage, settings) {
    await storage.set({ [STORAGE_KEY]: settings });
  }

  root.TailnetSettings = { STORAGE_KEY, loadSettings, saveSettings };

  if (typeof module !== "undefined") {
    module.exports = root.TailnetSettings;
  }
})(globalThis);
