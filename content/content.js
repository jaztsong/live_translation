(() => {
  let overlayHost = null;
  let shadowRoot = null;
  let translationEl = null;
  let originalEl = null;
  let overlayContainer = null;

  // Store final sentences (keep last 3)
  const MAX_FINAL_SENTENCES = 3;
  let finalTranslations = [];
  let finalOriginals = [];
  let currentSettings = { fontColor: '#FFFFFF', fontSize: 24 };

  function createOverlay() {
    if (overlayHost) return;

    overlayHost = document.createElement('div');
    overlayHost.id = 'live-translation-overlay-host';
    shadowRoot = overlayHost.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; }

      .overlay {
        position: fixed;
        bottom: 56px;
        left: 50%;
        transform: translateX(-50%);
        min-width: 340px;
        max-width: 72vw;
        padding: 6px 14px;
        z-index: 2147483647;
        cursor: grab;
        user-select: none;
        font-family: "Avenir Next", "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif;
        background: transparent;
        animation: lt-in 0.42s cubic-bezier(0.16, 1, 0.3, 1);
      }

      @keyframes lt-in {
        from { opacity: 0; transform: translateX(-50%) translateY(16px); }
        to   { opacity: 1; transform: translateX(-50%) translateY(0); }
      }

      .overlay.dragging { cursor: grabbing; }

      .lt-head {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        margin-bottom: 6px;
        opacity: 0;
        transition: opacity 0.2s;
      }
      .overlay:hover .lt-head,
      .overlay.dragging .lt-head { opacity: 1; }

      .lt-live {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-family: "SF Mono", ui-monospace, Menlo, Consolas, monospace;
        font-size: 9px;
        font-weight: 600;
        letter-spacing: 0.24em;
        color: #3ef0b0;
        text-transform: uppercase;
        text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
      }

      .lt-live-dot {
        width: 6px; height: 6px;
        border-radius: 50%;
        background: #3ef0b0;
        box-shadow: 0 0 8px rgba(62, 240, 176, 0.9);
        animation: lt-pulse 1.5s ease-in-out infinite;
      }

      @keyframes lt-pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50%      { opacity: 0.35; transform: scale(0.78); }
      }

      .lt-grip { display: none; }

      .lt-body {
        text-align: center;
      }

      .translation {
        color: #FFFFFF;
        font-size: 24px;
        font-weight: 700;
        line-height: 1.32;
        letter-spacing: -0.01em;
        word-wrap: break-word;
        margin-bottom: 5px;
        /* Layered outline so white text stays legible on any background */
        text-shadow:
          0 0 1px rgba(0, 0, 0, 0.95),
          0 1px 2px rgba(0, 0, 0, 0.95),
          0 0 8px rgba(0, 0, 0, 0.85),
          0 2px 14px rgba(0, 0, 0, 0.7);
        paint-order: stroke fill;
        -webkit-text-stroke: 0.5px rgba(0, 0, 0, 0.55);
      }

      .translation.non-final::after {
        content: "";
        display: inline-block;
        width: 2px;
        height: 0.92em;
        margin-left: 3px;
        vertical-align: -0.1em;
        background: #3ef0b0;
        box-shadow: 0 0 8px rgba(62, 240, 176, 0.9);
        animation: lt-caret 1s steps(1) infinite;
      }

      @keyframes lt-caret { 50% { opacity: 0; } }

      .translation.non-final > span { opacity: 0.85; }

      .original {
        color: rgba(255, 255, 255, 0.78);
        font-size: 14px;
        font-weight: 500;
        line-height: 1.38;
        letter-spacing: 0.01em;
        word-wrap: break-word;
        text-shadow:
          0 0 1px rgba(0, 0, 0, 0.95),
          0 1px 2px rgba(0, 0, 0, 0.95),
          0 0 6px rgba(0, 0, 0, 0.8);
      }

      .original.non-final { opacity: 0.65; }
      .original:empty { display: none; }

      .sentence-history {
        opacity: 0.5;
        font-weight: 600;
        margin-bottom: 4px;
      }
      .original .sentence-history { font-weight: 500; opacity: 0.45; }
    `;

    overlayContainer = document.createElement('div');
    overlayContainer.className = 'overlay';

    // Header bar: LIVE indicator + drag grip
    const head = document.createElement('div');
    head.className = 'lt-head';
    const live = document.createElement('div');
    live.className = 'lt-live';
    live.innerHTML = '<span class="lt-live-dot"></span>LIVE · ZH→EN';
    const grip = document.createElement('div');
    grip.className = 'lt-grip';
    grip.innerHTML = '<i></i><i></i><i></i>';
    head.appendChild(live);
    head.appendChild(grip);

    const body = document.createElement('div');
    body.className = 'lt-body';

    translationEl = document.createElement('div');
    translationEl.className = 'translation';

    originalEl = document.createElement('div');
    originalEl.className = 'original';

    body.appendChild(translationEl);
    body.appendChild(originalEl);
    overlayContainer.appendChild(head);
    overlayContainer.appendChild(body);
    shadowRoot.appendChild(style);
    shadowRoot.appendChild(overlayContainer);
    document.body.appendChild(overlayHost);

    // Apply any settings captured before the overlay existed
    applySettings(currentSettings);

    setupDrag();
  }

  function setupDrag() {
    let isDragging = false;
    let offsetX = 0;
    let offsetY = 0;

    overlayContainer.addEventListener('mousedown', (e) => {
      isDragging = true;
      overlayContainer.classList.add('dragging');
      const rect = overlayContainer.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      // Remove the transform so we can position freely
      overlayContainer.style.transform = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      overlayContainer.style.left = (e.clientX - offsetX) + 'px';
      overlayContainer.style.top = (e.clientY - offsetY) + 'px';
      overlayContainer.style.bottom = 'auto';
      e.preventDefault();
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        overlayContainer.classList.remove('dragging');
      }
    });
  }

  function updateTranslation(data) {
    createOverlay();

    if (data.isFinal && (data.translation || data.original)) {
      if (data.translation) finalTranslations.push(data.translation);
      if (data.original) finalOriginals.push(data.original);

      // Keep only last N final sentences
      if (finalTranslations.length > MAX_FINAL_SENTENCES) {
        finalTranslations = finalTranslations.slice(-MAX_FINAL_SENTENCES);
      }
      if (finalOriginals.length > MAX_FINAL_SENTENCES) {
        finalOriginals = finalOriginals.slice(-MAX_FINAL_SENTENCES);
      }

      // Show history + current final
      translationEl.innerHTML = '';
      originalEl.innerHTML = '';

      // History (older sentences)
      if (finalTranslations.length > 1) {
        const historyDiv = document.createElement('div');
        historyDiv.className = 'sentence-history';
        historyDiv.textContent = finalTranslations.slice(0, -1).join(' ');
        translationEl.appendChild(historyDiv);
      }
      // Current final
      const currentSpan = document.createElement('span');
      currentSpan.textContent = finalTranslations[finalTranslations.length - 1] || '';
      translationEl.appendChild(currentSpan);
      translationEl.classList.remove('non-final');

      // Original text
      if (finalOriginals.length > 1) {
        const historyDiv = document.createElement('div');
        historyDiv.className = 'sentence-history';
        historyDiv.textContent = finalOriginals.slice(0, -1).join(' ');
        originalEl.appendChild(historyDiv);
      }
      const origSpan = document.createElement('span');
      origSpan.textContent = finalOriginals[finalOriginals.length - 1] || '';
      originalEl.appendChild(origSpan);
      originalEl.classList.remove('non-final');

    } else {
      // Non-final (interim) result
      translationEl.innerHTML = '';
      originalEl.innerHTML = '';

      // Show history
      if (finalTranslations.length > 0) {
        const historyDiv = document.createElement('div');
        historyDiv.className = 'sentence-history';
        historyDiv.textContent = finalTranslations.join(' ');
        translationEl.appendChild(historyDiv);
      }
      // Current interim
      const currentSpan = document.createElement('span');
      currentSpan.textContent = data.translation || '';
      translationEl.appendChild(currentSpan);
      translationEl.classList.add('non-final');

      if (finalOriginals.length > 0) {
        const historyDiv = document.createElement('div');
        historyDiv.className = 'sentence-history';
        historyDiv.textContent = finalOriginals.join(' ');
        originalEl.appendChild(historyDiv);
      }
      const origSpan = document.createElement('span');
      origSpan.textContent = data.original || '';
      originalEl.appendChild(origSpan);
      originalEl.classList.add('non-final');
    }
  }

  function applySettings(settings) {
    currentSettings = { ...currentSettings, ...settings };
    if (translationEl) {
      translationEl.style.color = currentSettings.fontColor;
      translationEl.style.fontSize = currentSettings.fontSize + 'px';
    }
  }

  function removeOverlay() {
    if (overlayHost) {
      overlayHost.remove();
      overlayHost = null;
      shadowRoot = null;
      translationEl = null;
      originalEl = null;
      overlayContainer = null;
      finalTranslations = [];
      finalOriginals = [];
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case 'PING':
        sendResponse({ ok: true });
        break;
      case 'TRANSLATION_UPDATE':
        updateTranslation(message.data);
        if (message.settings) {
          applySettings(message.settings);
        }
        break;
      case 'SETTINGS_UPDATED':
        applySettings(message.settings);
        break;
      case 'STOP_OVERLAY':
        removeOverlay();
        break;
    }
  });
})();
