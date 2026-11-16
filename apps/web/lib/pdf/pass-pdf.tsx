import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { BRAND_NAME } from "@infulancer/core/brand";
import { registerPdfFonts } from "./fonts";

const s = StyleSheet.create({
  page: {
    fontFamily: "Geist",
    fontSize: 10,
    color: "#171717",
    backgroundColor: "#F5F5F7",
    paddingHorizontal: 36,
    paddingVertical: 32,
    lineHeight: 1.4,
  },
  pass: {
    backgroundColor: "#0F0F12",
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#27272A",
  },
  accentBar: {
    height: 5,
    width: "100%",
  },
  passBody: {
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 16,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  orgBadge: {
    fontSize: 10,
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
    paddingVertical: 3,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 8,
    fontWeight: 600,
    color: "#E4E4E7",
  },
  kicker: {
    marginTop: 14,
    fontSize: 8,
    color: "#A1A1AA",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  title: {
    fontSize: 19,
    fontWeight: 600,
    color: "#FFFFFF",
    marginTop: 3,
    lineHeight: 1.25,
  },
  fieldsGrid: {
    marginTop: 16,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  fieldCell: {
    width: "46%",
  },
  label: {
    fontSize: 7.5,
    color: "#A1A1AA",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  value: {
    fontSize: 11,
    fontWeight: 600,
    color: "#FAFAFA",
    marginTop: 2,
  },
  tearWrap: {
    position: "relative",
    height: 18,
    justifyContent: "center",
  },
  tearLine: {
    borderBottomWidth: 1,
    borderBottomStyle: "dashed",
    borderBottomColor: "#2E2E35",
    marginHorizontal: 14,
  },
  notchLeft: {
    position: "absolute",
    left: -9,
    top: 0,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#F5F5F7",
  },
  notchRight: {
    position: "absolute",
    right: -9,
    top: 0,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#F5F5F7",
  },
  qrStub: {
    paddingHorizontal: 22,
    paddingTop: 10,
    paddingBottom: 20,
    alignItems: "center",
  },
  qrBox: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    padding: 10,
    alignItems: "center",
  },
  qr: {
    width: 128,
    height: 128,
  },
  code: {
    marginTop: 10,
    fontSize: 13,
    fontWeight: 600,
    color: "#FFFFFF",
    letterSpacing: 2.2,
    textAlign: "center",
  },
  codeHint: {
    marginTop: 3,
    fontSize: 8,
    color: "#A1A1AA",
    textAlign: "center",
  },
  sectionsWrap: {
    marginTop: 16,
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E4E4E7",
    padding: 14,
    gap: 10,
  },
  sectionTitle: {
    fontSize: 9.5,
    fontWeight: 600,
    color: "#18181B",
    marginBottom: 2,
  },
  para: {
    fontSize: 8.5,
    color: "#52525B",
    lineHeight: 1.4,
  },
  footer: {
    position: "absolute",
    bottom: 18,
    left: 36,
    right: 36,
    fontSize: 7.5,
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

export function renderPassPdf(props: PassDocProps): Promise<Buffer> {
  return renderToBuffer(<PassDocument {...props} />);
}
