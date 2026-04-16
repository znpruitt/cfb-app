# P7B-GAME-STATS-AUDIT — CFBD Game Team Stats Endpoint Audit

PROMPT_ID: P7B-GAME-STATS-AUDIT-v1
PURPOSE: Understand the CFBD game team stats endpoint structure, response shape, and how it maps to existing app data models before building the pipeline.
SCOPE: Read-only audit. No code changes.

---

## 1. Existing CFBD Integration Pattern

### URL Builder (`src/lib/cfbd.ts`)

Constructs CFBD v2 API URLs at `api.collegefootballdata.com`. Currently covers:
- `/games` (schedule)
- `/conferences`
- `/rankings`
- `/teams/fbs`
- `/ratings/sp`

No `/games/teams` URL builder exists yet. A new `buildCfbdGameTeamStatsUrl` function is needed.

### Fetch / Normalize / Cache Pattern (`src/app/api/schedule/route.ts`)

1. **Cache check**: In-memory object → `appStateStore` (Postgres) → stale fallback for non-admin traffic
2. **Upstream fetch**: `fetchUpstreamJson<T>()` with retry policy (3 attempts, backoff, jitter) and pacing (`minIntervalMs: 150`)
3. **Normalize**: Raw CFBD response mapped through a normalizer function to internal types
4. **Persist**: Write to both in-memory cache and `appStateStore` with `scope`/`key` convention
5. **Admin-gated refresh**: `bypassCache` requires admin auth; public traffic serves cached data

### Scores Route (`src/app/api/scores/route.ts`)

Same pattern with:
- `appStateStore` scope: `'scores'`, key: `'${year}-${week ?? 'all'}-${seasonType}'`
- CFBD primary with ESPN fallback
- 5-minute TTL
- No admin gating (scores refresh on public traffic)

### Shared HTTP Utility (`src/lib/api/fetchUpstream.ts`)

`fetchUpstreamJson<T>()` and `fetchUpstreamResponse()` provide:
- Configurable timeout
- Retry with exponential backoff + jitter
- Request pacing (rate limiting per key)
- Structured errors: `UpstreamFetchError` with kind `timeout | aborted | network | http | parse`

---

## 2. Score / Odds Attachment to Schedule Games

### Score Attachment (`src/lib/scoreAttachment.ts`)

The score attachment system is the blueprint for game stats attachment.

**ScheduleIndex** is built from schedule games, indexed by:
- `byProviderGameId` — strongest key (CFBD game ID)
- `byHomeAwayWeek` — `${seasonType}::${week}::${homeIdentityKey}::${awayIdentityKey}`
- `byPairWeek` — pair key (sorted) + week + season type
- `byPairDate` — pair key + date (18-hour tolerance)

**Matching priority**:
1. Provider event ID (CFBD game `id`)
2. Exact home/away + week
3. Reversed pair + week
4. Pair + date tolerance

**Key insight for game stats**: The CFBD `/games/teams` response includes a game `id` field that maps directly to `AppGame.providerGameId`. Since both schedule and game stats come from CFBD, there is no cross-provider mismatch (unlike CFBD/ESPN for scores). Attachment by `providerGameId` should be nearly 100% reliable.

### Team Identity (`src/lib/teamIdentity.ts`)

`TeamIdentityResolver` normalizes raw team names to canonical identity keys:
- Direct canonical registry lookup
- Alias map resolution
- `normalizeTeamName()` for string normalization

The `school` field in the game team stats response is identical to what CFBD returns in schedule games. Resolution via `resolver.resolveName(school)` should work directly.

---

## 3. CFBD `/games/teams` API Response Shape

### Endpoint

```
GET https://api.collegefootballdata.com/games/teams
```

Note: The existing codebase uses `api.collegefootballdata.com` (v2). The endpoint also exists on `apinext.collegefootballdata.com` (v3).

### Parameters

| Param | Type | Required | Notes |
|-------|------|----------|-------|
| `year` | integer | Yes (unless `gameId`) | Min 2001 |
| `week` | integer | No | 1–16 |
| `seasonType` | string | No | `'regular'` or `'postseason'` |
| `team` | string | No | Filter by team name |
| `conference` | string | No | Filter by conference abbreviation |
| `gameId` | integer | No | Retrieve single game |
| `classification` | string | No | `'fbs'`, `'fcs'`, etc. |

### Response Shape

```typescript
// Returns: Array<CfbdGameTeamStats>
type CfbdGameTeamStats = {
  id: number;                          // CFBD game ID → maps to AppGame.providerGameId
  teams: CfbdGameTeamStatsTeam[];      // Always 2 entries: home + away
};

type CfbdGameTeamStatsTeam = {
  schoolId: number;                    // CFBD team integer ID
  school: string;                      // Team name (e.g., "Alabama", "Ohio State")
  conference: string;                  // Conference name (e.g., "SEC", "Big Ten")
  homeAway: 'home' | 'away';          // Side designation
  points: number;                      // Points scored
  stats: CfbdTeamStatEntry[];          // Array of category/stat pairs
};

type CfbdTeamStatEntry = {
  category: string;                    // Stat category name (see table below)
  stat: string;                        // Value as string (numeric, fraction, or time)
};
```

