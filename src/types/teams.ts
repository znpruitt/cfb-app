// src/types/teams.ts
export type TeamCatalogItem = {
  id?: string | null;
  providerId?: number | null;
  school: string;
  displayName?: string | null;
  shortDisplayName?: string | null;
  abbreviation?: string | null;
  mascot: string | null;
  conference: string | null;
  classification?: string | null;
  level?: string | null;
  color?: string | null;
  altColor?: string | null;
  logos?: string[];
  alts: string[];
};

export type TeamCatalogResponse = {
  year: number;
  items: TeamCatalogItem[];
};
