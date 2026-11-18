import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AssistantSettings } from "./settings";
import type { KnowledgeBase } from "./knowledge-base";

export interface ReservationRecord {
  id: string;
  confirmationCode: string;
  customerName: string;
  phone: string;
  date: string;
  time: string;
  partySize: number;
  serviceType: string;
  notes: string;
  status: "confirmed";
  createdAt: string;
}

export interface StaffNoteRecord {
  id: string;
  callerName: string;
  callerPhone: string;
  category: "callback" | "complaint" | "info_request" | "other";
  urgency: "normal" | "high";
  summary: string;
  forwardedToWebhook: boolean;
  createdAt: string;
}

export interface ToolExecutionContext {
  callId: string;
  callerPhone?: string;
  settings: AssistantSettings;
  onTransferRequested?: (payload: {
    targetNumber: string;
    reason: string;
    summary: string;
  }) => void;
}

function readJsonArray<T>(filePath: string): T[] {
  if (!fs.existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function appendJsonRecord<T>(filePath: string, record: T): void {
  const existing = readJsonArray<T>(filePath);
  existing.push(record);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(existing, null, 2), "utf-8");
}

async function sendStaffWebhook(
  webhookUrl: string,
  event: string,
  payload: unknown,
): Promise<boolean> {
  if (!webhookUrl) return false;
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event,
        timestamp: new Date().toISOString(),
        payload,
      }),
      signal: AbortSignal.timeout(4000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export class AssistantTools {
  private readonly reservationsFile: string;
  private readonly notesFile: string;
  private readonly kb: KnowledgeBase;

  constructor(dataDir: string, kb: KnowledgeBase) {
    this.reservationsFile = path.join(dataDir, "reservations.json");
    this.notesFile = path.join(dataDir, "notes.json");
    this.kb = kb;
  }

  getEnabledToolDefinitions(settings: AssistantSettings) {
    const tools: Array<{
      type: "function";
      function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
      };
    }> = [];

    if (settings.features.knowledgeBaseEnabled) {
      tools.push({
        type: "function",
        function: {
          name: "search_knowledge_base",
          description:
            "İşletmenin yüklenen belgelerinde ve SSS kayıtlarında soru arar.",
          parameters: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
          },
        },
      });
    }

    if (settings.features.reservationsEnabled) {
      tools.push({
        type: "function",
        function: {
          name: "create_reservation",
          description: "Arayan kişi için yeni rezervasyon oluşturur.",
          parameters: {
            type: "object",
            properties: {
              customerName: { type: "string" },
              phone: { type: "string" },
              date: { type: "string" },
              time: { type: "string" },
              partySize: { type: "number" },
              serviceType: { type: "string" },
              notes: { type: "string" },
            },
            required: ["customerName", "phone", "date", "time"],
          },
        },
      });
    }

    if (settings.features.staffNotesEnabled) {
      tools.push({
        type: "function",
        function: {
          name: "take_staff_note",
          description:
            "Rezervasyon dışındaki tüm talepleri kaydedip görevlilere aktarır.",
          parameters: {
            type: "object",
            properties: {
              callerName: { type: "string" },
              callerPhone: { type: "string" },
              category: {
                type: "string",
                enum: ["callback", "complaint", "info_request", "other"],
              },
              urgency: { type: "string", enum: ["normal", "high"] },
              summary: { type: "string" },
            },
            required: ["callerName", "summary"],
          },
        },
      });
    }

    if (
      settings.features.callTransferEnabled &&
      settings.staffNotifications.transferPhoneNumber
    ) {
      tools.push({
        type: "function",
        function: {
          name: "transfer_to_staff",
          description: "Çağrıyı canlı görevli numarasına aktarır.",
          parameters: {
            type: "object",
            properties: {
              reason: { type: "string" },
              summary: { type: "string" },
            },
            required: ["reason", "summary"],
          },
        },
      });
    }

    return tools;
  }

  async execute(
    name: string,
    args: Record<string, unknown>,
    ctx: ToolExecutionContext,
  ): Promise<string> {
    switch (name) {
      case "search_knowledge_base": {
        if (!ctx.settings.features.knowledgeBaseEnabled) {
          return JSON.stringify({ error: "Bilgi bankası özelliği kapalı." });
        }
        const results = this.kb.search(String(args.query || ""), 3);
        return results.length === 0
          ? JSON.stringify({
              found: false,
              message: "Belgelerde eşleşen bilgi bulunamadı.",
            })
          : JSON.stringify({ found: true, results });
      }

      case "create_reservation": {
        if (!ctx.settings.features.reservationsEnabled) {
          return JSON.stringify({ error: "Rezervasyon özelliği kapalı." });
        }
        const confirmationCode = crypto
          .randomBytes(3)
          .toString("hex")
          .toUpperCase();
        const record: ReservationRecord = {
          id: crypto.randomUUID(),
          confirmationCode,
          customerName: String(args.customerName || "Belirtilmedi"),
          phone: String(args.phone || ctx.callerPhone || "Belirtilmedi"),
          date: String(args.date || ""),
          time: String(args.time || ""),
          partySize: Number(args.partySize || 1),
          serviceType: String(args.serviceType || "Genel"),
          notes: String(args.notes || ""),
          status: "confirmed",
          createdAt: new Date().toISOString(),
        };
        appendJsonRecord(this.reservationsFile, record);
        await sendStaffWebhook(
          ctx.settings.staffNotifications.webhookUrl,
          "reservation.created",
          record,
        );
        return JSON.stringify({
          success: true,
          confirmationCode,
          reservation: record,
        });
      }

      case "take_staff_note": {
        if (!ctx.settings.features.staffNotesEnabled) {
          return JSON.stringify({ error: "Not alma özelliği kapalı." });
        }
        const record: StaffNoteRecord = {
          id: crypto.randomUUID(),
          callerName: String(args.callerName || "İsimsiz Arayan"),
          callerPhone: String(
            args.callerPhone || ctx.callerPhone || "Belirtilmedi",
          ),
          category: (args.category as StaffNoteRecord["category"]) || "other",
          urgency: (args.urgency as StaffNoteRecord["urgency"]) || "normal",
          summary: String(args.summary || ""),
          forwardedToWebhook: false,
          createdAt: new Date().toISOString(),
        };
        record.forwardedToWebhook = await sendStaffWebhook(
          ctx.settings.staffNotifications.webhookUrl,
          "staff_note.created",
          record,
        );
        appendJsonRecord(this.notesFile, record);
        return JSON.stringify({ success: true, note: record });
      }

      case "transfer_to_staff": {
        const target = ctx.settings.staffNotifications.transferPhoneNumber;
        if (!ctx.settings.features.callTransferEnabled || !target) {
          return JSON.stringify({
            success: false,
            message: "Canlı aktarım aktif değil.",
          });
        }
        const reason = String(args.reason || "Müşteri talebi");
        const summary = String(args.summary || "");
        await sendStaffWebhook(
          ctx.settings.staffNotifications.webhookUrl,
          "call.transfer_requested",
          { callId: ctx.callId, target, reason, summary },
        );
        ctx.onTransferRequested?.({ targetNumber: target, reason, summary });
        return JSON.stringify({ success: true, transferringTo: target });
      }

      default:
        return JSON.stringify({ error: `Bilinmeyen araç: ${name}` });
    }
  }

  listReservations(): ReservationRecord[] {
    return readJsonArray<ReservationRecord>(this.reservationsFile);
  }

  listNotes(): StaffNoteRecord[] {
    return readJsonArray<StaffNoteRecord>(this.notesFile);
  }
}

