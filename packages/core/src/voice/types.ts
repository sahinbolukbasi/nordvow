import { z } from "zod";

export const routingRuleSchema = z.object({
  id: z.string(),
  keyword: z.string().min(1).max(80),
  label: z.string().min(1).max(80),
  targetType: z.enum(["queue", "external_number", "callback"]),
  targetValue: z.string().min(1).max(80),
});

export type VoiceRoutingRule = z.infer<typeof routingRuleSchema>;

export const businessHoursSchema = z.object({
  timezone: z.string().default("Europe/Istanbul"),
  days: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5]),
  start: z.string().regex(/^\d{2}:\d{2}$/).default("09:00"),
  end: z.string().regex(/^\d{2}:\d{2}$/).default("18:00"),
  afterHoursMessage: z
    .string()
    .max(500)
    .default("Şu anda mesai saatlerimiz dışındayız. Adınızı ve konunuzu bırakırsanız mesai başlangıcında sizi hemen arayalım."),
});

export type VoiceBusinessHours = z.infer<typeof businessHoursSchema>;

export const voiceConfigUpdateSchema = z.object({
  connectPhoneNumber: z.string().max(32).nullable().optional(),
  assistantName: z.string().min(2).max(80),
  greetingText: z.string().min(10).max(600),
  ttsModelKey: z.string().min(2).max(80),
  ttsVoiceId: z.string().min(2).max(80),
  tone: z.enum(["samimi", "kurumsal"]).default("samimi"),
  businessHours: businessHoursSchema.optional(),
  routingRules: z.array(routingRuleSchema).max(20).optional(),
  blockedTopics: z.string().max(1000).nullable().optional(),
  active: z.boolean().optional(),
});

export type RetrievedChunk = {
  docId: string;
  title: string;
  content: string;
  score: number;
};

export type VoiceIntent = "info_question" | "transfer" | "callback" | "goodbye";

export type IntentRouteResult = {
  intent: VoiceIntent;
  transferTarget?: { type: "queue" | "external_number" | "callback"; value: string; label: string } | null;
  reason: string;
};

export type TranscriptTurn = {
  role: "caller" | "assistant";
  text: string;
  at: string;
  sources?: RetrievedChunk[];
};

export const VOICE_TTS_MODELS = [
  { key: "elevenlabs-v3", label: "ElevenLabs v3 (En Doğal Türkçe)", endpoint: "fal-ai/elevenlabs/tts/eleven-v3" },
  { key: "elevenlabs-turbo-2-5", label: "ElevenLabs Turbo v2.5 (Düşük Gecikme <1sn)", endpoint: "fal-ai/elevenlabs/tts/turbo-v2.5" },
  { key: "minimax-speech-2-8-turbo", label: "MiniMax Speech 2.8 Turbo (Hızlı)", endpoint: "fal-ai/minimax/speech-2.8-turbo" },
  { key: "polly-burcu", label: "Amazon Polly Neural (Burcu · Yedek)", endpoint: "aws-polly" },
] as const;

export const VOICE_TTS_VOICES = [
  { id: "tr-female-natural", label: "Rachel / Burcu (Doğal Kadın)" },
  { id: "tr-male-warm", label: "Adam / Emre (Sıcak Erkek)" },
  { id: "tr-corporate-female", label: "Aria (Kurumsal Kadın)" },
] as const;

