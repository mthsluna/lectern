# Lectern for the browser

The Lectern timer in your toolbar, for Chrome, Edge and Brave. While you study,
the icon shows today's hours.

It works on its own, keeping time in your browser. When the Lectern app for
Windows is installed on the same computer, the extension links to it by itself:
it shows the app's clock and week, and its buttons run in the app, even while
the app sits in the tray. The app keeps the data.

## Site blocker

While the timer runs, the sites on your list are blocked; a break or Stop opens them
again. Linked to the app, the list lives in the app's **Settings**; on its own, in the
extension's options. Blocking uses the browser's `declarativeNetRequest` rules, which
never read your pages. If you allow access to sites (optional), a calm Lectern page
replaces the blocked one and tabs already open on a blocked site switch to it;
otherwise the browser shows its own "blocked" page.

## Install

1. Download [**Lectern-Extension.zip**](https://github.com/mthsluna/lectern/releases/latest/download/Lectern-Extension.zip) and unzip it into a folder you will keep.
2. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`) and turn on **Developer mode**.
3. Click **Load unpacked** and choose that folder. Pin Lectern to the toolbar.

To link it, install the [Lectern app](https://github.com/mthsluna/lectern/releases/latest/download/Lectern-Setup.exe)
(1.19 or later) and open it once. The popup then says **Linked**.

## How the link works

The browser and the app talk through native messaging, the browser's own channel
for desktop apps. Lectern registers itself for Chrome, Edge, Brave and Chromium
under `HKEY_CURRENT_USER`, and only this extension
(`lfdloaajmppgncbnlknlkpgenfaopedh`) is allowed to reach it. Nothing goes over
the network.

When the popup opens, the browser starts `lectern.exe` as a small bridge. It reads
the saved study data for the popup, and passes buttons on to the running app
(`lectern.exe --remote start|pause|resume|stop`). If the app is not running, it
starts quietly in the tray.

Time kept by the extension on its own stays in the browser; it is not merged into
the app.

## Files

| File | Role |
| :-- | :-- |
| `manifest.json` | Manifest V3; the fixed `key` gives the extension its ID |
| `core.js` | The study model, the same as the app's |
| `popup.html`, `popup.css`, `popup.js` | The popup |
| `background.js` | Keeps the toolbar badge current |
| `i18n.js`, `icons/`, `fonts/` | Copied from the app by `npm run build:extension` |
