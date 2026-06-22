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

async function ensureContentScript(tabId) {
  try {
    // Try sending a ping — if the content script is there, it will respond
    await chrome.tabs.sendMessage(tabId, { type: 'PING' });
  } catch (e) {
    // Content script not injected yet — inject it now
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content/content.js']
      });
      await chrome.scripting.insertCSS({
        target: { tabId },
        files: ['content/content.css']
      });
    } catch (injectionError) {
      console.error('Failed to inject content script:', injectionError);
    }
  }
}

async function handleStartTranslation(apiKey) {
  isTranslating = true;
  pendingApiKey = apiKey;

  // Capture the active tab as the target for overlay display
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      targetTabId = tab.id;
      await ensureContentScript(targetTabId);
    }
  } catch (e) {
    console.error('Failed to find active tab:', e);
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
