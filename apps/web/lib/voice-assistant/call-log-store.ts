import fs from "node:fs";
import path from "node:path";

export interface CallTranscriptTurn {
  speaker: "caller" | "assistant" | "system";
  text: string;
  timestamp: string;
}

export interface CallExtractedDetails {
  callerName?: string;
  intent?: string;
  urgency?: "normal" | "high";
  importantNotes: string[];
}

export interface CallLogRecord {
  callId: string;
  channel: "phone" | "simulation";
  callerPhone: string;
  startedAt: string;
  endedAt?: string;
  durationSeconds: number;
  status: "active" | "completed" | "transferred";
  estimatedCostUsd: number;
  extractedDetails?: CallExtractedDetails;
  transcript: CallTranscriptTurn[];
}

export class CallLogStore {
  private readonly filePath: string;
  private logs: CallLogRecord[] = [];

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, "call-logs.json");
    this.load();
  }

  private load(): void {
    if (!fs.existsSync(this.filePath)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf-8"));
      if (Array.isArray(parsed)) this.logs = parsed;
    } catch {
      this.logs = [];
    }
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(
      this.filePath,
      JSON.stringify(this.logs.slice(-500), null, 2),
      "utf-8",
    );
  }

  createCall(
    callId: string,
    channel: "phone" | "simulation",
    callerPhone: string,
  ): CallLogRecord {
    const record: CallLogRecord = {
      callId,
      channel,
      callerPhone,
      startedAt: new Date().toISOString(),
      durationSeconds: 0,
      status: "active",
      estimatedCostUsd: 0,
      transcript: [],
    };
    this.logs.push(record);
    this.save();
    return record;
  }

  appendTurn(
    callId: string,
    speaker: CallTranscriptTurn["speaker"],
    text: string,
    estimatedCostUsd?: number,
  ): void {
    const record = this.logs.find((l) => l.callId === callId);
    if (!record || !text) return;
    record.transcript.push({
      speaker,
      text,
      timestamp: new Date().toISOString(),
    });
    record.durationSeconds = Math.max(
      1,
      Math.round((Date.now() - new Date(record.startedAt).getTime()) / 1000),
    );
    if (typeof estimatedCostUsd === "number") {
      record.estimatedCostUsd = estimatedCostUsd;
    }
    this.save();
  }

  setExtractedDetails(callId: string, details: CallExtractedDetails): void {
    const record = this.logs.find((l) => l.callId === callId);
    if (!record) return;
    record.extractedDetails = details;
    this.save();
  }

  finishCall(
    callId: string,
    status: "completed" | "transferred" = "completed",
    estimatedCostUsd?: number,
  ): void {
    const record = this.logs.find((l) => l.callId === callId);
    if (!record) return;
    record.endedAt = new Date().toISOString();
    record.status = status;
    record.durationSeconds = Math.max(
      1,
      Math.round(
        (new Date(record.endedAt).getTime() -
          new Date(record.startedAt).getTime()) /
          1000,
      ),
    );
    if (typeof estimatedCostUsd === "number") {
      record.estimatedCostUsd = estimatedCostUsd;
    }
    this.save();
  }

  listCalls(): CallLogRecord[] {
    return [...this.logs].reverse();
  }

  getCall(callId: string): CallLogRecord | undefined {
    return this.logs.find((l) => l.callId === callId);
  }
}

