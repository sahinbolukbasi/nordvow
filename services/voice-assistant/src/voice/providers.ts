import WebSocket from 'ws';
import type { AssistantSettings } from '../config/settings.js';
import type {
  AssistantTools,
  ToolDefinition,
  ToolExecutionContext,
} from '../tools/assistant-tools.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
}

export interface LlmResult {
  replyText: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * ElevenLabs Flash v2.5 ile telefon uyumlu (ulaw_8000) gerçekçi Türkçe ses üretir.
 * API anahtarı yoksa veya mock seçiliyse boş/sessiz tampon döner.
 */
export async function synthesizeSpeech(
  text: string,
  settings: AssistantSettings,
  abortSignal?: AbortSignal
): Promise<Buffer> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey || settings.voice.provider === 'mock') {
    return Buffer.alloc(0);
  }

  // ElevenLabs ulaw_8000 formatı doğrudan PSTN/Twilio/SIP akışına çevrimsiz basılır
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
    settings.voice.voiceId
  )}/stream?output_format=ulaw_8000&optimize_streaming_latency=4`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      model_id: settings.voice.modelId,
      voice_settings: {
        stability: settings.voice.stability,
        similarity_boost: settings.voice.similarityBoost,
        speed: settings.voice.speed,
      },
    }),
    signal: abortSignal,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`ElevenLabs TTS hatası (${response.status}): ${errText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * LLM'den araç çağrılarıyla birlikte kısa telefon yanıtı üretir.
 * OPENAI_API_KEY tanımlı değilse yerel demo/simülasyon motoru devreye girer.
 */
export async function generateLlmReply(
  messages: ChatMessage[],
  tools: ToolDefinition[],
  assistantTools: AssistantTools,
  toolCtx: ToolExecutionContext,
  useEcoModel = false
): Promise<LlmResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return runLocalFallbackReply(messages, assistantTools, toolCtx);
  }

  const model = useEcoModel
    ? 'gpt-4o-mini'
    : process.env.OPENAI_MODEL || 'gpt-4o-mini';
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const workingMessages = [...messages];

  // En fazla 3 araç çağrısı turu (sonsuz döngü ve maliyet koruması)
  for (let round = 0; round < 3; round++) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: workingMessages,
        tools: tools.length > 0 ? tools : undefined,
        max_tokens: toolCtx.settings.conversation.maxResponseTokens,
        temperature: 0.4,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`OpenAI API hatası (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as {
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      choices: Array<{
        message: ChatMessage;
      }>;
    };

    totalInputTokens += data.usage?.prompt_tokens || 0;
    totalOutputTokens += data.usage?.completion_tokens || 0;

    const assistantMsg = data.choices[0]?.message;
    if (!assistantMsg) break;

    workingMessages.push(assistantMsg);

    if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
      for (const tc of assistantMsg.tool_calls) {
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(tc.function.arguments || '{}');
        } catch {
          parsedArgs = {};
        }
        const toolOutput = await assistantTools.execute(
          tc.function.name,
          parsedArgs,
          toolCtx
        );
        workingMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: toolOutput,
        });
      }
      continue;
    }

    return {
      replyText: (assistantMsg.content || '').trim(),
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
    };
  }

  return {
    replyText: 'Anlıyorum, talebinizi hemen görevli ekibimize iletiyorum.',
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
  };
}

/**
 * API anahtarı olmadan yerel test ve simülasyon için akıllı yedek yanıtlayıcı.
 */
async function runLocalFallbackReply(
  messages: ChatMessage[],
  assistantTools: AssistantTools,
  toolCtx: ToolExecutionContext
): Promise<LlmResult> {
  const lastUser =
    [...messages].reverse().find((m) => m.role === 'user')?.content || '';
  const lower = lastUser.toLocaleLowerCase('tr-TR');

  if (lower.includes('rezervasyon') || lower.includes('randevu')) {
    if (lower.match(/\d{1,2}[:.]\d{2}/) && toolCtx.settings.features.reservationsEnabled) {
      const resJson = await assistantTools.execute(
        'create_reservation',
        {
          customerName: 'Test Müşteri',
          phone: toolCtx.callerPhone || '+905550000000',
          date: new Date().toISOString().slice(0, 10),
          time: lower.match(/\d{1,2}[:.]\d{2}/)?.[0] || '19:00',
          partySize: 2,
          notes: lastUser,
        },
        toolCtx
      );
      const parsed = JSON.parse(resJson);
      return {
        replyText: `Rezervasyonunuzu oluşturdum. Onay kodunuz ${parsed.confirmationCode}. Başka bir konuda yardımcı olabilir miyim?`,
        inputTokens: 80,
        outputTokens: 35,
      };
    }
    return {
      replyText:
        'Memnuniyetle rezervasyon oluşturabilirim. Hangi gün ve saat için düşünüyorsunuz?',
      inputTokens: 60,
      outputTokens: 25,
    };
  }

  if (
    lower.includes('yetkili') ||
    lower.includes('görevli') ||
    lower.includes('müşteri temsilcisi')
  ) {
    if (
      toolCtx.settings.features.callTransferEnabled &&
      toolCtx.settings.staffNotifications.transferPhoneNumber
    ) {
      await assistantTools.execute(
        'transfer_to_staff',
        { reason: 'Müşteri talebi', summary: lastUser },
        toolCtx
      );
      return {
        replyText: 'Sizi hemen görevli arkadaşımıza aktarıyorum, lütfen hatta kalın.',
        inputTokens: 50,
        outputTokens: 20,
      };
    }
  }

  if (
    lower.includes('not') ||
    lower.includes('ilet') ||
    lower.includes('şikayet') ||
    lower.includes('arasın')
  ) {
    if (toolCtx.settings.features.staffNotesEnabled) {
      await assistantTools.execute(
        'take_staff_note',
        {
          callerName: 'Arayan Müşteri',
          callerPhone: toolCtx.callerPhone || 'Belirtilmedi',
          category: lower.includes('şikayet') ? 'complaint' : 'callback',
          urgency: 'normal',
          summary: lastUser,
        },
        toolCtx
      );
      return {
        replyText:
          'Notunuzu aldım ve görevli ekibimize ilettim. En kısa sürede size dönüş yapılacaktır.',
        inputTokens: 70,
        outputTokens: 30,
      };
    }
  }

  if (toolCtx.settings.features.knowledgeBaseEnabled) {
    const kbResult = JSON.parse(
      await assistantTools.execute(
        'search_knowledge_base',
        { query: lastUser },
        toolCtx
      )
    );
    if (kbResult.found && kbResult.results?.[0]?.content) {
      const cleanAnswer = String(kbResult.results[0].content)
        .replace(/^#+\s.*$/gm, '')
        .replace(/Soru:.*\n?/gi, '')
        .replace(/Cevap:\s*/gi, '')
        .trim();
      return {
        replyText: cleanAnswer.split(/(?<=[.!?])\s+/).slice(0, 2).join(' '),
        inputTokens: 90,
        outputTokens: 40,
      };
    }
  }

  return {
    replyText:
      'Anladım. İsterseniz bu konuda notunuzu alıp görevli ekibimize hemen iletebilirim.',
    inputTokens: 50,
    outputTokens: 20,
  };
}

export interface SttCallbacks {
  onSpeechStarted: () => void;
  onTranscriptFinal: (text: string, durationSec: number) => void;
  onError: (err: Error) => void;
}

/**
 * Deepgram Nova-2 Türkçe gerçek zamanlı ses-metin (STT) WebSocket bağlantısı kurar.
 */
export function createDeepgramSttConnection(
  settings: AssistantSettings,
  callbacks: SttCallbacks
): WebSocket | null {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) return null;

  const params = new URLSearchParams({
    model: 'nova-2',
    language: 'tr',
    encoding: 'mulaw',
    sample_rate: '8000',
    channels: '1',
    interim_results: 'true',
    vad_events: 'true',
    endpointing: String(settings.conversation.silenceTimeoutMs),
  });

  const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, {
    headers: { Authorization: `Token ${apiKey}` },
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'SpeechStarted') {
        callbacks.onSpeechStarted();
        return;
      }
      if (msg.type === 'Results' && msg.is_final) {
        const transcript = msg.channel?.alternatives?.[0]?.transcript?.trim();
        if (transcript) {
          callbacks.onTranscriptFinal(transcript, Number(msg.duration || 1));
        }
      }
    } catch (err) {
      callbacks.onError(err instanceof Error ? err : new Error(String(err)));
    }
  });

  ws.on('error', (err) => callbacks.onError(err));
  return ws;
}

