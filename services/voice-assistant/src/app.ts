import { timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { renderAdminHtml } from './admin/admin-page.js';
import {
  PartialAssistantSettingsSchema,
  SettingsStore,
} from './config/settings.js';
import { KnowledgeBase } from './knowledge/knowledge-base.js';
import { CallLogStore } from './services/call-log-store.js';
import { CostTracker } from './services/cost-tracker.js';
import { AssistantTools } from './tools/assistant-tools.js';
import { CallSession } from './voice/call-session.js';

export interface VoiceAssistantApp {
  server: http.Server;
  settingsStore: SettingsStore;
  knowledgeBase: KnowledgeBase;
  costTracker: CostTracker;
  callLogStore: CallLogStore;
  assistantTools: AssistantTools;
  close: () => Promise<void>;
}

const MAX_BODY_BYTES = 1024 * 1024; // 1 MB

function verifyApiKey(req: http.IncomingMessage): boolean {
  const expected = process.env.VOICE_ASSISTANT_API_KEY?.trim();
  if (!expected) {
    // Production ortamında anahtar yoksa fail-closed; yerel/test ortamında serbest.
    return process.env.NODE_ENV !== 'production';
  }
  const authHeader = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const apiKeyHeader =
    typeof req.headers['x-api-key'] === 'string' ? req.headers['x-api-key'].trim() : '';
  const provided = authHeader || apiKeyHeader;
  if (!provided || provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > MAX_BODY_BYTES) {
      throw new Error('İstek gövdesi izin verilen 1 MB sınırını aşıyor.');
    }
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString('utf-8').trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

function sendJson(
  res: http.ServerResponse,
  statusCode: number,
  data: unknown
): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * HTTP API ve WebSocket telefon ses akışı sunucusunu oluşturur.
 */
export function createVoiceAssistantApp(baseDir: string): VoiceAssistantApp {
  const dataDir = path.join(baseDir, 'data');
  const knowledgeDir = path.join(baseDir, 'knowledge');

  const settingsStore = new SettingsStore(dataDir);
  const knowledgeBase = new KnowledgeBase(knowledgeDir);
  const costTracker = new CostTracker(dataDir);
  const callLogStore = new CallLogStore(dataDir);
  const assistantTools = new AssistantTools(dataDir, knowledgeBase);

  const simulatedSessions = new Map<string, CallSession>();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    const method = req.method || 'GET';

    try {
      if (method === 'GET' && pathname === '/') {
        res.writeHead(302, { Location: '/admin' });
        return res.end();
      }

      if (method === 'GET' && pathname === '/health') {
        return sendJson(res, 200, {
          status: 'ok',
          service: 'voice-assistant',
          costProfile: settingsStore.get().costProfile,
        });
      }

      if (pathname === '/admin' || pathname.startsWith('/api/')) {
        if (!verifyApiKey(req)) {
          return sendJson(res, 401, { error: 'Yetkisiz erişim.' });
        }
      }

      if (method === 'GET' && pathname === '/admin') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(renderAdminHtml());
      }

      // Ayarları görüntüle / güncelle (özellik açma-kapama ve maliyet profili)
      if (method === 'GET' && pathname === '/api/settings') {
        return sendJson(res, 200, settingsStore.get());
      }

      if (method === 'PATCH' && pathname === '/api/settings') {
        const body = await readJsonBody(req);
        const parsed = PartialAssistantSettingsSchema.safeParse(body);
        if (!parsed.success) {
          return sendJson(res, 400, {
            error: 'Geçersiz ayar verisi',
            details: parsed.error.flatten(),
          });
        }
        const updated = settingsStore.update(parsed.data);
        return sendJson(res, 200, updated);
      }

      // Bilgi Bankası (Belgeler)
      if (method === 'GET' && pathname === '/api/knowledge') {
        return sendJson(res, 200, {
          documents: knowledgeBase.listDocuments(),
        });
      }

      if (method === 'POST' && pathname === '/api/knowledge') {
        const body = (await readJsonBody(req)) as {
          filename?: string;
          content?: string;
        };
        if (!body.filename || !body.content) {
          return sendJson(res, 400, {
            error: 'filename ve content alanları zorunludur.',
          });
        }
        const result = knowledgeBase.addDocument(body.filename, body.content);
        return sendJson(res, 201, result);
      }

      // Rezervasyonlar ve Görevli Notları
      if (method === 'GET' && pathname === '/api/reservations') {
        return sendJson(res, 200, {
          reservations: assistantTools.listReservations(),
        });
      }

      if (method === 'GET' && pathname === '/api/notes') {
        return sendJson(res, 200, {
          notes: assistantTools.listNotes(),
        });
      }

      // Çağrı Kayıtları
      if (method === 'GET' && pathname === '/api/calls') {
        return sendJson(res, 200, {
          calls: callLogStore.listCalls(),
        });
      }

      if (method === 'GET' && pathname.startsWith('/api/calls/')) {
        const callId = pathname.slice('/api/calls/'.length);
        const call = callLogStore.getCall(callId);
        if (!call) {
          return sendJson(res, 404, { error: 'Çağrı kaydı bulunamadı' });
        }
        return sendJson(res, 200, call);
      }

      // Maliyet Raporu
      if (method === 'GET' && pathname === '/api/metrics/costs') {
        return sendJson(
          res,
          200,
          costTracker.getMonthlyReport(settingsStore.get())
        );
      }

      // Telefon bağlamadan metin üzerinden asistanı test etme
      if (method === 'POST' && pathname === '/api/simulate/chat') {
        const body = (await readJsonBody(req)) as {
          sessionId?: string;
          message?: string;
          callerPhone?: string;
        };
        if (!body.message) {
          return sendJson(res, 400, { error: 'message alanı zorunludur.' });
        }

        let session = body.sessionId
          ? simulatedSessions.get(body.sessionId)
          : undefined;
        if (!session) {
          session = new CallSession(
            { settingsStore, costTracker, assistantTools, callLogStore },
            undefined,
            body.callerPhone || '+905550000000'
          );
          simulatedSessions.set(session.callId, session);
        }

        const reply = await session.handleUserUtterance(body.message);
        return sendJson(res, 200, {
          sessionId: session.callId,
          reply,
        });
      }

      // Türkiye (+90) SIP / Twilio / Gateway gelen çağrı webhook'u
      if (
        (method === 'POST' || method === 'GET') &&
        pathname === '/webhooks/telephony/inbound'
      ) {
        const wsUrl =
          process.env.PUBLIC_WS_URL ||
          `wss://${req.headers.host || 'localhost'}/ws/call`;
        const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${escapeXml(wsUrl)}" />
  </Connect>
</Response>`;
        res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
        return res.end(twiml);
      }

      return sendJson(res, 404, { error: 'Endpoint bulunamadı' });
    } catch (err) {
      return sendJson(res, 500, {
        error: err instanceof Error ? err.message : 'Sunucu hatası',
      });
    }
  });

  // Gerçek zamanlı WebSocket ses akışı (/ws/call)
  const wss = new WebSocketServer({ server, path: '/ws/call' });
  wss.on('connection', (ws) => {
    const session = new CallSession(
      { settingsStore, costTracker, assistantTools, callLogStore },
      ws
    );

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          event: string;
          start?: { streamSid?: string; customParameters?: { from?: string } };
          media?: { payload?: string };
        };

        if (msg.event === 'start') {
          session.start(
            msg.start?.streamSid,
            msg.start?.customParameters?.from
          );
        } else if (msg.event === 'media' && msg.media?.payload) {
          session.forwardIncomingAudio(msg.media.payload);
        } else if (msg.event === 'stop') {
          session.close();
        }
      } catch (err) {
        console.error('[WS] Mesaj işleme hatası:', (err as Error).message);
      }
    });

    ws.on('close', () => session.close());
  });

  return {
    server,
    settingsStore,
    knowledgeBase,
    costTracker,
    callLogStore,
    assistantTools,
    close: async () => {
      for (const s of simulatedSessions.values()) s.close();
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

