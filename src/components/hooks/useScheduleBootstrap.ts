import {
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';

import { SEED_ALIASES, type AliasMap } from '../../lib/teamNames';
import { bootstrapAliasesAndCaches } from '../../lib/bootstrap';
import type { AppGame } from '../../lib/schedule';

type UseScheduleBootstrapParams = {
  hasBootstrappedRef: MutableRefObject<boolean>;
  selectedSeason: number;
  leagueSlug?: string;
  setEffectiveAliasMap: (next: AliasMap) => void;
  setIssues: Dispatch<SetStateAction<string[]>>;
  setManualPostseasonOverrides: (next: Record<string, Partial<AppGame>>) => void;
  loadScheduleFromApi: (
    overrideAliasMap?: AliasMap,
    overrideManualOverrides?: Record<string, Partial<AppGame>>
  ) => Promise<boolean>;
  tryParseOwnersCSV: (text: string) => void;
};

export function useScheduleBootstrap(params: UseScheduleBootstrapParams): void {
  const {
    hasBootstrappedRef,
    selectedSeason,
    leagueSlug,
    setEffectiveAliasMap,
    setIssues,
    setManualPostseasonOverrides,
    loadScheduleFromApi,
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
        effectiveAliasMap: bootEffectiveAliasMap,
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

      setEffectiveAliasMap(bootEffectiveAliasMap);
      if (aliasLoadIssue) setIssues((p) => [...p, aliasLoadIssue]);
      if (ownersLoadIssue) setIssues((p) => [...p, ownersLoadIssue]);
      if (postseasonOverridesLoadIssue) setIssues((p) => [...p, postseasonOverridesLoadIssue]);

      setManualPostseasonOverrides(loadedOverrides);

      // Build the client schedule with the EFFECTIVE map so client game identity
      // matches server canonical.
      await loadScheduleFromApi(bootEffectiveAliasMap, loadedOverrides);

      if (ownersCsvText) {
        tryParseOwnersCSV(ownersCsvText);
      }
    })();
  }, [
    hasBootstrappedRef,
    leagueSlug,
    loadScheduleFromApi,
    selectedSeason,
    setEffectiveAliasMap,
    setIssues,
    setManualPostseasonOverrides,
    tryParseOwnersCSV,
  ]);
}
