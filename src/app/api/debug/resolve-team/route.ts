import { NextResponse } from 'next/server';

import { createTeamIdentityResolver } from '@/lib/teamIdentity';
import { normalizeTeamName } from '@/lib/teamNormalization';
import { requireAdminAuth } from '@/lib/server/adminAuth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const authFailure = await requireAdminAuth(req);
  if (authFailure) return authFailure;

  const url = new URL(req.url);
  const name = url.searchParams.get('name') ?? '';
  const year = Number(url.searchParams.get('year') ?? new Date().getFullYear());
  const origin = `${url.protocol}//${url.host}`;

  const [teamsRes, aliasesRes] = await Promise.all([
    fetch(`${origin}/api/teams`, { cache: 'no-store' }),
    // Effective scope (stored global > year > SEED_ALIASES) — resolve against the
    // same alias precedence production uses, not the year-only stored subset
    // (PLATFORM-076).
    fetch(`${origin}/api/aliases?year=${year}&scope=effective`, { cache: 'no-store' }),
  ]);

  const teamsJson = (await teamsRes.json().catch(() => ({ items: [] }))) as {
    items?: Array<Record<string, unknown>>;
  };
  const aliasesJson = (await aliasesRes.json().catch(() => ({ map: {} }))) as {
    map?: Record<string, string>;
  };
  const effectiveAliasMap = aliasesJson.map ?? {};

  const observedNames = name ? [name] : [];
  const resolver = createTeamIdentityResolver({
    teams: (teamsJson.items ?? []) as never[],
    aliasMap: effectiveAliasMap,
    observedNames,
  });

  const result = resolver.resolveName(name);
  const canonical = result.identityKey ? resolver.getRegistry().get(result.identityKey) : null;

  // Surface the manual alias override (if any) that maps this provider label in
  // the effective map, so the diagnostic shows WHY a name resolved via alias.
  const normalizedName = normalizeTeamName(name);
  const aliasTarget =
    effectiveAliasMap[normalizedName] ?? effectiveAliasMap[name.trim().toLowerCase()] ?? null;
  const manualAliasOverride =
    result.resolutionSource === 'alias' || aliasTarget
      ? { from: name, normalizedKey: normalizedName, to: aliasTarget ?? result.canonicalName }
      : null;

  return NextResponse.json({
    rawProviderName: name,
    normalizedName,
    aliasScope: 'effective',
    observedNames,
    canonicalMatch: result.status === 'resolved',
    aliasMatch: result.resolutionSource === 'alias',
    manualAliasOverride,
    canonicalId: result.identityKey,
    subdivision: canonical?.subdivision ?? null,
    isOwnable: canonical?.isOwnable ?? false,
    owner: canonical?.owner ?? null,
    issueClassification:
      result.status === 'resolved' ? null : (result.notes ?? 'identity-unresolved'),
  });
}
