export type LegalLang = "tr" | "en";
export type Block = { p?: string; ul?: string[]; ol?: string[] };
export type LegalSection = { id: string; title: string; blocks: Block[] };
export type LegalBody = { title: string; intro: string; sections: LegalSection[] };
export type LegalDocId =
  | "terms"
  | "privacy"
  | "kvkk"
  | "consent"
  | "cookies"
  | "deletion"
  | "influencer"
  | "brand"
  | "distance"
  | "refund"
  | "iys";
