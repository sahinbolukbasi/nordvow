import { describe, expect, it } from "vitest";
import { DomainError } from "../../../domain/errors";
import {
  formatTimecode,
  secondsToTicks,
  snapToFrame,
  ticksPerFrame,
  ticksToSeconds,
  TICKS_PER_SECOND,
  type Ticks,
} from "../time";
import {
  assertLockedBrandLayersIntact,
  createEmptyTimeline,
  timelineTotalDurationTicks,
  type AudioEl,
  type VideoEl,
} from "../timeline-schema";
import {
  applyReframeToTimeline,
  applySilenceCutToTimeline,
  computeSilenceKeepIntervals,
  deleteElements,
  insertElement,
  moveElement,
  resolveSnapTarget,
  splitAndDeleteSide,
  splitElementAtPlayhead,
  trimElement,
} from "../ops";
import { compileTimelineAss, parseSrt, serializeSrt, splitSegmentsIntoCaptions } from "../captions";
import { compileTimelineFfmpeg, type RenderAssetInput } from "../compile-ffmpeg";
import { BUILTIN_STUDIO_TEMPLATES } from "../store";

function makeVideo(id: string, startSec: number, durSec: number, speed = 1): VideoEl {
  return {
    id,
    type: "video",
    name: id,
    assetId: "asset_1",
    startTime: secondsToTicks(startSec),
    duration: secondsToTicks(durSec),
    trimStart: 0 as Ticks,
    trimEnd: 0 as Ticks,
    sourceDuration: secondsToTicks(durSec * speed),
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
    volume: 1,
    sourceAudio: true,
    speed,
  };
}

