import { createHash } from "node:crypto";
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { BRAND_NAME } from "@infulancer/core/brand";
import { registerPdfFonts } from "./fonts";

const s = StyleSheet.create({
  page: {
    fontFamily: "Geist",
    fontSize: 9.5,
    color: "#171717",
    backgroundColor: "#F5F5F7",
    paddingHorizontal: 24,
    paddingVertical: 20,
    lineHeight: 1.35,
  },
  pass: {
    backgroundColor: "#0F0F12",
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#27272A",
  },
  accentBar: {
    height: 4,
    width: "100%",
  },
  passBody: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 12,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  orgBadge: {
    fontSize: 9.5,
    fontWeight: 600,
    color: "#E4E4E7",
    letterSpacing: 0.4,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#18181B",
    borderWidth: 1,
    borderColor: "#27272A",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2.5,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 7.5,
    fontWeight: 600,
    color: "#E4E4E7",
  },
  kicker: {
    marginTop: 10,
    fontSize: 7.5,
    color: "#A1A1AA",
    letterSpacing: 1.3,
    textTransform: "uppercase",
  },
  title: {
    fontSize: 16,
    fontWeight: 600,
    color: "#FFFFFF",
    marginTop: 2,
    lineHeight: 1.2,
  },
  fieldsGrid: {
    marginTop: 12,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  fieldCell: {
    width: "47%",
  },
  label: {
    fontSize: 7,
    color: "#A1A1AA",
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  value: {
    fontSize: 10,
    fontWeight: 600,
    color: "#FAFAFA",
    marginTop: 1.5,
  },
  tearWrap: {
    position: "relative",
    height: 14,
    justifyContent: "center",
  },
  tearLine: {
    borderBottomWidth: 1,
    borderBottomStyle: "dashed",
    borderBottomColor: "#2E2E35",
    marginHorizontal: 12,
  },
  notchLeft: {
    position: "absolute",
    left: -7,
    top: 0,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#F5F5F7",
  },
  notchRight: {
    position: "absolute",
    right: -7,
    top: 0,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#F5F5F7",
  },
  qrStub: {
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 14,
    alignItems: "center",
  },
  qrBox: {
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    padding: 8,
    alignItems: "center",
  },
  qr: {
    width: 96,
    height: 96,
  },
  code: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: 600,
    color: "#FFFFFF",
    letterSpacing: 2,
    textAlign: "center",
  },
  codeHint: {
    marginTop: 2,
    fontSize: 7.5,
    color: "#A1A1AA",
    textAlign: "center",
  },
  sectionsWrap: {
    marginTop: 10,
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E4E4E7",
    padding: 10,
    gap: 6,
  },
  sectionTitle: {
    fontSize: 8.5,
    fontWeight: 600,
    color: "#18181B",
    marginBottom: 1,
  },
  para: {
    fontSize: 8,
    color: "#52525B",
    lineHeight: 1.3,
  },
  footer: {
    position: "absolute",
    bottom: 12,
    left: 24,
    right: 24,
    fontSize: 7,
    color: "#A1A1AA",
    flexDirection: "row",
    justifyContent: "space-between",
  },
});

export type PassField = { label: string; value: string };
type PassDocProps = {
  kicker: string;
  title: string;
  org: string;
  fields: PassField[];
  code: string;
  codeHint: string;
  qrDataUrl: string;
  statusLabel: string;
  statusColor: string;
  accentColor?: string;
  sections?: { title: string; body: string }[];
};

function PassDocument(p: PassDocProps) {
  registerPdfFonts();
  return (
    <Document title={`${p.title} – ${p.kicker}`} author={BRAND_NAME} language="tr">
      <Page size="A5" style={s.page}>
        <View style={s.pass}>
          <View style={[s.accentBar, { backgroundColor: p.accentColor ?? "#FFFFFF" }]} />
          <View style={s.passBody}>
            <View style={s.headerRow}>
              <Text style={s.orgBadge}>{p.org}</Text>
              <View style={s.statusPill}>
                <View style={[s.statusDot, { backgroundColor: p.statusColor }]} />
                <Text style={s.statusText}>{p.statusLabel}</Text>
              </View>
            </View>

            <Text style={s.kicker}>{p.kicker}</Text>
            <Text style={s.title}>{p.title}</Text>

            <View style={s.fieldsGrid}>
              {p.fields.map((f) => (
                <View key={f.label} style={s.fieldCell}>
                  <Text style={s.label}>{f.label}</Text>
                  <Text style={s.value}>{f.value}</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={s.tearWrap}>
            <View style={s.tearLine} />
            <View style={s.notchLeft} />
            <View style={s.notchRight} />
          </View>

          <View style={s.qrStub}>
            <View style={s.qrBox}>
              {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image alt prop'u desteklemez */}
              <Image src={p.qrDataUrl} style={s.qr} />
            </View>
            <Text style={s.code}>{p.code}</Text>
            <Text style={s.codeHint}>{p.codeHint}</Text>
          </View>
        </View>

        {(p.sections ?? []).length > 0 ? (
          <View style={s.sectionsWrap} wrap={false}>
            {(p.sections ?? []).map((sec) => (
              <View key={sec.title}>
                <Text style={s.sectionTitle}>{sec.title}</Text>
                <Text style={s.para}>{sec.body}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={s.footer} fixed>
          <Text>{BRAND_NAME} · Wallet Pass</Text>
          <Text>{p.code}</Text>
        </View>
      </Page>
    </Document>
  );
}

const pdfCache = new Map<string, { buf: Buffer; expiresAt: number }>();

export async function renderPassPdf(props: PassDocProps): Promise<Buffer> {
  const key = createHash("sha1").update(JSON.stringify(props)).digest("hex");
  const hit = pdfCache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.buf;
  }
  const buf = await renderToBuffer(<PassDocument {...props} />);
  if (pdfCache.size >= 100) {
    const oldest = pdfCache.keys().next().value;
    if (oldest) pdfCache.delete(oldest);
  }
  pdfCache.set(key, { buf, expiresAt: Date.now() + 5 * 60_000 });
  return buf;
}