### Stat Categories

All `stat` values are returned as **strings**. Some require parsing.

| Category | Example Value | Format | Notes |
|----------|--------------|--------|-------|
| `totalYards` | `"425"` | integer | Total offensive yards |
| `netPassingYards` | `"275"` | integer | Net passing yards |
| `passAttempts` | `"35"` | integer | Pass attempts |
| `passCompletions` | `"22"` | integer | Pass completions |
| `passingTDs` | `"3"` | integer | Passing touchdowns |
| `rushingYards` | `"150"` | integer | Rushing yards |
| `rushingAttempts` | `"30"` | integer | Rushing attempts |
| `rushingTDs` | `"2"` | integer | Rushing touchdowns |
| `firstDowns` | `"22"` | integer | Total first downs |
| `thirdDownEff` | `"6-14"` | fraction | Third down conversions/attempts |
| `fourthDownEff` | `"1-2"` | fraction | Fourth down conversions/attempts |
| `totalPenaltiesYards` | `"7-65"` | fraction | Penalty count/yards |
| `turnovers` | `"2"` | integer | Total turnovers |
| `fumblesLost` | `"1"` | integer | Fumbles lost |
| `interceptions` | `"1"` | integer | Interceptions thrown (offense) |
| `possessionTime` | `"32:15"` | MM:SS | Time of possession |
| `fumblesRecovered` | `"1"` | integer | Fumbles recovered (defense) |
| `passesIntercepted` | `"2"` | integer | Passes intercepted (defense) |
| `interceptionYards` | `"45"` | integer | Interception return yards |
| `interceptionTDs` | `"1"` | integer | Interception return TDs |
| `kickReturns` | `"3"` | integer | Kick return attempts |
| `kickReturnYards` | `"85"` | integer | Kick return yards |
| `kickReturnTDs` | `"0"` | integer | Kick return TDs |
| `puntReturns` | `"2"` | integer | Punt return attempts |
| `puntReturnYards` | `"25"` | integer | Punt return yards |
| `puntReturnTDs` | `"0"` | integer | Punt return TDs |

**Parsing notes**:
- Integer stats: `parseInt(stat, 10)`
- Fraction stats (`thirdDownEff`, `fourthDownEff`, `totalPenaltiesYards`): split on `"-"` → `[conversions, attempts]` or `[count, yards]`
- `possessionTime`: split on `":"` → `minutes * 60 + seconds` for numeric aggregation

---

## 4. Mapping to App Data Model

### Team Identity Mapping

- `school` → `resolver.resolveName(school)` → canonical identity key (same provider as schedule)
- `homeAway` → side designation (no need for reversal detection in most cases)
- `id` → `AppGame.providerGameId` — primary attachment key

### Owner-Level Aggregation Strategy

Given owner → team assignments from the roster, owner-level stats are derived by:

1. **Per game**: Look up each owned team's stats row by `providerGameId` + team identity
2. **Per week**: Aggregate across all games owned teams played that week
3. **Season-to-date**: Rolling accumulation across all completed weeks

### Most Useful Owner-Level Stats

| Stat | Derivation | Insight Value |
|------|-----------|---------------|
| Points per game | avg(points) across owned teams | Core performance |
| Total yards per game | avg(totalYards) | Offensive production |
| Turnover margin | (fumblesRecovered + passesIntercepted) - turnovers | Ball security vs. forcing turnovers |
| Third down efficiency | sum(conversions) / sum(attempts) | Offensive sustainability |
| Yards allowed per game | avg(opponent totalYards) | Defensive quality |
| Possession time advantage | owned TOP - opponent TOP | Game control |
| Rushing yards per game | avg(rushingYards) | Ground game strength |
| Passing yards per game | avg(netPassingYards) | Passing game strength |
| Penalty yards per game | avg(penaltyYards) | Discipline |

Note: "Opponent" stats are available in the same response — each game has both teams' stats, so deriving opponent stats requires matching the other team entry in the `teams` array for each game.

### Attachment Strategy

Since game stats and schedule both come from CFBD:
1. **Primary**: Match on `id` (CFBD game ID) → `AppGame.providerGameId`
2. **Fallback**: Match on `school` + `homeAway` + `week` using `ScheduleIndex` from `scoreAttachment.ts`

This is simpler than score attachment because there is no cross-provider mismatch.

---

## 5. Storage Requirements

### Response Size

- ~65 FBS games per week × 2 teams × ~27 stat entries × ~40 bytes/entry ≈ **~140 KB per week** (raw JSON)
- Full regular season (15 weeks): ~2.1 MB total
- Including postseason: ~2.3 MB total
- Well within `appStateStore` Postgres capacity

### Storage Recommendation: Per-Week

**Scope**: `'game-stats'`
**Key**: `'${year}:${week}:${seasonType}'`
**Value**: `GameStatsCacheEntry` (see data model below)

