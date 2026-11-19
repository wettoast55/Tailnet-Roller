# Manifest field guide

`extension/manifest.json` must remain strict JSON because Edge reads it directly. Comments belong in this guide instead of inside the JSON file.

| Field | Purpose |
| --- | --- |
| `manifest_version: 3` | Use the browser's Manifest V3 extension format. |
| `name`, `version`, `description` | Show Tailnet Roller and its release information in Edge. |
| `permissions: activeTab` | Temporarily access the tab where the user opens the extension. |
| `permissions: scripting` | Inject the page controller into that tab after checking its URL. |
| `permissions: storage` | Save filters locally and migrate settings when updated. |
| `permissions: notifications` | Display a desktop notification when a match is found. |
| `action.default_popup` | Open `popup.html` when the toolbar icon is clicked. |
| `action.default_title` | Set the toolbar tooltip to Tailnet Roller. |
| `action.default_icon` | Provide the toolbar icons at the listed pixel sizes. |
| `background.service_worker` | Run `background.js` for badges and notifications. |
| `icons` | Provide app icons for Edge's extension-management screens. |

There are no persistent host permissions or automatically injected content scripts. The popup injects its controller only into an allowed HTTPS DNS page on `console.tailscale.com` or `login.tailscale.com`.
