import crypto from 'node:crypto';
import type WebSocket from 'ws';
import type { AssistantSettings, SettingsStore } from '../config/settings.js';
import type { CallLogStore } from '../services/call-log-store.js';
import type { CostTracker } from '../services/cost-tracker.js';
import type { AssistantTools } from '../tools/assistant-tools.js';
import { buildVoiceSystemPrompt } from './prompt-builder.js';
import {
  createDeepgramSttConnection,
  generateLlmReply,
  synthesizeSpeech,
  type ChatMessage,
} from './providers.js';

export interface CallSessionDeps {
  settingsStore: SettingsStore;
  costTracker: CostTracker;
  assistantTools: AssistantTools;
  callLogStore?: CallLogStore;
}

/**
 * Tek bir telefon görüşmesini (veya metin simülasyonunu) yöneten oturum sınıfı.
 * Söz kesme (barge-in), maliyet sınırı ve gerçek zamanlı ses akışını koordine eder.
 */
export class CallSession {
  readonly callId: string;
  private callerPhone?: string;
  private streamSid?: string;
  private readonly deps: CallSessionDeps;
  private readonly telephonyWs?: WebSocket;
  private sttWs: WebSocket | null = null;
  private history: ChatMessage[] = [];
  private activeTtsAbort: AbortController | null = null;
  private maxDurationTimer: NodeJS.Timeout | null = null;
  private closed = false;
  private lastCostUsd = 0;
  private transferred = false;

  constructor(
    deps: CallSessionDeps,
    telephonyWs?: WebSocket,
    callerPhone?: string
  ) {
    this.callId = crypto.randomUUID();
    this.deps = deps;
    this.telephonyWs = telephonyWs;
    this.callerPhone = callerPhone;
    this.deps.costTracker.startCall(this.callId);
    this.deps.callLogStore?.createCall(
      this.callId,
      telephonyWs ? 'phone' : 'simulation',
      callerPhone || 'Bilinmeyen Numara'
    );

    const settings = this.deps.settingsStore.get();
    this.history = [
      { role: 'system', content: buildVoiceSystemPrompt(settings) },
    ];
  }

  start(streamSid?: string, callerPhone?: string): void {
    this.streamSid = streamSid;
    if (callerPhone) this.callerPhone = callerPhone;

    const settings = this.deps.settingsStore.get();

    // Maksimum çağrı süresi koruması (açık kalan hatların maliyetini önler)
    this.maxDurationTimer = setTimeout(() => {
      void this.speak(
        'Görüşme süremizin sonuna geldik. Notlarınızı ekibimize ilettim, iyi günler dilerim.'
      ).finally(() => this.close());
    }, settings.conversation.maxCallDurationSeconds * 1000);

    if (this.telephonyWs) {
      this.sttWs = createDeepgramSttConnection(settings, {
        onSpeechStarted: () => {
          if (this.deps.settingsStore.get().features.bargeInEnabled) {
            this.interruptPlayback();
          }
        },
        onTranscriptFinal: (text, durationSec) => {
          this.deps.costTracker.recordUsage(
            this.callId,
            { sttSeconds: durationSec },
            this.deps.settingsStore.get()
          );
          void this.handleUserUtterance(text);
        },
        onError: (err) => {
          console.error(`[Call ${this.callId}] STT hatası:`, err.message);
        },
      });
    }

    // Karşılama mesajını seslendir
    void this.speak(settings.conversation.greetingMessage);
  }

  forwardIncomingAudio(base64MulawAudio: string): void {
    if (this.closed || !this.sttWs || this.sttWs.readyState !== 1) return;
    const audioBuffer = Buffer.from(base64MulawAudio, 'base64');
    this.sttWs.send(audioBuffer);
  }

  interruptPlayback(): void {
    if (this.activeTtsAbort) {
      this.activeTtsAbort.abort();
      this.activeTtsAbort = null;
    }
    if (this.telephonyWs && this.telephonyWs.readyState === 1 && this.streamSid) {
      this.telephonyWs.send(
        JSON.stringify({ event: 'clear', streamSid: this.streamSid })
      );
    }
  }