Per-week storage (not accumulated season-to-date) because:
1. Matches the API fetch granularity (one call per week)
2. Matches the existing scores cache pattern
3. Enables per-week cache invalidation without touching other weeks
4. Season-to-date aggregation is cheap — sum across cached weeks at query time
5. Minimizes storage writes — each week written once after Monday cron

### Cron Scheduling

- **Monday 11:00 UTC** — after weekend games complete; complements existing daily midnight UTC season-transition cron
- Fetch stats for the most recent completed week
- ~19 API calls per season (15 regular + 4 postseason) — negligible against 1,000/month CFBD budget
- Consider backfilling all weeks 1–current on first run to cover early-season gaps

### Existing `appStateStore` Key Patterns (for reference)

| Scope | Key Pattern | Example |
|-------|------------|---------|
| `schedule` | `${year}-${week}-${seasonType}` | `2025-all-all` |
| `scores` | `${year}-${week}-${seasonType}` | `2025-1-regular` |
| `rankings` | `${season}` | `2025` |
| `sp-ratings` | `${year}` | `2025` |
| `odds-cache` | `${season}:${cacheKey}` | `2025:2025-1-regular` |
| **game-stats** | **`${year}:${week}:${seasonType}`** | **`2025:1:regular`** |

---

## 6. Recommended Data Model

### Raw CFBD Types (wire format)

```typescript
type CfbdGameTeamStatsRaw = {
  id: number;
  teams: Array<{
    schoolId: number;
    school: string;
    conference: string;
    homeAway: string;
    points: number;
    stats: Array<{ category: string; stat: string }>;
  }>;
};
```

### Normalized Internal Types

```typescript
type GameTeamStatsPack = {
  gameId: number;                       // CFBD game ID (attachment key)
  teams: NormalizedTeamStats[];
};

type NormalizedTeamStats = {
  school: string;                       // Raw team name from CFBD
  schoolId: number;
  conference: string;
  homeAway: 'home' | 'away';
  points: number;
  stats: Record<string, string>;        // category → raw stat value (strings preserved)
};
```

### Cache Entry (stored in appStateStore)

```typescript
type GameStatsCacheEntry = {
  at: number;                           // Timestamp (Date.now())
  year: number;
  week: number;
  seasonType: 'regular' | 'postseason';
  games: GameTeamStatsPack[];
};
```

### Parsed Numeric Stats (derived at query time, not stored)

```typescript
type ParsedTeamGameStats = {
  totalYards: number;
  netPassingYards: number;
  rushingYards: number;
  passAttempts: number;
  passCompletions: number;
  passingTDs: number;
  rushingAttempts: number;
  rushingTDs: number;
  firstDowns: number;
  turnovers: number;
  fumblesLost: number;
  interceptions: number;                // Thrown by offense
  passesIntercepted: number;            // Caught by defense
  fumblesRecovered: number;             // Recovered by defense
  thirdDownConversions: number;
  thirdDownAttempts: number;
  fourthDownConversions: number;
  fourthDownAttempts: number;
  penaltyCount: number;
  penaltyYards: number;
  possessionTimeSeconds: number;
  points: number;
};
```

### API Route

```
GET /api/game-stats?year=2025&week=1&seasonType=regular
```

Following the scores/schedule pattern:
- In-memory cache → appStateStore → upstream CFBD fetch
- Admin-gated refresh
- Cron endpoint: `GET /api/cron/game-stats` (vercel.json: Monday 11:00 UTC)

### URL Builder Addition (`src/lib/cfbd.ts`)

```typescript
export function buildCfbdGameTeamStatsUrl(params: {
  year: number;
  week?: number | null;
  seasonType?: CfbdSeasonType;
}): URL {
  const url = new URL('https://api.collegefootballdata.com/games/teams');
  url.searchParams.set('year', String(params.year));
  if (typeof params.week === 'number') {
    url.searchParams.set('week', String(params.week));
  }
  if (params.seasonType) {
    url.searchParams.set('seasonType', params.seasonType);
  }
  return url;
}
```

---

## 7. Implementation Checklist (for Codex prompt)

1. Add `buildCfbdGameTeamStatsUrl` to `src/lib/cfbd.ts`
2. Create `src/lib/gameStats/types.ts` — wire + normalized + cache types
3. Create `src/lib/gameStats/normalizers.ts` — CFBD raw → `GameTeamStatsPack`
4. Create `src/lib/gameStats/parsers.ts` — string → numeric parsing (fraction, MM:SS)
5. Create `src/app/api/game-stats/route.ts` — fetch/cache/serve route
6. Create `src/app/api/game-stats/cache.ts` — cache entry type + in-memory store
7. Create `src/app/api/cron/game-stats/route.ts` — Monday 11 UTC cron
8. Update `vercel.json` — add cron entry
9. Create `src/lib/gameStats/attachment.ts` — attach stats to schedule via `providerGameId`
10. Create `src/lib/gameStats/ownerAggregation.ts` — aggregate stats across owned teams
