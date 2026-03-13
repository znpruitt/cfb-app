import { NextResponse } from 'next/server';

import { createTeamIdentityResolver } from '@/lib/teamIdentity';
import { normalizeTeamName } from '@/lib/teamNormalization';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const name = url.searchParams.get('name') ?? '';
  const year = Number(url.searchParams.get('year') ?? new Date().getFullYear());
  const origin = `${url.protocol}//${url.host}`;

  const [teamsRes, aliasesRes] = await Promise.all([
    fetch(`${origin}/api/teams`, { cache: 'no-store' }),
    fetch(`${origin}/api/aliases?year=${year}`, { cache: 'no-store' }),
  ]);

  const teamsJson = (await teamsRes.json().catch(() => ({ items: [] }))) as {
    items?: Array<Record<string, unknown>>;
  };
  const aliasesJson = (await aliasesRes.json().catch(() => ({ map: {} }))) as {
    map?: Record<string, string>;
  };

  const resolver = createTeamIdentityResolver({
    teams: (teamsJson.items ?? []) as never[],
    aliasMap: aliasesJson.map ?? {},
    observedNames: name ? [name] : [],
  });

  const result = resolver.resolveName(name);
  const canonical = result.identityKey ? resolver.getRegistry().get(result.identityKey) : null;

  return NextResponse.json({
    rawProviderName: name,
    normalizedName: normalizeTeamName(name),
    canonicalMatch: result.status === 'resolved',
    aliasMatch: result.resolutionSource === 'alias',
    canonicalId: result.identityKey,
    subdivision: canonical?.subdivision ?? null,
    isOwnable: canonical?.isOwnable ?? false,
    owner: canonical?.owner ?? null,
    issueClassification:
      result.status === 'resolved' ? null : (result.notes ?? 'identity-unresolved'),
  });
}
