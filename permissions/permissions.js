const statusEl = document.getElementById('status');

(async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(t => t.stop());
    statusEl.textContent = 'Microphone access granted! This tab will close...';
    statusEl.classList.add('granted');
    // Notify the service worker that permission was granted
    chrome.runtime.sendMessage({ type: 'MIC_PERMISSION_GRANTED' }).catch(() => {});
    setTimeout(() => window.close(), 1200);
  } catch (e) {
    statusEl.textContent = 'Permission denied. Please try again and click "Allow".';
    statusEl.classList.add('denied');
  }
})();
