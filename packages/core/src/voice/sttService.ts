/**
 * Amazon Transcribe Streaming (tr-TR) + VAD (Voice Activity Detection) soyutlaması.
 * KVS ses akışı ECS Fargate tüketicisi tarafından okunurken PCM 8kHz paketlerini
 * enerji eşiği (VAD) ile izler:
 *  - Arayan konuşmaya başladığında `onSpeechStart` (barge-in) tetiklenir ve çalan TTS durdurulur.
 *  - Sessizlik eşiği aşıldığında tam cümle Transcribe Streaming oturumundan alınır.
 */
export class VadStreamController {
  private speaking = false;
  private lastVoiceAt = 0;
  private readonly silenceThresholdMs: number;
  private readonly energyThreshold: number;

  constructor(opts: { silenceThresholdMs?: number; energyThreshold?: number } = {}) {
    this.silenceThresholdMs = opts.silenceThresholdMs ?? 700;
    this.energyThreshold = opts.energyThreshold ?? 450;
  }

  /** 16-bit PCM örnekleri için RMS enerji hesaplar; konuşma başlangıcında barge-in sinyali döner. */
  pushPcmFrame(pcm16: Int16Array, now = Date.now()): { bargeIn: boolean; endOfUtterance: boolean } {
    let sumSq = 0;
    for (let i = 0; i < pcm16.length; i++) {
      const v = pcm16[i]!;
      sumSq += v * v;
    }
    const rms = pcm16.length > 0 ? Math.sqrt(sumSq / pcm16.length) : 0;

    if (rms >= this.energyThreshold) {
      const wasSpeaking = this.speaking;
      this.speaking = true;
      this.lastVoiceAt = now;
      return { bargeIn: !wasSpeaking, endOfUtterance: false };
    }

    if (this.speaking && now - this.lastVoiceAt >= this.silenceThresholdMs) {
      this.speaking = false;
      return { bargeIn: false, endOfUtterance: true };
    }

    return { bargeIn: false, endOfUtterance: false };
  }
}

export function transcribeConfigForTr() {
  return {
    languageCode: "tr-TR" as const,
    mediaEncoding: "pcm" as const,
    mediaSampleRateHertz: 8000,
    enablePartialResultsStabilization: true,
    partialResultsStability: "high" as const,
  };
}

