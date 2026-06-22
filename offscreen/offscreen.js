let audioContext = null;
let mediaStream = null;
let workletNode = null;
let websocket = null;
let keepaliveInterval = null;
let currentApiKey = null;

const SONIOX_WS_URL = 'wss://stt-rt.soniox.com/transcribe-websocket';

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'START_CAPTURE') {
    startCapture(message.apiKey);
  } else if (message.type === 'STOP_CAPTURE') {
    stopCapture();
  } else if (message.type === 'RESTART_CAPTURE') {
    // Device changed mid-session — tear down and re-capture with the new device.
    (async () => {
      const apiKey = currentApiKey;
      await stopCapture();
      if (apiKey) startCapture(apiKey);
    })();
  }
});

// Build the audio constraint from the user-selected input device.
async function getAudioConstraint() {
  const audio = { channelCount: 1 };
  try {
    const { inputDeviceId } = await chrome.storage.local.get('inputDeviceId');
    if (inputDeviceId) audio.deviceId = { exact: inputDeviceId };
  } catch (e) {}
  return audio;
}

async function openMicStream() {
  const audio = await getAudioConstraint();
  try {
    return await navigator.mediaDevices.getUserMedia({ audio });
  } catch (err) {
    // The chosen device may be unplugged/unavailable — fall back to the default.
    if (audio.deviceId && (err.name === 'OverconstrainedError' || err.name === 'NotFoundError')) {
      console.warn('Selected audio device unavailable, falling back to default:', err.name);
      return await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
    }
    throw err;
  }
}

// Signal to the service worker that the offscreen document is ready
chrome.runtime.sendMessage({ type: 'OFFSCREEN_READY' }).catch(() => {});

async function startCapture(apiKey) {
  try {
    currentApiKey = apiKey;
    // 1. Get microphone access for the selected input device
    mediaStream = await openMicStream();

    // 2. Create AudioContext and load worklet
    audioContext = new AudioContext();
    await audioContext.audioWorklet.addModule(
      chrome.runtime.getURL('offscreen/pcm-processor.js')
    );

    // 3. Connect microphone to worklet
    const source = audioContext.createMediaStreamSource(mediaStream);
    workletNode = new AudioWorkletNode(audioContext, 'pcm-processor');

    // 4. Open WebSocket
    websocket = new WebSocket(SONIOX_WS_URL);

    websocket.onopen = () => {
      // Send config message
      const config = {
        api_key: apiKey,
        model: 'stt-rt-v5',
        audio_format: 'pcm_s16le',
        sample_rate: 16000,
        num_channels: 1,
        language_hints: ['zh'],
        translation: {
          type: 'one_way',
          target_language: 'en'
        },
        enable_endpoint_detection: true,
        endpoint_latency_adjustment_level: 1,
        endpoint_sensitivity: 0.5,
        max_endpoint_delay_ms: 800
      };
      websocket.send(JSON.stringify(config));

      // Connect audio pipeline after WebSocket is ready
      source.connect(workletNode);
      workletNode.connect(audioContext.destination);

      // Stream PCM data from worklet to WebSocket
      workletNode.port.onmessage = (event) => {
        if (websocket && websocket.readyState === WebSocket.OPEN) {
          websocket.send(event.data);
        }
      };
    };

    websocket.onmessage = (event) => {
      try {
        const response = JSON.parse(event.data);
        if (response.finished) {
          return;
        }
        if (response.tokens && response.tokens.length > 0) {
          processTokens(response.tokens);
        }
      } catch (e) {
        console.error('Failed to parse WebSocket message:', e);
      }
    };

    websocket.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    websocket.onclose = () => {
      console.log('WebSocket closed');
    };

    // 5. Keepalive ping every 25s to prevent service worker termination
    keepaliveInterval = setInterval(() => {
      chrome.runtime.sendMessage({ type: 'KEEPALIVE' }).catch(() => {});
    }, 25000);

  } catch (error) {
    console.error('Failed to start capture:', error.name, error.message);
  }
}

function processTokens(tokens) {
  let original = '';
  let translation = '';
  let isFinal = false;

  for (const token of tokens) {
    if (token.translation_status === 'translation') {
      translation += token.text;
    } else {
      original += token.text;
    }
    if (token.is_final) {
      isFinal = true;
    }
  }

  chrome.runtime.sendMessage({
    type: 'TRANSLATION_RESULT',
    data: {
      original: original.trim(),
      translation: translation.trim(),
      isFinal
    }
  }).catch(() => {});
}

async function stopCapture() {
  currentApiKey = null;
  // Clear keepalive
  if (keepaliveInterval) {
    clearInterval(keepaliveInterval);
    keepaliveInterval = null;
  }

  // Send empty frame to signal end of audio
  if (websocket && websocket.readyState === WebSocket.OPEN) {
    websocket.send(new ArrayBuffer(0));
  }

  // Disconnect worklet
  if (workletNode) {
    workletNode.disconnect();
    workletNode = null;
  }

  // Stop media tracks
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }

  // Close audio context
  if (audioContext) {
    await audioContext.close();
    audioContext = null;
  }

  // Close WebSocket
  if (websocket) {
    websocket.close();
    websocket = null;
  }
}
