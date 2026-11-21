export type CampaignCatalogEntry = {
  id: string;
  kind: "sector" | "template";
  name: string;
  sector?: string;
  active: boolean;
};

export const CAMPAIGN_CATALOG_KEY = "campaign.catalog";
