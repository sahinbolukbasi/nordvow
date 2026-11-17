import fs from 'node:fs';
import path from 'node:path';
import type { AssistantSettings } from '../config/settings.js';

export interface CallUsage {
  callId: string;
  startedAt: string;
  sttSeconds: number;
  llmInputTokens: number;
  llmOutputTokens: number;
  ttsCharacters: number;
  estimatedCostUsd: number;
}

export interface MonthlyCostReport {
  month: string;
  totalCalls: number;
  totalSttMinutes: number;
  totalLlmTokens: number;
  totalTtsCharacters: number;
  totalCostUsd: number;
  budgetUsd: number;
  budgetUsedPercent: number;
  shouldUseEcoMode: boolean;
}

// Yaklaşık birim maliyetler (USD)
const RATES = {
  sttPerMinuteUsd: 0.0043, // Deepgram Nova-2
  llmInputPer1MTokensUsd: 0.15, // gpt-4o-mini / nova-lite
  llmOutputPer1MTokensUsd: 0.6,
  ttsElevenLabsFlashPer1KCharsUsd: 0.05,
  ttsElevenLabsMultilingualPer1KCharsUsd: 0.15,
  ttsPollyPer1KCharsUsd: 0.016,
};

/**
 * Çağrı bazlı ve aylık maliyeti hesaplar; bütçe eşiği aşıldığında uyarı/eko mod önerisi üretir.
 */
export class CostTracker {
  private readonly filePath: string;
  private calls: Map<string, CallUsage> = new Map();
  private persistedMonthlyUsd: Record<string, number> = {};
  private persistedMonthlyCalls: Record<string, number> = {};

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, 'cost-metrics.json');
    this.load();
  }

  private currentMonthKey(): string {
    return new Date().toISOString().slice(0, 7);
  }

  private load(): void {
    if (!fs.existsSync(this.filePath)) return;
    try {
      const data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      this.persistedMonthlyUsd = data.monthlyUsd || {};
      this.persistedMonthlyCalls = data.monthlyCalls || {};
    } catch {
      this.persistedMonthlyUsd = {};
      this.persistedMonthlyCalls = {};
    }
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(
      this.filePath,
      JSON.stringify(
        {
          monthlyUsd: this.persistedMonthlyUsd,
          monthlyCalls: this.persistedMonthlyCalls,
        },
        null,
        2
      ),
      'utf-8'
    );
  }

  startCall(callId: string): CallUsage {
    const usage: CallUsage = {
      callId,
      startedAt: new Date().toISOString(),
      sttSeconds: 0,
      llmInputTokens: 0,
      llmOutputTokens: 0,
      ttsCharacters: 0,
      estimatedCostUsd: 0,
    };
    this.calls.set(callId, usage);
    const month = this.currentMonthKey();
    this.persistedMonthlyCalls[month] =
      (this.persistedMonthlyCalls[month] || 0) + 1;
    this.save();
    return usage;
  }

  recordUsage(
    callId: string,
    delta: {
      sttSeconds?: number;
      llmInputTokens?: number;
      llmOutputTokens?: number;
      ttsCharacters?: number;
    },
    settings: AssistantSettings
  ): CallUsage {
    const usage = this.calls.get(callId) || this.startCall(callId);
    usage.sttSeconds += delta.sttSeconds || 0;
    usage.llmInputTokens += delta.llmInputTokens || 0;
    usage.llmOutputTokens += delta.llmOutputTokens || 0;
    usage.ttsCharacters += delta.ttsCharacters || 0;

    const prevCost = usage.estimatedCostUsd;
    usage.estimatedCostUsd = this.calculateCallCost(usage, settings);

    const diff = Math.max(0, usage.estimatedCostUsd - prevCost);
    const month = this.currentMonthKey();
    this.persistedMonthlyUsd[month] = Number(
      ((this.persistedMonthlyUsd[month] || 0) + diff).toFixed(6)
    );
    this.save();
    return usage;
  }

  private calculateCallCost(
    usage: CallUsage,
    settings: AssistantSettings
  ): number {
    const sttCost = (usage.sttSeconds / 60) * RATES.sttPerMinuteUsd;
    const llmCost =
      (usage.llmInputTokens / 1_000_000) * RATES.llmInputPer1MTokensUsd +
      (usage.llmOutputTokens / 1_000_000) * RATES.llmOutputPer1MTokensUsd;

    let ttsRate = RATES.ttsElevenLabsFlashPer1KCharsUsd;
    if (settings.voice.provider === 'polly') {
      ttsRate = RATES.ttsPollyPer1KCharsUsd;
    } else if (settings.voice.modelId === 'eleven_multilingual_v2') {
      ttsRate = RATES.ttsElevenLabsMultilingualPer1KCharsUsd;
    }
    const ttsCost = (usage.ttsCharacters / 1000) * ttsRate;

    return Number((sttCost + llmCost + ttsCost).toFixed(6));
  }

  isSingleCallOverLimit(callId: string, settings: AssistantSettings): boolean {
    if (!settings.features.costGuardEnabled) return false;
    const usage = this.calls.get(callId);
    if (!usage) return false;
    return usage.estimatedCostUsd >= settings.costLimits.maxSingleCallCostUsd;
  }

  getMonthlyReport(settings: AssistantSettings): MonthlyCostReport {
    const month = this.currentMonthKey();
    const totalCostUsd = Number((this.persistedMonthlyUsd[month] || 0).toFixed(4));
    const budgetUsd = settings.costLimits.maxMonthlyBudgetUsd;
    const budgetUsedPercent = Number(((totalCostUsd / budgetUsd) * 100).toFixed(2));

    let totalSttSeconds = 0;
    let totalLlmTokens = 0;
    let totalTtsCharacters = 0;
    for (const call of this.calls.values()) {
      totalSttSeconds += call.sttSeconds;
      totalLlmTokens += call.llmInputTokens + call.llmOutputTokens;
      totalTtsCharacters += call.ttsCharacters;
    }

    return {
      month,
      totalCalls: this.persistedMonthlyCalls[month] || 0,
      totalSttMinutes: Number((totalSttSeconds / 60).toFixed(2)),
      totalLlmTokens,
      totalTtsCharacters,
      totalCostUsd,
      budgetUsd,
      budgetUsedPercent,
      shouldUseEcoMode:
        settings.features.costGuardEnabled &&
        budgetUsedPercent >= settings.costLimits.autoSwitchToEcoAtPercent,
    };
  }
}

