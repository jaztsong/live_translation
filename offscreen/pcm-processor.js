class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    this._targetSampleRate = 16000;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channelData = input[0]; // mono channel
    const sourceSampleRate = sampleRate; // global in AudioWorklet scope
    const ratio = sourceSampleRate / this._targetSampleRate;

    // Downsample via linear interpolation
    const outputLength = Math.floor(channelData.length / ratio);
    const int16 = new Int16Array(outputLength);

    for (let i = 0; i < outputLength; i++) {
      const srcIndex = i * ratio;
      const lower = Math.floor(srcIndex);
      const upper = Math.min(lower + 1, channelData.length - 1);
      const frac = srcIndex - lower;
      const sample = channelData[lower] * (1 - frac) + channelData[upper] * frac;
      // Clamp and convert to Int16
      int16[i] = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)));
    }

    this.port.postMessage(int16.buffer, [int16.buffer]);
    return true;
  }
}

registerProcessor('pcm-processor', PCMProcessor);
