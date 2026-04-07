import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';

import { SEED_ALIASES, type AliasMap } from '../../lib/teamNames';
import { bootstrapAliasesAndCaches } from '../../lib/bootstrap';
import type { AppGame } from '../../lib/schedule';

type UseScheduleBootstrapParams = {
  hasBootstrappedRef: MutableRefObject<boolean>;
  selectedSeason: number;
  leagueSlug?: string;
  setAliasMap: (next: AliasMap) => void;
  setIssues: Dispatch<SetStateAction<string[]>>;
  setHasCachedOwners: (next: boolean) => void;
  setManualPostseasonOverrides: (next: Record<string, Partial<AppGame>>) => void;
  loadScheduleFromApi: (
    overrideAliasMap?: AliasMap,
    overrideManualOverrides?: Record<string, Partial<AppGame>>
  ) => Promise<boolean>;
  setOwnersLoadedFromCache: (next: boolean) => void;
  tryParseOwnersCSV: (text: string) => void;
};

export function useScheduleBootstrap(params: UseScheduleBootstrapParams): void {
  const {
    hasBootstrappedRef,
    selectedSeason,
    leagueSlug,
    setAliasMap,
    setIssues,
    setHasCachedOwners,
    setManualPostseasonOverrides,
    loadScheduleFromApi,
    setOwnersLoadedFromCache,
    tryParseOwnersCSV,
  } = params;

  const lastLeagueSlugRef = useRef<string | undefined>(leagueSlug);

  useEffect(() => {
    // Reset bootstrap guard when the league changes so data reloads.
    if (leagueSlug !== lastLeagueSlugRef.current) {
      lastLeagueSlugRef.current = leagueSlug;
      hasBootstrappedRef.current = false;
    }

    if (hasBootstrappedRef.current) return;
    hasBootstrappedRef.current = true;

    (async () => {
      const {
        aliasMap: bootAliasMap,
        aliasLoadIssue,
        ownersCsvText,
        ownersLoadIssue,
        postseasonOverrides: loadedOverrides,
        postseasonOverridesLoadIssue,
      } = await bootstrapAliasesAndCaches({
        season: selectedSeason,
        seedAliases: SEED_ALIASES,
        leagueSlug,
      });

      setAliasMap(bootAliasMap);
      if (aliasLoadIssue) setIssues((p) => [...p, aliasLoadIssue]);
      if (ownersLoadIssue) setIssues((p) => [...p, ownersLoadIssue]);
      if (postseasonOverridesLoadIssue) setIssues((p) => [...p, postseasonOverridesLoadIssue]);

      setHasCachedOwners(Boolean(ownersCsvText));
      setManualPostseasonOverrides(loadedOverrides);

      await loadScheduleFromApi(bootAliasMap, loadedOverrides);

      if (ownersCsvText) {
        setOwnersLoadedFromCache(true);
        tryParseOwnersCSV(ownersCsvText);
      }
    })();
  }, [
    hasBootstrappedRef,
    leagueSlug,
    loadScheduleFromApi,
    selectedSeason,
    setAliasMap,
    setHasCachedOwners,
    setIssues,
    setManualPostseasonOverrides,
    setOwnersLoadedFromCache,
    tryParseOwnersCSV,
  ]);
}
