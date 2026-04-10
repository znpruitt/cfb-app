export type LeagueStatus =
  | { state: 'season'; year: number }
  | { state: 'offseason' }
  | { state: 'preseason'; year: number };

export type League = {
  slug: string; // URL identifier — permanent, lowercase alphanumeric with hyphens
  displayName: string; // Human-readable name shown in UI
  year: number; // Active season year
  createdAt: string; // ISO timestamp
  foundedYear?: number; // Year the league was founded — auto-set on creation, commissioner-editable
  status?: LeagueStatus;
  assignmentMethod?: 'draft' | 'manual' | null; // How teams are assigned each preseason
};
