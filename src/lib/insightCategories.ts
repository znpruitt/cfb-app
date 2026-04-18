export type InsightCategoryConfig = {
  label: string;
  lightColor: string;
  darkColor: string;
};

export const INSIGHT_CATEGORY_CONFIG: Record<string, InsightCategoryConfig> = {
  historical: { label: 'HISTORICAL', lightColor: '#534AB7', darkColor: '#AFA9EC' },
  rivalry: { label: 'RIVALRY', lightColor: '#993C1D', darkColor: '#F0997B' },
  career: { label: 'CAREER', lightColor: '#0F6E56', darkColor: '#5DCAA5' },
  trajectory: { label: 'TRAJECTORY', lightColor: '#993556', darkColor: '#ED93B1' },
  stats_outliers: { label: 'STATS', lightColor: '#5F5E5A', darkColor: '#B4B2A9' },
  championship_race: { label: 'STANDINGS', lightColor: '#534AB7', darkColor: '#AFA9EC' },
  season_wrap: { label: 'SEASON', lightColor: '#534AB7', darkColor: '#AFA9EC' },
  narrative: { label: 'LEAGUE', lightColor: '#5F5E5A', darkColor: '#B4B2A9' },
};

const FALLBACK: InsightCategoryConfig = {
  label: 'INSIGHT',
  lightColor: '#5F5E5A',
  darkColor: '#B4B2A9',
};

export function getCategoryConfig(category: string | undefined | null): InsightCategoryConfig {
  if (!category) return FALLBACK;
  const entry = INSIGHT_CATEGORY_CONFIG[category];
  if (entry) return entry;
  return { ...FALLBACK, label: category.toUpperCase() };
}
