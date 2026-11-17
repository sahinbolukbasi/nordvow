import ExcelJS from "exceljs";

export type ImportedCouponRow = {
  code: string;
  recipientHint?: string;
};

export type CouponExportRow = {
  influencerName: string;
  email: string;
  couponCode: string;
  trackingCode: string;
  status: string;
  sentAt: string;
  redeemedAt: string;
};

function cleanCell(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object" && "text" in (v as Record<string, unknown>)) {
    return String((v as { text?: unknown }).text ?? "").trim();
  }
  return String(v).trim();
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function normalizeHeader(h: string): string {
  return h
    .toLocaleLowerCase("tr")
    .replace(/[ıİ]/g, "i")
    .replace(/[şŞ]/g, "s")
    .replace(/[ğĞ]/g, "g")
    .replace(/[üÜ]/g, "u")
    .replace(/[öÖ]/g, "o")
    .replace(/[çÇ]/g, "c")
    .replace(/[^a-z0-9]/g, "");
}

function extractRowsFromMatrix(matrix: string[][]): ImportedCouponRow[] {
  const nonEmpty = matrix.filter((r) => r.some((cell) => cell.trim().length > 0));
  if (nonEmpty.length === 0) return [];

  const firstRow = nonEmpty[0]!.map(normalizeHeader);
  const codeColByHeader = firstRow.findIndex((h) =>
    ["kod", "code", "kuponkodu", "couponcode", "kupon", "takipkodu"].includes(h),
  );
  const recipientColByHeader = firstRow.findIndex((h) =>
    ["influencer", "alici", "kullanici", "eposta", "email", "isim", "ad", "handle", "recipient"].includes(h),
  );

  const hasHeader = codeColByHeader !== -1 || recipientColByHeader !== -1;
  const startIdx = hasHeader ? 1 : 0;
  const codeCol = codeColByHeader !== -1 ? codeColByHeader : 0;
  const recipientCol = recipientColByHeader !== -1 ? recipientColByHeader : -1;

  const seen = new Set<string>();
  const result: ImportedCouponRow[] = [];

  for (let i = startIdx; i < nonEmpty.length; i++) {
    const row = nonEmpty[i]!;
    const rawCode = (row[codeCol] ?? "").trim();
    if (!rawCode || rawCode.length > 64) continue;
    const key = rawCode.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const hint = recipientCol !== -1 ? (row[recipientCol] ?? "").trim() : (row[1] ?? "").trim();
    result.push({
      code: rawCode,
      ...(hint ? { recipientHint: hint } : {}),
    });
  }

  return result;
}

/**
 * Excel (.xlsx / .xls) veya CSV (.csv / .txt) dosyasından kupon kodlarını okur.
 */
export async function parseCouponImportFile(buffer: Buffer, fileName: string): Promise<ImportedCouponRow[]> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
    const rawText = buffer.toString("utf8").replace(/^\uFEFF/, "");
    const lines = rawText.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) return [];
    const sample = lines[0]!;
    const delimiter = sample.split(";").length > sample.split(",").length ? ";" : ",";
    const matrix = lines.map((l) => splitCsvLine(l, delimiter));
    return extractRowsFromMatrix(matrix);
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];

  const matrix: string[][] = [];
  ws.eachRow((row) => {
    const vals: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      vals[colNumber - 1] = cleanCell(cell.value);
    });
    matrix.push(vals);
  });

  return extractRowsFromMatrix(matrix);
}

/**
 * Kupon gönderimlerini biçimlendirilmiş Excel (.xlsx) dosyasına çevirir.
 */
export async function buildCouponExportXlsx(title: string, rows: CouponExportRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Kupon Kodlari");

  ws.columns = [
    { header: "Influencer", key: "influencerName", width: 24 },
    { header: "E-posta", key: "email", width: 28 },
    { header: "Kupon Kodu", key: "couponCode", width: 20 },
    { header: "Takip Kodu", key: "trackingCode", width: 20 },
    { header: "Durum", key: "status", width: 14 },
    { header: "Gönderim Tarihi", key: "sentAt", width: 16 },
    { header: "Kullanım Tarihi", key: "redeemedAt", width: 16 },
  ];

  ws.getRow(1).font = { bold: true };
  for (const r of rows) {
    ws.addRow(r);
  }

  ws.properties.defaultRowHeight = 20;
  wb.title = title;
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

export async function buildCouponTemplateXlsx(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sablon");
  ws.columns = [
    { header: "Kupon Kodu", key: "code", width: 22 },
    { header: "Influencer (opsiyonel)", key: "recipient", width: 30 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.addRow({ code: "YAZ20-001", recipient: "ornek@eposta.com" });
  ws.addRow({ code: "YAZ20-002", recipient: "" });
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

export function buildCouponTemplateCsv(): string {
  return "\uFEFF" + ["Kupon Kodu,Influencer (opsiyonel)", "YAZ20-001,ornek@eposta.com", "YAZ20-002,"].join("\r\n") + "\r\n";
}
