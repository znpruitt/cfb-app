// src/types/teams.ts
export type TeamCatalogItem = {
  school: string;
  mascot: string | null;
  conference: string | null;
  classification: string | null;
  alts: string[];
};

export type TeamCatalogResponse = {
  year: number;
  items: TeamCatalogItem[];
};
