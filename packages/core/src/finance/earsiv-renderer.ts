import QRCode from "qrcode";
import { EARSIV_FATURA_TEMPLATE_HTML } from "./earsiv-template";
import type { EArsivFaturaJson } from "./earsiv-invoice";

const INNER_EACH = /\{\{#each\s+([^}]+)\}\}((?:(?!\{\{#(?:each|if))[\s\S])*?)\{\{\/each\}\}/;
const INNER_IF = /\{\{#if\s+([^}]+)\}\}((?:(?!\{\{#(?:each|if))[\s\S])*?)\{\{\/if\}\}/;
const VAR = /\{\{\s*([^#/][^}]*?)\s*\}\}/g;

/**
 * Resolves a dotted path in the context stack.
 */
function resolve(stack: unknown[], pathStr: string): unknown {
  let p = pathStr.trim();
  if (p === "this") {
    return stack[stack.length - 1];
  }
  if (p.startsWith("this.")) {
    p = p.slice(5);
  }
  for (let i = stack.length - 1; i >= 0; i--) {
    let cur = stack[i];
    let ok = true;
    for (const part of p.split(".")) {
      if (cur !== null && cur !== undefined && typeof cur === "object" && part in (cur as Record<string, unknown>)) {
        cur = (cur as Record<string, unknown>)[part];
      } else {
        ok = false;
        break;
      }
    }
    if (ok) {
      return cur;
    }
  }
  return undefined;
}

function truthy(val: unknown): boolean {
  if (val === undefined || val === null || val === false) return false;
  if (typeof val === "string") return val.trim().length > 0;
  if (Array.isArray(val)) return val.length > 0;
  if (typeof val === "number") return val !== 0;
  return true;
}

function splitElse(inner: string): [string, string] {
  const match = inner.match(/\{\{else\}\}/);
  if (!match || match.index === undefined) return [inner, ""];
  const idx = match.index;
  return [inner.slice(0, idx), inner.slice(idx + 10)];
}

function escapeHtml(str: unknown): string {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Minimal Handlebars subset renderer matching render.py.
 * Supports {{var}}, {{#if}}, {{else}}, {{#each}}.
 */
export function renderTemplate(template: string, data: Record<string, unknown>): string {
  function renderWith(tmpl: string, stack: unknown[]): string {
    let changed = true;
    while (changed) {
      changed = false;

      const eachMatch = tmpl.match(INNER_EACH);
      if (eachMatch) {
        changed = true;
        const full = eachMatch[0];
        const pathName = eachMatch[1] ?? "";
        const inner = eachMatch[2] ?? "";
        const seq = resolve(stack, pathName);
        const arr = Array.isArray(seq) ? seq : seq !== undefined && seq !== null ? [seq] : [];
        const replacement = arr.map((item) => renderWith(inner, [...stack, item])).join("");
        tmpl = tmpl.replace(full, () => replacement);
        continue;
      }

      const ifMatch = tmpl.match(INNER_IF);
      if (ifMatch) {
        changed = true;
        const full = ifMatch[0];
        const pathName = ifMatch[1] ?? "";
        const inner = ifMatch[2] ?? "";
        const [yes, no] = splitElse(inner);
        const cond = truthy(resolve(stack, pathName));
        const replacement = renderWith(cond ? yes : no, stack);
        tmpl = tmpl.replace(full, () => replacement);
        continue;
      }
    }

    return tmpl.replace(VAR, (_, pathName: string) => {
      const p = pathName.trim();
      if (p === "else") return "{{else}}";
      const val = resolve(stack, p);
      if (val === undefined || val === null) return "";
      return escapeHtml(val);
    });
  }

  return renderWith(template, [data]);
}

export interface RenderEArsivOptions {
  karekodDataUrl?: string;
  logoDataUrl?: string;
  template?: string;
  generateQrCodeIfMissing?: boolean;
}

/**
 * Builds GİB-compatible QR code payload string for e-Arşiv / e-Fatura draft.
 */
export function buildQrPayload(data: EArsivFaturaJson): string {
  const saticiKimlik = data.satici?.kimlikler?.[0]?.id || "";
  const aliciKimlik = data.alici?.kimlikler?.[0]?.id || "";
  return [
    `VKN:${saticiKimlik}`,
    `ALICI:${aliciKimlik}`,
    `TARIH:${data.faturaTarihi}`,
    `NO:${data.faturaNo}`,
    `TUTAR:${data.toplamlar.odenecekTutar}`,
    `ETTN:${data.ettn || "TASLAK"}`,
  ].join("|");
}

/**
 * Renders e-Arşiv Fatura HTML using earsiv_fatura.html template and input JSON data.
 */
export async function renderEArsivHtml(
  data: EArsivFaturaJson,
  options: RenderEArsivOptions = {},
): Promise<string> {
  const tmpl = options.template ?? EARSIV_FATURA_TEMPLATE_HTML;
  const context: Record<string, unknown> = { ...(data as unknown as Record<string, unknown>) };

  if (options.logoDataUrl) {
    context.logoDataUrl = options.logoDataUrl;
  }

  if (options.karekodDataUrl) {
    context.karekodDataUrl = options.karekodDataUrl;
  } else if (options.generateQrCodeIfMissing !== false) {
    try {
      const payload = buildQrPayload(data);
      context.karekodDataUrl = await QRCode.toDataURL(payload, {
        width: 150,
        margin: 1,
        color: { dark: "#000000", light: "#ffffff" },
      });
    } catch {
      // Fallback: If QR generation fails, template shows the css placeholder .qr-kutu
    }
  }

  return renderTemplate(tmpl, context);
}
