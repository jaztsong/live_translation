# Live Chinese-to-English Translation

A Chrome extension that captures microphone audio, transcribes Chinese speech in real time, and overlays live English captions on any web page — powered by the [Soniox](https://soniox.com) real-time speech-to-text API.

## Requirements

- **Google Chrome** (or any Chromium-based browser, e.g. Edge or Brave) with support for Manifest V3 extensions.
- **A Soniox API key.** Sign up at [console.soniox.com](https://console.soniox.com) and create an API key from the dashboard.
- **A microphone**, and permission to use it.

## Installation

This extension is not published to the Chrome Web Store. Install it manually as an unpacked extension:

1. **Get the code.** Clone or download this repository to a folder on your computer:

   ```bash
   git clone https://github.com/jaztsong/live_translation
   ```

   Keep the folder somewhere permanent — Chrome loads the extension from this location each time the browser starts.

2. **Open the Extensions page.** In Chrome, go to `chrome://extensions` (type it into the address bar and press Enter).

3. **Enable Developer mode.** Toggle the **Developer mode** switch in the top-right corner.

4. **Load the extension.** Click **Load unpacked** and select the project folder — the one containing `manifest.json`.

5. **Pin it (optional).** Click the puzzle-piece icon in the toolbar and pin **Live Chinese-to-English Translation** so it's always one click away.

The extension is now installed.

## Setup

1. Click the extension icon to open the popup.
2. Paste your **Soniox API key** into the *API Key* field.
3. Optionally adjust the **Caption Color** and **Size**.
4. Click **Save Settings**. Your key and preferences are stored locally in the browser (`chrome.storage.local`) and are never sent anywhere except to Soniox.

## Usage

1. Open the popup and click **Start Translation**.
2. The first time you start, Chrome opens a tab requesting **microphone access** — click **Allow**. (Grant is remembered for next time.)
3. Speak Chinese (or play Chinese audio near the mic). English captions appear as an overlay on the active page.
4. Click **Stop Translation** to end the session.

## Permissions

The extension requests the following:

| Permission | Why |
|------------|-----|
| `offscreen` | Runs an offscreen document to capture audio and hold the WebSocket connection. |
| `storage` | Saves your API key and caption preferences locally. |
| `activeTab`, `scripting`, `tabs` | Injects the caption overlay into the page you're viewing. |
| Microphone | Captures the speech to transcribe. |

## Updating

After pulling new changes, return to `chrome://extensions` and click the **reload** (↻) icon on the extension card to apply them.

## Troubleshooting

- **No captions appear** — Confirm your API key is saved and valid, and that microphone permission was granted. Check the page's DevTools console and the extension's service-worker logs (via `chrome://extensions` → **Service worker**) for errors.
- **Microphone prompt never showed** — Open `chrome://settings/content/microphone` and make sure access isn't blocked for the extension's permission page.
- **Captions stopped after a while** — Chrome may suspend the background worker; click **Stop** then **Start** to reconnect.
