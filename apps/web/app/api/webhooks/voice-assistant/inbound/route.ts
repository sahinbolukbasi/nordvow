import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function resolveAllowedHost(rawHost: string | null): string {
  const appHost = (() => {
    try {
      return process.env.APP_URL ? new URL(process.env.APP_URL).host : "nordvow.com";
    } catch {
      return "nordvow.com";
    }
  })();
  const allowed = new Set(["nordvow.com", "www.nordvow.com", appHost]);
  if (rawHost && allowed.has(rawHost.toLowerCase())) {
    return rawHost.toLowerCase();
  }
  return appHost;
}

async function handleInbound(req: NextRequest) {
  const host = resolveAllowedHost(req.headers.get("host"));
  const wsUrl =
    process.env.VOICE_WS_URL ||
    process.env.PUBLIC_WS_URL ||
    `wss://${host}/ws/call`;

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${escapeXml(wsUrl)}" />
  </Connect>
</Response>`;

  return new NextResponse(twiml, {
    status: 200,
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}

export async function GET(req: NextRequest) {
  return handleInbound(req);
}

export async function POST(req: NextRequest) {
  return handleInbound(req);
}
