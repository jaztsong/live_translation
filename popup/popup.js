const apiKeyInput = document.getElementById('apiKey');
const fontColorInput = document.getElementById('fontColor');
const fontSizeInput = document.getElementById('fontSize');
const saveBtn = document.getElementById('saveBtn');
const toggleBtn = document.getElementById('toggleBtn');
const statusEl = document.getElementById('status');
const revealBtn = document.getElementById('revealBtn');
const colorReadout = document.getElementById('colorReadout');
const audioDeviceSelect = document.getElementById('audioDevice');

const toggleLabel = toggleBtn.querySelector('.label');
const saveLabel = saveBtn.querySelector('.label');
const statusText = statusEl.querySelector('.status-text');

let isTranslating = false;

function setStatus(text, state) {
  statusText.textContent = text;
  statusEl.classList.remove('active', 'error');
  if (state) statusEl.classList.add(state);
}

// Populate the audio-input dropdown. Device labels are only available once
// microphone permission has been granted to the extension origin.
async function loadAudioDevices(selectedId) {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter((d) => d.kind === 'audioinput');

    // Reset to just the default option.
    audioDeviceSelect.innerHTML = '<option value="">System Default</option>';

    inputs.forEach((d, i) => {
      // Skip the synthetic "default"/"communications" aggregate entries — they
      // map to whatever the OS default is, which is the behavior of "System Default".
      if (d.deviceId === 'default' || d.deviceId === 'communications') return;
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || `Input ${i + 1}`;
      audioDeviceSelect.appendChild(opt);
    });

    // Restore the saved selection if that device is still present.
    if (selectedId && [...audioDeviceSelect.options].some((o) => o.value === selectedId)) {
      audioDeviceSelect.value = selectedId;
    }

    if (!inputs.some((d) => d.label)) {
      // No labels means permission hasn't been granted yet.
      audioDeviceSelect.options[0].textContent = 'System Default (start once to list devices)';
    }
  } catch (e) {
    // enumerateDevices unavailable — leave the default option in place.
  }
}

// Load saved settings and current state on popup open
async function init() {
  const settings = await chrome.storage.local.get(['apiKey', 'fontColor', 'fontSize', 'inputDeviceId']);
  if (settings.apiKey) apiKeyInput.value = settings.apiKey;
  if (settings.fontColor) fontColorInput.value = settings.fontColor;
  if (settings.fontSize) fontSizeInput.value = settings.fontSize;
  syncColorReadout();
  await loadAudioDevices(settings.inputDeviceId);

  // Query service worker for current state
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
    if (response && response.isTranslating) {
      isTranslating = true;
    }
  } catch (e) {
    // Service worker may not be ready
  }
  updateUI();
}

function updateUI() {
  if (isTranslating) {
    toggleLabel.textContent = 'Stop Translation';
    toggleBtn.classList.remove('primary');
    toggleBtn.classList.add('stop');
    setStatus('Translating', 'active');
  } else {
    toggleLabel.textContent = 'Start Translation';
    toggleBtn.classList.add('primary');
    toggleBtn.classList.remove('stop');
    setStatus('Idle', null);
  }
}

function syncColorReadout() {
  colorReadout.textContent = (fontColorInput.value || '#FFFFFF').toUpperCase();
}

fontColorInput.addEventListener('input', syncColorReadout);

audioDeviceSelect.addEventListener('change', () => {
  chrome.storage.local.set({ inputDeviceId: audioDeviceSelect.value });
  if (isTranslating) {
    // Re-capture with the newly selected device.
    chrome.runtime.sendMessage({ type: 'RESTART_CAPTURE' }).catch(() => {});
  }
});

revealBtn.addEventListener('click', () => {
  const show = apiKeyInput.type === 'password';
  apiKeyInput.type = show ? 'text' : 'password';
  revealBtn.classList.toggle('on', show);
});

saveBtn.addEventListener('click', async () => {
  const settings = {
    apiKey: apiKeyInput.value.trim(),
    fontColor: fontColorInput.value,
    fontSize: parseInt(fontSizeInput.value, 10) || 24,
    inputDeviceId: audioDeviceSelect.value
  };
  await chrome.storage.local.set(settings);

  // Notify service worker about settings change
  chrome.runtime.sendMessage({
    type: 'SETTINGS_UPDATED',
    settings: { fontColor: settings.fontColor, fontSize: settings.fontSize }
  }).catch(() => {});

  saveLabel.textContent = 'Saved ✓';
  saveBtn.classList.add('saved');
  setTimeout(() => {
    saveLabel.textContent = 'Save Settings';
    saveBtn.classList.remove('saved');
  }, 1500);
});

toggleBtn.addEventListener('click', async () => {
  if (isTranslating) {
    chrome.runtime.sendMessage({ type: 'STOP_TRANSLATION' }).catch(() => {});
    isTranslating = false;
  } else {
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
      setStatus('Enter an API key', 'error');
      return;
    }
    // Save API key and selected input device before starting
    await chrome.storage.local.set({ apiKey, inputDeviceId: audioDeviceSelect.value });

    // Check if microphone permission is already granted.
    // If not, open a dedicated tab to request it — the popup can't
    // show the browser permission prompt (it closes on focus loss).
    let micGranted = false;
    try {
      const perm = await navigator.permissions.query({ name: 'microphone' });
      micGranted = perm.state === 'granted';
    } catch (e) {
      // permissions.query may not support 'microphone' in all browsers
    }

    if (!micGranted) {
      setStatus('Requesting mic (new tab)…', null);
      chrome.tabs.create({ url: chrome.runtime.getURL('permissions/permissions.html') });
      // The permissions page will send MIC_PERMISSION_GRANTED → service worker
      // stores the apiKey and starts once permission is confirmed.
      chrome.runtime.sendMessage({ type: 'PENDING_START', apiKey }).catch(() => {});
      return;
    }

    chrome.runtime.sendMessage({ type: 'START_TRANSLATION', apiKey }).catch(() => {});
    isTranslating = true;
  }
  updateUI();
});

init();
