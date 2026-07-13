/**
 * Audio utility functions for converting between formats.
 * Handles Float32Array (from VAD) → 16kHz mono PCM WAV (for Groq Whisper).
 */

/**
 * Convert Float32Array audio samples to a WAV Blob.
 * Resamples from source sample rate (typically 48kHz) to 16kHz mono.
 */
export function float32ToWav(
  samples: Float32Array,
  sourceSampleRate: number = 16000
): Blob {
  // Resample to 16kHz if needed
  const targetRate = 16000;
  let resampled: Float32Array;

  if (sourceSampleRate !== targetRate) {
    const ratio = sourceSampleRate / targetRate;
    const newLength = Math.round(samples.length / ratio);
    resampled = new Float32Array(newLength);
    for (let i = 0; i < newLength; i++) {
      const srcIndex = Math.min(Math.round(i * ratio), samples.length - 1);
      resampled[i] = samples[srcIndex];
    }
  } else {
    resampled = samples;
  }

  // Convert to 16-bit PCM
  const pcm = new Int16Array(resampled.length);
  for (let i = 0; i < resampled.length; i++) {
    const s = Math.max(-1, Math.min(1, resampled[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }

  // Build WAV file
  const wavBuffer = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(wavBuffer);

  // RIFF header
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + pcm.length * 2, true);
  writeString(view, 8, "WAVE");

  // fmt sub-chunk
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // Sub-chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, targetRate, true); // Sample rate
  view.setUint32(28, targetRate * 2, true); // Byte rate
  view.setUint16(32, 2, true); // Block align
  view.setUint16(34, 16, true); // Bits per sample

  // data sub-chunk
  writeString(view, 36, "data");
  view.setUint32(40, pcm.length * 2, true);

  // Write PCM data
  const pcmBytes = new Uint8Array(wavBuffer, 44);
  const pcmBuffer = new Uint8Array(pcm.buffer);
  pcmBytes.set(pcmBuffer);

  return new Blob([wavBuffer], { type: "audio/wav" });
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

/**
 * Calculate RMS (Root Mean Square) of audio samples for volume metering.
 */
export function calculateRMS(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

/**
 * Concatenate multiple Float32Arrays into a single Float32Array.
 * Used to accumulate speech frames for interim streaming chunks.
 */
export function concatFloat32Arrays(arrays: Float32Array[]): Float32Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Float32Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}
