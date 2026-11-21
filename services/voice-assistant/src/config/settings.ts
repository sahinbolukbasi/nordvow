import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

export const CostProfileSchema = z.enum(['eco', 'balanced', 'premium']);
export type CostProfile = z.infer<typeof CostProfileSchema>;

export const AssistantSettingsSchema = z.object({
  businessName: z.string().min(1).default('Müşteri Hizmetleri'),
  costProfile: CostProfileSchema.default('balanced'),
  features: z.object({
    knowledgeBaseEnabled: z.boolean().default(true),
    reservationsEnabled: z.boolean().default(true),
    staffNotesEnabled: z.boolean().default(true),
    callTransferEnabled: z.boolean().default(true),
    bargeInEnabled: z.boolean().default(true),
    costGuardEnabled: z.boolean().default(true),
  }),
  conversation: z.object({
    greetingMessage: z
      .string()
      .min(1)
      .default(
        'Merhaba, hoş geldiniz. Size nasıl yardımcı olabilirim?'
      ),
    maxResponseSentences: z.number().int().min(1).max(6).default(2),
    maxResponseTokens: z.number().int().min(40).max(500).default(120),
    silenceTimeoutMs: z.number().int().min(300).max(2500).default(700),
    maxCallDurationSeconds: z.number().int().min(30).max(1800).default(300),
  }),
  voice: z.object({
    provider: z.enum(['elevenlabs', 'polly', 'mock']).default('elevenlabs'),
    voiceId: z.string().default('EXAVITQu4vr4xnSDxMaL'),
    modelId: z.string().default('eleven_flash_v2_5'),
    stability: z.number().min(0).max(1).default(0.45),
    similarityBoost: z.number().min(0).max(1).default(0.8),
    speed: z.number().min(0.7).max(1.3).default(1.0),
  }),
  costLimits: z.object({
    maxMonthlyBudgetUsd: z.number().positive().default(50),
    autoSwitchToEcoAtPercent: z.number().min(50).max(100).default(85),
    maxSingleCallCostUsd: z.number().positive().default(0.5),
  }),
  staffNotifications: z.object({
    transferPhoneNumber: z.string().default(''),
    webhookUrl: z.string().default(''),
  }),
  telephony: z
    .object({
      personalMobileNumber: z.string().default('05348987073'),
      virtualForwardingNumber: z.string().default(''),
    })
    .default({
      personalMobileNumber: '05348987073',
      virtualForwardingNumber: '',
    }),
});

export type AssistantSettings = z.infer<typeof AssistantSettingsSchema>;

export const PartialAssistantSettingsSchema = z.object({
  businessName: z.string().min(1).optional(),
  costProfile: CostProfileSchema.optional(),
  features: AssistantSettingsSchema.shape.features.partial().optional(),
  conversation: AssistantSettingsSchema.shape.conversation.partial().optional(),
  voice: AssistantSettingsSchema.shape.voice.partial().optional(),
  costLimits: AssistantSettingsSchema.shape.costLimits.partial().optional(),
  staffNotifications: AssistantSettingsSchema.shape.staffNotifications
    .partial()
    .optional(),
  telephony: z
    .object({
      personalMobileNumber: z.string().optional(),
      virtualForwardingNumber: z.string().optional(),
    })
    .optional(),
});

export type PartialAssistantSettings = z.infer<
  typeof PartialAssistantSettingsSchema
>;

/**
 * Maliyet profiline göre önerilen model ve ses ayarlarını uygular.
 */
export function applyCostProfileDefaults(
  settings: AssistantSettings,
  profile: CostProfile
): AssistantSettings {
  if (profile === 'eco') {
    return {
      ...settings,
      costProfile: 'eco',
      conversation: {
        ...settings.conversation,
        maxResponseSentences: 2,
        maxResponseTokens: 90,
      },
      voice: {
        ...settings.voice,
        provider: 'polly',
        modelId: 'generative',
      },
    };
  }

  if (profile === 'premium') {
    return {
      ...settings,
      costProfile: 'premium',
      conversation: {
        ...settings.conversation,
        maxResponseSentences: 3,
        maxResponseTokens: 180,
      },
      voice: {
        ...settings.voice,
        provider: 'elevenlabs',
        modelId: 'eleven_multilingual_v2',
      },
    };
  }

  return {
    ...settings,
    costProfile: 'balanced',
    conversation: {
      ...settings.conversation,
      maxResponseSentences: 2,
      maxResponseTokens: 120,
    },
    voice: {
      ...settings.voice,
      provider: 'elevenlabs',
      modelId: 'eleven_flash_v2_5',
    },
  };
}

/**
 * Çalışma anında güncellenebilen ve diske kaydedilen ayar yöneticisi.
 */
export class SettingsStore {
  private settings: AssistantSettings;
  private readonly filePath: string;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, 'settings.json');
    this.settings = this.loadInitialSettings();
  }

  private loadInitialSettings(): AssistantSettings {
    const envProfile = CostProfileSchema.safeParse(process.env.COST_PROFILE);
    const base = AssistantSettingsSchema.parse({
      businessName: process.env.BUSINESS_NAME || 'Müşteri Hizmetleri',
      costProfile: envProfile.success ? envProfile.data : 'balanced',
      features: {},
      conversation: {
        maxCallDurationSeconds: Number(
          process.env.MAX_CALL_DURATION_SECONDS || 300
        ),
      },
      voice: {
        voiceId: process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL',
        modelId: process.env.ELEVENLABS_MODEL_ID || 'eleven_flash_v2_5',
      },
      costLimits: {
        maxMonthlyBudgetUsd: Number(process.env.MAX_MONTHLY_BUDGET_USD || 50),
      },
      staffNotifications: {
        transferPhoneNumber: process.env.STAFF_TRANSFER_NUMBER || '',
        webhookUrl: process.env.STAFF_WEBHOOK_URL || '',
      },
    });

    if (fs.existsSync(this.filePath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
        return AssistantSettingsSchema.parse({ ...base, ...raw });
      } catch {
        return applyCostProfileDefaults(base, base.costProfile);
      }
    }

    return applyCostProfileDefaults(base, base.costProfile);
  }

  get(): AssistantSettings {
    return structuredClone(this.settings);
  }

  update(patch: PartialAssistantSettings): AssistantSettings {
    const parsedPatch = PartialAssistantSettingsSchema.parse(patch);

    const baseWithProfile = parsedPatch.costProfile
      ? applyCostProfileDefaults(this.settings, parsedPatch.costProfile)
      : this.settings;

    const merged: AssistantSettings = AssistantSettingsSchema.parse({
      ...baseWithProfile,
      ...parsedPatch,
      features: { ...baseWithProfile.features, ...parsedPatch.features },
      conversation: {
        ...baseWithProfile.conversation,
        ...parsedPatch.conversation,
      },
      voice: { ...baseWithProfile.voice, ...parsedPatch.voice },
      costLimits: { ...baseWithProfile.costLimits, ...parsedPatch.costLimits },
      staffNotifications: {
        ...baseWithProfile.staffNotifications,
        ...parsedPatch.staffNotifications,
      },
      telephony: {
        ...baseWithProfile.telephony,
        ...parsedPatch.telephony,
      },
    });

    this.settings = merged;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(merged, null, 2), 'utf-8');
    return this.get();
  }
}
