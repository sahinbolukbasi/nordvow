import { NextRequest, NextResponse } from "next/server";
import { requireApiActor } from "@/lib/auth-guard";
import { getVoiceRuntime } from "@/lib/voice-assistant/engine";
import { PartialAssistantSettingsSchema } from "@/lib/voice-assistant/settings";

export const dynamic = "force-dynamic";

function resolveBrandScope(
  req: NextRequest,
  actor: { role: string; brandId?: string | null },
  bodyBrandId?: unknown,
): string {
  if (actor.role === "BRAND" && actor.brandId) {
    return actor.brandId;
  }
  const fromQuery = req.nextUrl.searchParams.get("brandId");
  if (fromQuery) return fromQuery;
  if (typeof bodyBrandId === "string" && bodyBrandId) return bodyBrandId;
  return actor.brandId || "default";
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const auth = await requireApiActor("ADMIN", "BRAND");
  if (auth.response) return auth.response;

  const { path } = await context.params;
  const key = path.join("/");
  const brandId = resolveBrandScope(req, auth.actor);
  const brandName = req.nextUrl.searchParams.get("brandName") || undefined;
  const runtime = getVoiceRuntime(brandId, brandName);

  switch (key) {
    case "health":
      return NextResponse.json({
        status: "ok",
        service: "nordvow-voice-assistant",
        brandId: runtime.brandId,
        costProfile: runtime.settingsStore.get().costProfile,
      });
    case "settings":
      return NextResponse.json(runtime.settingsStore.get());
    case "knowledge":
      return NextResponse.json({
        documents: runtime.knowledgeBase.listDocuments(),
      });
    case "reservations":
      return NextResponse.json({
        reservations: runtime.assistantTools.listReservations(),
      });
    case "notes":
      return NextResponse.json({
        notes: runtime.assistantTools.listNotes(),
      });
    case "calls":
      return NextResponse.json({
        calls: runtime.callLogStore.listCalls(),
      });
    case "metrics/costs":
      return NextResponse.json(
        runtime.costTracker.getMonthlyReport(runtime.settingsStore.get()),
      );
    default:
      if (path[0] === "calls" && path[1]) {
        const call = runtime.callLogStore.getCall(path[1]);
        if (!call) {
          return NextResponse.json(
            { error: "Çağrı kaydı bulunamadı" },
            { status: 404 },
          );
        }
        return NextResponse.json(call);
      }
      return NextResponse.json(
        { error: "Endpoint bulunamadı" },
        { status: 404 },
      );
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const auth = await requireApiActor("ADMIN", "BRAND");
  if (auth.response) return auth.response;

  const { path } = await context.params;
  const key = path.join("/");
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const brandId = resolveBrandScope(req, auth.actor, body.brandId);
  const runtime = getVoiceRuntime(brandId);

  if (key === "knowledge") {
    const filename = typeof body.filename === "string" ? body.filename : "";
    const content = typeof body.content === "string" ? body.content : "";
    if (!filename || !content) {
      return NextResponse.json(
        { error: "filename ve content alanları zorunludur." },
        { status: 400 },
      );
    }
    return NextResponse.json(
      runtime.knowledgeBase.addDocument(filename, content),
      { status: 201 },
    );
  }

  if (key === "simulate/chat") {
    const message = typeof body.message === "string" ? body.message : "";
    if (!message) {
      return NextResponse.json(
        { error: "message alanı zorunludur." },
        { status: 400 },
      );
    }
    const result = await runtime.simulateChat({
      sessionId: typeof body.sessionId === "string" ? body.sessionId : undefined,
      message,
      callerPhone:
        typeof body.callerPhone === "string" ? body.callerPhone : undefined,
    });
    return NextResponse.json(result);
  }

  return NextResponse.json({ error: "Endpoint bulunamadı" }, { status: 404 });
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const auth = await requireApiActor("ADMIN", "BRAND");
  if (auth.response) return auth.response;

  const { path } = await context.params;
  if (path.join("/") !== "settings") {
    return NextResponse.json({ error: "Endpoint bulunamadı" }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const parsed = PartialAssistantSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Geçersiz ayar verisi", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const brandId = resolveBrandScope(req, auth.actor, body.brandId);
  const runtime = getVoiceRuntime(brandId);
  const updated = runtime.settingsStore.update(parsed.data);
  if (parsed.data.companyProfile) {
    runtime.syncCompanyKnowledge(updated);
  }
  return NextResponse.json(updated);
}
