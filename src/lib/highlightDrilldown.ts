export type HighlightSeasonTab = 'week' | 'postseason';

export type HighlightDrilldownTarget =
  | {
      kind: 'game';
      gameId: string;
      destination: 'schedule';
      seasonTab: HighlightSeasonTab;
      week: number | null;
      expand?: boolean;
      focus?: boolean;
    }
  | {
      kind: 'owner';
      owner: string;
      destination: 'standings' | 'matchups';
      seasonTab: HighlightSeasonTab;
      week: number | null;
      focus?: boolean;
    }
  | {
      kind: 'owner_pair';
      owners: [string, string];
      destination: 'matchups' | 'matrix';
      seasonTab: HighlightSeasonTab;
      week: number | null;
      focus?: boolean;
    };
