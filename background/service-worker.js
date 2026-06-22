let isTranslating = false;
let pendingApiKey = null;
let pendingPermissionApiKey = null;
// The tab ID where the overlay should be shown
let targetTabId = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'GET_STATE':
      sendResponse({ isTranslating });
      return false;

    case 'START_TRANSLATION':
      handleStartTranslation(message.apiKey);
      return false;

    case 'STOP_TRANSLATION':
      handleStopTranslation();
      return false;

    case 'PENDING_START':
      pendingPermissionApiKey = message.apiKey;
      return false;

    case 'MIC_PERMISSION_GRANTED':
      if (pendingPermissionApiKey) {
        handleStartTranslation(pendingPermissionApiKey);
        pendingPermissionApiKey = null;
      }
      return false;

    case 'OFFSCREEN_READY':
      if (pendingApiKey) {
        chrome.runtime.sendMessage({
          type: 'START_CAPTURE',
          apiKey: pendingApiKey
        }).catch(() => {});
        pendingApiKey = null;
      }
      return false;

    case 'TRANSLATION_RESULT':
      relayTranslationToContentScript(message.data);
      return false;

    case 'SETTINGS_UPDATED':
      relaySettingsToContentScript(message.settings);
      return false;

    case 'KEEPALIVE':
      return false;

    default:
      return false;
  }
});

// Pages where extensions are not allowed to inject scripts.
function isInjectableUrl(url) {
  if (!url) return false;
  return /^https?:\/\//.test(url) || url.startsWith('file://');
}

// Pick the best tab to show the overlay on: the active tab if it's a normal
// web page, otherwise the most recently active injectable tab in the window.
async function findOverlayTab() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active && isInjectableUrl(active.url)) return active;

  const candidates = await chrome.tabs.query({ currentWindow: true });
  const injectable = candidates
    .filter((t) => isInjectableUrl(t.url))
    .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  return injectable[0] || null;
}

async function ensureContentScript(tabId) {
  try {
    // Try sending a ping — if the content script is there, it will respond
    await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    return true;
  } catch (e) {
    // Content script not present — check whether this tab can be injected at all
    let tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch (_) {}

    if (!isInjectableUrl(tab?.url)) {
      console.warn(
        `Live Translation: cannot show overlay on this page (${tab?.url || 'unknown URL'}). ` +
        `Switch to a normal web page (http/https) and start again.`
      );
      return false;
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content/content.js']
      });
      await chrome.scripting.insertCSS({
        target: { tabId },
        files: ['content/content.css']
      });
      return true;
    } catch (injectionError) {
      console.error(
        `Failed to inject content script into ${tab?.url || 'tab ' + tabId}:`,
        injectionError?.message || injectionError
      );
      return false;
    }
  }
}

async function handleStartTranslation(apiKey) {
  isTranslating = true;
  pendingApiKey = apiKey;

  // Capture a target tab for the overlay. Prefer the active tab, but if it's a
  // restricted page (e.g. the mic-permission tab opened during the start flow),
  // fall back to the most recently active normal web page.
  try {
    const targetTab = await findOverlayTab();
    if (targetTab?.id) {
      targetTabId = targetTab.id;
      await ensureContentScript(targetTabId);
    } else {
      console.warn('Live Translation: no normal web page found to show the overlay on.');
    }
  } catch (e) {
    console.error('Failed to find target tab:', e);
  }

  // Create offscreen document
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen/offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Capture microphone audio for real-time translation'
    });
  } catch (e) {
    if (e.message.includes('already exists')) {
      chrome.runtime.sendMessage({
        type: 'START_CAPTURE',
        apiKey
      }).catch(() => {});
      pendingApiKey = null;
    } else {
      console.error('Failed to create offscreen document:', e);
      isTranslating = false;
      pendingApiKey = null;
    }
  }
}

async function handleStopTranslation() {
  isTranslating = false;
  pendingApiKey = null;

  chrome.runtime.sendMessage({ type: 'STOP_CAPTURE' }).catch(() => {});

  // Remove overlay from target tab
  if (targetTabId) {
    chrome.tabs.sendMessage(targetTabId, { type: 'STOP_OVERLAY' }).catch(() => {});
    targetTabId = null;
  }

  setTimeout(async () => {
    try {
      await chrome.offscreen.closeDocument();
    } catch (e) {}
  }, 500);
}

async function relayTranslationToContentScript(data) {
  // If no target tab was stored, try the active tab
  let tabId = targetTabId;
  if (!tabId) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      tabId = tab?.id;
    } catch (e) {
      return;
    }
  }
  if (!tabId) return;

  try {
    const settings = await chrome.storage.local.get(['fontColor', 'fontSize']);
    chrome.tabs.sendMessage(tabId, {
      type: 'TRANSLATION_UPDATE',
      data,
      settings: {
        fontColor: settings.fontColor || '#FFFFFF',
        fontSize: settings.fontSize || 24
      }
    }).catch(() => {});
  } catch (e) {}
}

async function relaySettingsToContentScript(settings) {
  let tabId = targetTabId;
  if (!tabId) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      tabId = tab?.id;
    } catch (e) {
      return;
    }
  }
  if (!tabId) return;

  chrome.tabs.sendMessage(tabId, {
    type: 'SETTINGS_UPDATED',
    settings
  }).catch(() => {});
}