describe("Studio Timeline Editor — Core Unit Tests", () => {
  describe("time.ts (120_000 tick aritmetiği)", () => {
    it("tüm standart kare hızlarını tam sayı olarak böler", () => {
      expect(TICKS_PER_SECOND).toBe(120_000);
      expect(ticksPerFrame(24)).toBe(5000);
      expect(ticksPerFrame(25)).toBe(4800);
      expect(ticksPerFrame(30)).toBe(4000);
      expect(ticksPerFrame(50)).toBe(2400);
      expect(ticksPerFrame(60)).toBe(2000);
    });

    it("snaps cleanly to frame & formats MM:SS.FF", () => {
      const snapped = snapToFrame(secondsToTicks(1.01), 30);
      expect(snapped % 4000).toBe(0);
      expect(formatTimecode(secondsToTicks(65.5), 30)).toBe("01:05.15");
    });
  });

  describe("ops.ts (split, ripple, silence cut, reframe, snap)", () => {
    it("1x hızda splitElementAtPlayhead trim sınırlarını kaydırmadan böler", () => {
      let tl = createEmptyTimeline("9:16", 30);
      tl = insertElement(tl, makeVideo("v1", 0, 10, 1));
      const next = splitElementAtPlayhead(tl, secondsToTicks(4), ["v1"]);
      expect(next.tracks.main.elements).toHaveLength(2);
      const [left, right] = next.tracks.main.elements as VideoEl[];
      expect(ticksToSeconds(left!.duration)).toBeCloseTo(4, 3);
      expect(ticksToSeconds(right!.startTime)).toBeCloseTo(4, 3);
      expect(ticksToSeconds(right!.duration)).toBeCloseTo(6, 3);
      expect(right!.trimStart).toBe(left!.trimStart + left!.duration);
    });

    it("1.5x hızda splitElementAtPlayhead kaynak offset invariantını korur", () => {
      let tl = createEmptyTimeline("9:16", 30);
      tl = insertElement(tl, makeVideo("v_fast", 0, 6, 1.5));
      const next = splitElementAtPlayhead(tl, secondsToTicks(2), ["v_fast"]);
      const [left, right] = next.tracks.main.elements as VideoEl[];
      expect(ticksToSeconds(left!.duration)).toBeCloseTo(2, 3);
      expect(ticksToSeconds(right!.duration)).toBeCloseTo(4, 3);
      // 2 sn timeline @ 1.5x = 3 sn kaynak
      expect(ticksToSeconds(right!.trimStart)).toBeCloseTo(3, 3);
      expect(left!.trimEnd).toBe(right!.duration * 1.5);
    });

    it("deleteElements ripple=true ana kanaldaki boşluğu kapatır, kilitli öğeye dokunmaz", () => {
      let tl = BUILTIN_STUDIO_TEMPLATES[0]!.buildTimeline({
        brandName: "DenemeMarka",
        couponCode: "KOD20",
        campaignUrl: "https://nordvow.com/k/test",
      });
      tl = insertElement(tl, makeVideo("v1", 0, 4));
      tl = insertElement(tl, makeVideo("v2", 4, 6));
      const deleted = deleteElements(tl, ["v1", "brand-ad-badge"], { ripple: true });
      expect(deleted.tracks.main.elements).toHaveLength(1);
      expect(deleted.tracks.main.elements[0]!.id).toBe("v2");
      expect(deleted.tracks.main.elements[0]!.startTime).toBe(0);
      // Marka kilitli #reklam rozeti silinmez
      expect(deleted.tracks.overlay[0]!.elements.some((e) => e.id === "brand-ad-badge")).toBe(true);
    });

    it("splitAndDeleteSide Q (sol) ripple temizler", () => {
      let tl = createEmptyTimeline("9:16", 30);
      tl = insertElement(tl, makeVideo("v1", 0, 8));
      const res = splitAndDeleteSide(tl, secondsToTicks(3), "left", ["v1"]);
      expect(res.tracks.main.elements).toHaveLength(1);
      const v = res.tracks.main.elements[0] as VideoEl;
      expect(v.startTime).toBe(0);
      expect(ticksToSeconds(v.duration)).toBeCloseTo(5, 3);
      expect(ticksToSeconds(v.trimStart)).toBeCloseTo(3, 3);
    });

    it("computeSilenceKeepIntervals kenar payı + birleştirme ile konuşma aralıklarını üretir", () => {
      const keep = computeSilenceKeepIntervals(
        10,
        [
          { startSec: 2.0, endSec: 5.0 },
          { startSec: 7.0, endSec: 9.0 },
        ],
        0.12,
      );
      expect(keep.length).toBe(3);
      expect(keep[0]!.startSec).toBe(0);
      expect(keep[0]!.endSec).toBeCloseTo(2.12, 2);
      expect(keep[0]!.cutSec).toBeGreaterThan(4);
    });

    it("applySilenceCutToTimeline tek adımda kesip ripple kaydırır", () => {
      let tl = createEmptyTimeline("9:16", 30);
      tl = insertElement(tl, makeVideo("v1", 0, 10));
      const { timeline: cut, savedSeconds } = applySilenceCutToTimeline(tl, "v1", [{ startSec: 3, endSec: 6 }], 0.1);
      expect(savedSeconds).toBeGreaterThan(2.5);
      expect(cut.tracks.main.elements.length).toBe(2);
      expect(timelineTotalDurationTicks(cut)).toBeLessThan(secondsToTicks(8));
    });

    it("insertElement çakışan overlay/ses öğesini otomatik yeni kanala açar", () => {
      let tl = createEmptyTimeline("9:16", 30);
      const a1: AudioEl = {
        id: "a1",
        type: "audio",
        name: "Müzik 1",
        assetId: "aud_1",
        startTime: 0 as Ticks,
        duration: secondsToTicks(5),
        trimStart: 0 as Ticks,
        trimEnd: 0 as Ticks,
        transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
        volume: 0.7,
        speed: 1,
      };
      const a2: AudioEl = { ...a1, id: "a2", name: "Müzik 2", startTime: secondsToTicks(1) };
      tl = insertElement(tl, a1);
      tl = insertElement(tl, a2);
      expect(tl.tracks.audio).toHaveLength(2);
    });

    it("moveElement & trimElement güvenli sınırlar içinde günceller", () => {
      let tl = createEmptyTimeline("9:16", 30);
      tl = insertElement(tl, makeVideo("v1", 0, 8));
      tl = moveElement(tl, "v1", secondsToTicks(2));
      expect(ticksToSeconds(tl.tracks.main.elements[0]!.startTime)).toBeCloseTo(2, 2);
      tl = trimElement(tl, "v1", "start", secondsToTicks(1));
      expect(ticksToSeconds(tl.tracks.main.elements[0]!.startTime)).toBeCloseTo(3, 2);
      expect(ticksToSeconds(tl.tracks.main.elements[0]!.duration)).toBeCloseTo(7, 2);
      tl = trimElement(tl, "v1", "end", -secondsToTicks(2));
      expect(ticksToSeconds(tl.tracks.main.elements[0]!.duration)).toBeCloseTo(5, 2);
    });

    it("applyReframeToTimeline ve resolveSnapTarget doğru çalışır", () => {
      let tl = createEmptyTimeline("16:9", 30);
      tl = insertElement(tl, makeVideo("v1", 0, 5));
      const vertical = applyReframeToTimeline(tl, "9:16", "blur");
      expect(vertical.settings.canvas).toEqual({ width: 1080, height: 1920 });
      expect(vertical.settings.background.type).toBe("blur");

      const snap = resolveSnapTarget(vertical, secondsToTicks(5.05), secondsToTicks(5), 60, ["dragging_id"]);
      expect(snap).toBe(secondsToTicks(5));
    });
  });

  describe("timeline-schema.ts (Marka kilit koruma)", () => {
    it("kilitli #reklam katmanı silinir/taşınır/metni değiştirilirse KURAL_IHLALI fırlatır", () => {
      const prev = BUILTIN_STUDIO_TEMPLATES[0]!.buildTimeline({
        brandName: "NordMarka",
        couponCode: "NORD10",
        campaignUrl: "https://nordvow.com/k/demo",
      });

      expect(() => assertLockedBrandLayersIntact(prev, prev)).not.toThrow();

      // Kilitli öğe silindi
      const removed = structuredClone(prev);
      const t0 = removed.tracks.overlay[0]!;
      if (t0.type === "text") {
        t0.elements = t0.elements.filter((e) => e.id !== "brand-ad-badge");
      }
      expect(() => assertLockedBrandLayersIntact(prev, removed)).toThrow(DomainError);

      // Kilitli metin değiştirildi
      const editedText = structuredClone(prev);
      const badge = editedText.tracks.overlay[0]!.elements.find((e) => e.id === "brand-ad-badge")!;
      if (badge.type === "text") badge.text = "reklam degil";
      expect(() => assertLockedBrandLayersIntact(prev, editedText)).toThrow("reklam ibaresi değiştirilemez");
    });
  });

  describe("captions.ts (3 kelime / 0.8 sn, SRT Türkçe UTF-8 & ASS)", () => {
    it("uzun segmentleri <=3 kelimelik ve min 0.8 sn parçalara böler", () => {
      const caps = splitSegmentsIntoCaptions(
        [{ id: "s1", startSec: 0, endSec: 6, text: "Merhaba arkadaşlar bugün yeni ürünü birlikte deniyoruz" }],
        { wordsPerCaption: 3, minDurationSec: 0.8, preset: "bold-yellow" },
      );
      expect(caps.length).toBeGreaterThanOrEqual(2);
      for (const c of caps) {
        expect(c.text.split(/\s+/).length).toBeLessThanOrEqual(3);
        expect(ticksToSeconds(c.duration)).toBeGreaterThanOrEqual(0.79);
      }
    });

    it("SRT Türkçe karakterlerle round-trip yapar", () => {
      const caps = splitSegmentsIntoCaptions(
        [{ id: "s1", startSec: 0.5, endSec: 3.5, text: "Şimdi ışıl ışıl güzellik çantası" }],
        { preset: "classic" },
      );
      const srt = serializeSrt(caps);
      expect(srt).toContain("-->");
      expect(srt).toContain("ışıl");
      const parsed = parseSrt(srt);
      expect(parsed.length).toBe(caps.length);
      expect(parsed.map((p) => p.text).join(" ")).toContain("güzellik");
    });

    it("compileTimelineAss geçerli Dialogue ve Style blokları üretir", () => {
      let tl = createEmptyTimeline("9:16", 30);
      const caps = splitSegmentsIntoCaptions([{ id: "s1", startSec: 0, endSec: 2, text: "Süper ürün {test}" }]);
      const t1 = tl.tracks.overlay[1]!;
      if (t1.type === "text") t1.elements.push(...caps);
      const ass = compileTimelineAss(tl);
      expect(ass).toContain("[V4+ Styles]");
      expect(ass).toContain("PlayResX: 1080");
      expect(ass).toContain("PlayResY: 1920");
      expect(ass).toContain("Dialogue:");
      expect(ass).toContain("\\{test\\}");
    });
  });

  describe("compile-ffmpeg.ts (Deterministik FFmpeg komut üreteci)", () => {
    it("-protocol_whitelist file,pipe ve filter_complex planı üretir", () => {
      let tl = createEmptyTimeline("9:16", 30);
      tl = insertElement(tl, makeVideo("v1", 0, 5, 1));
      const caps = splitSegmentsIntoCaptions([{ id: "c1", startSec: 0, endSec: 2.5, text: "Harika indirim başladı" }]);
      const t1 = tl.tracks.overlay[1]!;
      if (t1.type === "text") t1.elements.push(...caps);

      const assetsMap = new Map<string, RenderAssetInput>([
        ["asset_1", { id: "asset_1", localPath: "/tmp/in1.mp4", kind: "video", hasAudio: true }],
      ]);

      const plan = compileTimelineFfmpeg(tl, assetsMap, {
        outputPath: "/tmp/out.mp4",
        assPath: "/tmp/captions.ass",
        quality: "standard",
      });

      const wlIdx = plan.args.indexOf("-protocol_whitelist");
      expect(wlIdx).toBeGreaterThan(-1);
      expect(plan.args[wlIdx + 1]).toBe("file,pipe");
      expect(plan.args).toContain("-filter_complex");
      expect(plan.args).toContain("libx264");
      expect(plan.assContent).toContain("Dialogue:");
      expect(plan.totalDurationSec).toBe(5);
    });
  });
});
