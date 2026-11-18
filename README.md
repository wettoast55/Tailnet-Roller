# Tailnet Roller

A small local Edge/Chrome extension that reads the selectable Tailscale tailnet names, rerolls when no name satisfies your filters, and stops with a desktop notification when one does.

## Install in Edge

1. Extract the ZIP to a permanent folder. Keep the extracted folder after installation.
2. Type `edge://extensions` into Edge's address bar.
3. Turn on **Developer mode**, then click **Load unpacked**.
4. Select this package's **extension** subfolder, which contains `manifest.json`.
5. Return to `https://console.tailscale.com/admin/dns`, leaving the Rename tailnet dialog open. Open **Tailnet Finder** from Edge's Extensions menu.

Chrome uses `chrome://extensions` with the same steps. The extension is activated when you open it on the Tailscale page; a page refresh is not required for first use.

## Use it

1. Enter your phrases and/or word-length requirements.
2. Click **Check only**. Confirm the displayed names agree with the four generated options on your Tailscale screen. This sends no rerolls.
3. Click **Start search**. The current set is always checked first. The default delay is 5 seconds, with a 200-reroll limit.
4. You can close the extension popup. Keep the Tailscale tab and name dialog open. Reopen the extension to see progress or click **Pause**. Escape on the Tailscale page also pauses.
5. A match stops the search, highlights the matching name, changes the tab title, and sends a desktop notification. Select and confirm the name yourself in Tailscale.

Click **Test notification** under Timing & notifications to check Windows notifications. Windows Do Not Disturb can suppress notification banners or sounds. The green highlights and extension badge remain available.

## Filter examples

| Goal | Settings |
| --- | --- |
| Both words at most 4 characters | Click **Both ≤4** |
| At least one word at most 3 characters | Click **Either ≤3** |
| A name containing the word `fox` or `cat` | Enter `fox, cat`; choose **Whole word / phrase**, **Any listed phrase**; turn off length filtering |
| The exact pair `blue-fox` | Enter `blue fox`; select **Exact name / word**, **Anywhere in name**; turn off lengths |
| `fox` plus short words | Enter `fox`, set the length bounds, choose **Require BOTH filters** |
| `fox` or any short name | Enter `fox`, set the length bounds, choose **Accept EITHER filter** |
| Exactly 3 letters then exactly 4 | First minimum/maximum `3`/`3`; second `4`/`4`; require both words |

Phrases are separated by commas or newlines. Matching ignores case; spaces and hyphens are equivalent in phrases. Whole-word matching distinguishes `fox` from `foxtrot`; Contains text does not. Exclusions are substring checks against the whole name and always take priority. Total maximum counts the hyphen and excludes `.ts.net`: `blue-fox.ts.net` has a total length of 8.

## Sources

- [Tailscale tailnet names documentation](https://tailscale.com/docs/concepts/tailnet-name)
- [Microsoft: Load an unpacked Edge extension](https://learn.microsoft.com/en-us/microsoft-edge/extensions/getting-started/extension-sideloading)
- [Chrome: activeTab permission](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)

This extension is not affiliated with Tailscale.