  async handleUserUtterance(text: string): Promise<string> {
    if (this.closed) return '';

    const settings = this.deps.settingsStore.get();
    const monthlyReport = this.deps.costTracker.getMonthlyReport(settings);

    if (this.deps.costTracker.isSingleCallOverLimit(this.callId, settings)) {
      const wrapUp =
        'Bu görüşme için süre limitine ulaştık, bilgilerinizi görevli ekibimize aktarıyorum. İyi günler.';
      await this.speak(wrapUp);
      this.close();
      return wrapUp;
    }

    this.history.push({ role: 'user', content: text });
    this.deps.callLogStore?.appendTurn(
      this.callId,
      'caller',
      text,
      this.lastCostUsd
    );

    // Bağlam penceresini son 12 mesajla sınırlayarak token maliyetini sabit tut
    if (this.history.length > 13) {
      this.history = [this.history[0], ...this.history.slice(-12)];
    }

    const tools = this.deps.assistantTools.getEnabledToolDefinitions(settings);
    const llmResult = await generateLlmReply(
      this.history,
      tools,
      this.deps.assistantTools,
      {
        callId: this.callId,
        callerPhone: this.callerPhone,
        settings,
        onTransferRequested: (payload) => {
          this.transferred = true;
          this.deps.callLogStore?.appendTurn(
            this.callId,
            'system',
            `Çağrı ${payload.targetNumber} numarasına aktarıldı (${payload.reason}).`,
            this.lastCostUsd
          );
          if (this.telephonyWs && this.telephonyWs.readyState === 1) {
            this.telephonyWs.send(
              JSON.stringify({
                event: 'transfer',
                streamSid: this.streamSid,
                ...payload,
              })
            );
          }
        },
      },
      monthlyReport.shouldUseEcoMode || settings.costProfile === 'eco'
    );

    const usage = this.deps.costTracker.recordUsage(
      this.callId,
      {
        llmInputTokens: llmResult.inputTokens,
        llmOutputTokens: llmResult.outputTokens,
      },
      settings
    );
    this.lastCostUsd = usage.estimatedCostUsd;

    const reply = llmResult.replyText;
    this.history.push({ role: 'assistant', content: reply });
    this.deps.callLogStore?.appendTurn(
      this.callId,
      'assistant',
      reply,
      this.lastCostUsd
    );

    if (this.telephonyWs) {
      await this.speak(reply);
    }

    return reply;
  }

  async speak(text: string): Promise<void> {
    if (this.closed || !text) return;
    const settings = this.deps.settingsStore.get();
    this.interruptPlayback();

    const controller = new AbortController();
    this.activeTtsAbort = controller;

    try {
      const audioBuffer = await synthesizeSpeech(
        text,
        settings,
        controller.signal
      );

      this.deps.costTracker.recordUsage(
        this.callId,
        { ttsCharacters: text.length },
        settings
      );

      if (
        audioBuffer.length > 0 &&
        this.telephonyWs &&
        this.telephonyWs.readyState === 1 &&
        this.streamSid
      ) {
        this.telephonyWs.send(
          JSON.stringify({
            event: 'media',
            streamSid: this.streamSid,
            media: { payload: audioBuffer.toString('base64') },
          })
        );
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error(`[Call ${this.callId}] TTS hatası:`, (err as Error).message);
      }
    } finally {
      if (this.activeTtsAbort === controller) {
        this.activeTtsAbort = null;
      }
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.interruptPlayback();
    this.deps.callLogStore?.finishCall(
      this.callId,
      this.transferred ? 'transferred' : 'completed',
      this.lastCostUsd
    );
    if (this.maxDurationTimer) {
      clearTimeout(this.maxDurationTimer);
      this.maxDurationTimer = null;
    }
    if (this.sttWs && this.sttWs.readyState === 1) {
      this.sttWs.close();
    }
  }
}

