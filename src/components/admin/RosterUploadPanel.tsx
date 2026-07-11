'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

import { getAdminAuthHeaders } from '@/lib/adminAuth';
import { OWNER_ROSTER_OVERWRITE_ERROR } from '@/lib/ownerRosterGuard';
import type { PublicLeague } from '@/lib/league';
import type {
  RosterValidationResult,
  ResolvedEntry,
  UnresolvedEntry,
} from '@/lib/rosterUploadValidator';
import { seasonYearForToday } from '@/lib/scores/normalizers';

type Props = {
  leagues: PublicLeague[];
};

type ValidationResponse = RosterValidationResult & { fbsTeams: string[] };
type Phase = 'upload' | 'review' | 'done';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function csvField(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildResolvedCsv(
  resolved: ResolvedEntry[],
  needsConfirmation: UnresolvedEntry[],
  resolutions: Map<string, string>
): string {
  const rows = [
    ...resolved.map((r) => ({ team: r.canonicalName, owner: r.owner })),
    ...needsConfirmation.map((item) => ({
      team: resolutions.get(item.inputName) ?? item.inputName,
      owner: item.owner,
    })),
  ];
  return ['Team,Owner', ...rows.map((r) => `${csvField(r.team)},${csvField(r.owner)}`)].join('\n');
}

function confidenceLabel(confidence: number): string {
  if (confidence >= 0.9) return 'High';
  if (confidence >= 0.75) return 'Medium';
  return 'Low';
}

function confidenceColor(confidence: number): string {
  if (confidence >= 0.9) return 'text-green-600 dark:text-green-400';
  if (confidence >= 0.75) return 'text-amber-600 dark:text-amber-400';
  return 'text-orange-600 dark:text-orange-400';
}

// ---------------------------------------------------------------------------
// FBS team picker sub-component
// ---------------------------------------------------------------------------

type TeamPickerProps = {
  fbsTeams: string[];
  onSelect: (canonical: string) => void;
};

function TeamPicker({ fbsTeams, onSelect }: TeamPickerProps): React.ReactElement {
  const [search, setSearch] = useState('');
  const lower = search.toLowerCase();
  const filtered = fbsTeams
    .filter((t) => t.toLowerCase().includes(lower))
    .sort((a, b) => a.localeCompare(b));

  return (
    <div className="mt-2 space-y-1">
      <input
        type="text"
        placeholder="Search FBS teams…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full rounded border border-gray-300 bg-gray-50 px-2 py-1 text-xs text-gray-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
        autoFocus
      />
      <select
        size={6}
        className="w-full rounded border border-gray-300 bg-gray-50 px-1 py-0.5 text-xs text-gray-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
        onChange={(e) => {
          if (e.target.value) onSelect(e.target.value);
        }}
      >
        {filtered.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function RosterUploadPanel({ leagues }: Props): React.ReactElement {
  const router = useRouter();
  const defaultLeague = leagues[0];
  const [slug, setSlug] = useState(defaultLeague?.slug ?? '');
  const [year, setYear] = useState(defaultLeague?.year ?? seasonYearForToday());
  const [csvText, setCsvText] = useState('');
  const [phase, setPhase] = useState<Phase>('upload');

  // Validation phase
  const [validating, setValidating] = useState(false);
  const [validateError, setValidateError] = useState<string | null>(null);
  const [validation, setValidation] = useState<ValidationResponse | null>(null);
  const [resolutions, setResolutions] = useState<Map<string, string>>(new Map());
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [confirmedCollapsed, setConfirmedCollapsed] = useState(true);

  // Upload phase
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<{ teams: number; aliases: number } | null>(null);
  // Pending upload awaiting an explicit active-season overwrite override
  // (PLATFORM-083). Non-null → show the confirmation prompt.
  const [overwritePending, setOverwritePending] = useState<{
    val: ValidationResponse;
    resolvedMap: Map<string, string>;
  } | null>(null);

  function handleLeagueChange(newSlug: string) {
    setSlug(newSlug);
    const league = leagues.find((l) => l.slug === newSlug);
    setYear(league?.year ?? seasonYearForToday());
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setCsvText((ev.target?.result as string) ?? '');
    reader.readAsText(file);
  }

  async function handleValidate() {
    setValidateError(null);
    setValidating(true);
    setResolutions(new Map());
    setPickerFor(null);
    try {
      const leagueParam = slug ? `&league=${encodeURIComponent(slug)}` : '';
      const res = await fetch(`/api/owners/validate?year=${year}${leagueParam}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...getAdminAuthHeaders() },
        body: JSON.stringify({ csvText }),
      });
      if (!res.ok) {
        const text = await res.text();
        setValidateError(text || `Validation failed (${res.status})`);
        return;
      }
      const data = (await res.json()) as ValidationResponse;
      setValidation(data);
      if (data.isComplete) {
        await completeUpload(data, new Map(), false);
      } else {
        setPhase('review');
      }
    } catch (err) {
      setValidateError(err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setValidating(false);
    }
  }

  function handleConfirmSuggestion(inputName: string, canonical: string) {
    setResolutions((prev) => {
      const next = new Map(prev);
      next.set(inputName, canonical);
      return next;
    });
    setPickerFor(null);
  }

  async function handleCompleteUpload() {
    if (!validation) return;
    await completeUpload(validation, resolutions, false);
  }

  async function completeUpload(
    val: ValidationResponse,
    resolvedMap: Map<string, string>,
    override: boolean
  ) {
    setUploadError(null);
    setUploading(true);
    try {
      const leagueParam = slug ? `&league=${encodeURIComponent(slug)}` : '';
      const overrideParam = override ? '&override=1' : '';
      const resolvedCsv = buildResolvedCsv(val.resolved, val.needsConfirmation, resolvedMap);

      const ownersRes = await fetch(`/api/owners?year=${year}${leagueParam}${overrideParam}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', ...getAdminAuthHeaders() },
        body: JSON.stringify({ csvText: resolvedCsv }),
      });
      if (!ownersRes.ok) {
        const raw = await ownersRes.text();
        let parsed: { error?: string; message?: string } | null = null;
        try {
          parsed = JSON.parse(raw) as { error?: string; message?: string };
        } catch {
          parsed = null;
        }
        // Active-season overwrite guard: prompt for explicit confirmation, then
        // resend with the override, instead of surfacing a raw error.
        if (ownersRes.status === 409 && parsed?.error === OWNER_ROSTER_OVERWRITE_ERROR) {
          setOverwritePending({ val, resolvedMap });
          return;
        }
        setUploadError(parsed?.message ?? raw ?? `Upload failed (${ownersRes.status})`);
        return;
      }
      setOverwritePending(null);

      // Save confirmed fuzzy matches as global aliases
      const aliasesToSave: Record<string, string> = {};
      for (const [inputName, canonicalName] of resolvedMap) {
        if (inputName.toLowerCase().trim() !== canonicalName.toLowerCase().trim()) {
          aliasesToSave[inputName.toLowerCase()] = canonicalName;
        }
      }
      let aliasesSaved = 0;
      if (Object.keys(aliasesToSave).length > 0) {
        const aliasRes = await fetch('/api/aliases?scope=global', {
          method: 'PUT',
          headers: { 'content-type': 'application/json', ...getAdminAuthHeaders() },
          body: JSON.stringify({ upserts: aliasesToSave }),
        });
        if (aliasRes.ok) aliasesSaved = Object.keys(aliasesToSave).length;
      }

      setUploadResult({
        teams: val.resolved.length + val.needsConfirmation.length,
        aliases: aliasesSaved,
      });
      setPhase('done');
      // Refresh the current RSC tree so any league surface visible in this
      // tab reflects the freshly invalidated canonical standings.
      router.refresh();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setUploading(false);
    }
  }

  function handleReset() {
    setPhase('upload');
    setCsvText('');
    setValidation(null);
    setResolutions(new Map());
    setPickerFor(null);
    setValidateError(null);
    setUploadError(null);
    setUploadResult(null);
    setOverwritePending(null);
  }

  const confirmedCount = validation ? validation.resolved.length + resolutions.size : 0;
  const totalCount = validation
    ? validation.resolved.length + validation.needsConfirmation.length
    : 0;
  const allResolved =
    validation !== null && resolutions.size === validation.needsConfirmation.length;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 space-y-4 dark:border-zinc-700 dark:bg-zinc-900">
      <div>
        <h2 className="text-base font-semibold text-gray-900 dark:text-zinc-100">
          Historical / repair roster CSV import
        </h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">
          Platform-admin tooling for historical/backfill imports and roster repair. Format: Team,
          Owner (one row per team). Current-season ownership is normally managed through the draft /
          manual assignment flow — overwriting an existing active-season roster requires an explicit
          repair confirmation.
        </p>
      </div>

      {uploadError && (
        <div className="rounded border border-red-300/40 bg-red-50 p-3 dark:border-red-800/40 dark:bg-red-950/20">
          <p className="text-sm text-red-600 dark:text-red-400">{uploadError}</p>
          <button
            type="button"
            className="mt-2 text-xs underline text-red-600 dark:text-red-400"
            onClick={handleReset}
          >
            Try again
          </button>
        </div>
      )}

      {/* Active-season overwrite confirmation (PLATFORM-083) */}
      {overwritePending && (
        <div className="rounded border border-amber-300/60 bg-amber-50 p-3 dark:border-amber-700/50 dark:bg-amber-950/30">
          <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
            Overwrite the active-season owner roster?
          </p>
          <p className="mt-1 text-xs text-amber-700/80 dark:text-amber-300/80">
            This league already has a roster for the current season. Current-season ownership is
            normally managed through the draft / manual assignment flow — override is for
            platform-admin repair/backfill.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={uploading}
              onClick={() => {
                const pending = overwritePending;
                setOverwritePending(null);
                void completeUpload(pending.val, pending.resolvedMap, true);
              }}
              className="rounded bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {uploading ? 'Importing…' : 'Confirm repair override'}
            </button>
            <button
              type="button"
              disabled={uploading}
              onClick={() => setOverwritePending(null)}
              className="rounded border border-gray-300 bg-gray-50 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-40 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Phase: done                                                       */}
      {/* ---------------------------------------------------------------- */}
      {phase === 'done' && uploadResult && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-green-600 dark:text-green-400">
            Upload complete — {uploadResult.teams} team{uploadResult.teams !== 1 ? 's' : ''}{' '}
            uploaded
            {uploadResult.aliases > 0
              ? `, ${uploadResult.aliases} alias${uploadResult.aliases !== 1 ? 'es' : ''} saved`
              : ''}
            .
          </p>
          <button
            className="rounded border border-gray-300 bg-gray-50 px-3 py-1.5 text-sm text-gray-900 hover:bg-gray-100 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
            onClick={handleReset}
          >
            Upload another CSV
          </button>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Phase: upload                                                     */}
      {/* ---------------------------------------------------------------- */}
      {phase === 'upload' && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 dark:text-zinc-400">League</label>
              <select
                value={slug}
                onChange={(e) => handleLeagueChange(e.target.value)}
                className="rounded border border-gray-300 bg-gray-50 px-3 py-1.5 text-sm text-gray-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
              >
                {leagues.map((l) => (
                  <option key={l.slug} value={l.slug}>
                    {l.displayName}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 dark:text-zinc-400">Year</label>
              <input
                type="number"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="w-24 rounded border border-gray-300 bg-gray-50 px-3 py-1.5 text-sm text-gray-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 dark:text-zinc-400">
                CSV File — columns: Team, Owner
              </label>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileChange}
                className="text-sm text-gray-600 file:mr-3 file:rounded file:border-0 file:bg-gray-100 file:px-3 file:py-1 file:text-xs file:text-gray-800 hover:file:bg-gray-200 dark:text-zinc-300 dark:file:bg-zinc-700 dark:file:text-zinc-200 dark:hover:file:bg-zinc-600"
              />
            </div>
          </div>

          <button
            onClick={() => void handleValidate()}
            disabled={!csvText.trim() || validating || leagues.length === 0}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {validating ? 'Validating…' : 'Validate & Upload'}
          </button>

          {validateError && (
            <p className="text-sm text-red-600 dark:text-red-400">{validateError}</p>
          )}
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Phase: review                                                     */}
      {/* ---------------------------------------------------------------- */}
      {phase === 'review' && validation && (
        <div className="space-y-5">
          <p className="text-sm text-gray-500 dark:text-zinc-400">
            <span className="font-semibold text-gray-900 dark:text-zinc-100">
              {confirmedCount} of {totalCount}
            </span>{' '}
            teams resolved
          </p>

          {/* Confirmed (collapsible) */}
          {validation.resolved.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-gray-50/40 dark:border-zinc-700 dark:bg-zinc-800/40">
              <button
                type="button"
                className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm font-medium text-gray-900 dark:text-zinc-100"
                onClick={() => setConfirmedCollapsed((v) => !v)}
              >
                <span>
                  Confirmed automatically ({validation.resolved.length} team
                  {validation.resolved.length !== 1 ? 's' : ''})
                </span>
                <span aria-hidden="true">{confirmedCollapsed ? '▼' : '▲'}</span>
              </button>
              {!confirmedCollapsed && (
                <ul className="divide-y divide-gray-200 px-4 pb-3 dark:divide-zinc-700">
                  {validation.resolved.map((r) => (
                    <li
                      key={r.inputName}
                      className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5 text-xs"
                    >
                      <span className="w-36 shrink-0 text-gray-500 dark:text-zinc-400">
                        {r.inputName}
                      </span>
                      <span className="font-medium text-gray-900 dark:text-zinc-100">
                        → {r.canonicalName}
                      </span>
                      <span className="text-gray-400 dark:text-zinc-500">
                        {r.method === 'alias' ? 'alias' : 'exact match'}
                      </span>
                      <span className="text-gray-500 dark:text-zinc-400">{r.owner}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Needs confirmation */}
          {validation.needsConfirmation.some((u) => u.suggestion !== null) && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
                Needs confirmation
              </h3>
              <ul className="space-y-2">
                {validation.needsConfirmation
                  .filter((u) => u.suggestion !== null)
                  .map((item) => {
                    const resolved = resolutions.get(item.inputName);
                    const isPickerOpen = pickerFor === item.inputName;
                    return (
                      <li
                        key={item.inputName}
                        className="rounded-lg border border-gray-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900"
                      >
                        <div className="flex flex-wrap items-start gap-3">
                          <div className="min-w-0 flex-1 space-y-0.5">
                            <p className="text-xs text-gray-500 dark:text-zinc-400">
                              CSV name:{' '}
                              <span className="font-medium text-gray-900 dark:text-zinc-100">
                                {item.inputName}
                              </span>{' '}
                              <span className="text-gray-400 dark:text-zinc-500">
                                ({item.owner})
                              </span>
                            </p>
                            {resolved ? (
                              <p className="text-xs font-medium text-green-600 dark:text-green-400">
                                ✓ {resolved}
                              </p>
                            ) : (
                              <p className="text-xs">
                                Suggested:{' '}
                                <span className="font-medium text-gray-900 dark:text-zinc-100">
                                  {item.suggestion!.canonical}
                                </span>{' '}
                                <span
                                  className={`text-xs ${confidenceColor(item.suggestion!.confidence)}`}
                                >
                                  {confidenceLabel(item.suggestion!.confidence)} confidence
                                </span>
                              </p>
                            )}
                          </div>
                          <div className="flex shrink-0 gap-2">
                            {!resolved && (
                              <button
                                type="button"
                                className="rounded border border-green-600 bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-700"
                                onClick={() =>
                                  handleConfirmSuggestion(
                                    item.inputName,
                                    item.suggestion!.canonical
                                  )
                                }
                              >
                                Confirm
                              </button>
                            )}
                            <button
                              type="button"
                              className="rounded border border-gray-300 bg-gray-50 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-100 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                              onClick={() =>
                                setPickerFor((prev) =>
                                  prev === item.inputName ? null : item.inputName
                                )
                              }
                            >
                              {resolved ? 'Change' : 'Override'}
                            </button>
                          </div>
                        </div>
                        {isPickerOpen && (
                          <TeamPicker
                            fbsTeams={validation.fbsTeams}
                            onSelect={(canonical) =>
                              handleConfirmSuggestion(item.inputName, canonical)
                            }
                          />
                        )}
                      </li>
                    );
                  })}
              </ul>
            </div>
          )}

          {/* No match found */}
          {validation.needsConfirmation.some((u) => u.suggestion === null) && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
                No match found
              </h3>
              <ul className="space-y-2">
                {validation.needsConfirmation
                  .filter((u) => u.suggestion === null)
                  .map((item) => {
                    const resolved = resolutions.get(item.inputName);
                    const isPickerOpen = pickerFor === item.inputName;
                    return (
                      <li
                        key={item.inputName}
                        className="rounded-lg border border-orange-300/40 bg-orange-50 p-3 dark:border-orange-700/40 dark:bg-orange-950/20"
                      >
                        <div className="flex flex-wrap items-start gap-3">
                          <div className="min-w-0 flex-1 space-y-0.5">
                            <p className="text-xs text-gray-500 dark:text-zinc-400">
                              CSV name:{' '}
                              <span className="font-medium text-gray-900 dark:text-zinc-100">
                                {item.inputName}
                              </span>{' '}
                              <span className="text-gray-400 dark:text-zinc-500">
                                ({item.owner})
                              </span>
                            </p>
                            {resolved ? (
                              <p className="text-xs font-medium text-green-600 dark:text-green-400">
                                ✓ {resolved}
                              </p>
                            ) : (
                              <p className="text-xs text-orange-600 dark:text-orange-400">
                                Select the correct FBS team below.
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            className="shrink-0 rounded border border-gray-300 bg-gray-50 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-100 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                            onClick={() =>
                              setPickerFor((prev) =>
                                prev === item.inputName ? null : item.inputName
                              )
                            }
                          >
                            {resolved ? 'Change' : 'Select team'}
                          </button>
                        </div>
                        {isPickerOpen && (
                          <TeamPicker
                            fbsTeams={validation.fbsTeams}
                            onSelect={(canonical) =>
                              handleConfirmSuggestion(item.inputName, canonical)
                            }
                          />
                        )}
                      </li>
                    );
                  })}
              </ul>
            </div>
          )}

          {/* Complete Upload */}
          <div className="flex flex-wrap items-center gap-3 border-t border-gray-200 pt-4 dark:border-zinc-700">
            <button
              className="rounded border border-blue-600 bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => void handleCompleteUpload()}
              disabled={!allResolved || uploading}
            >
              {uploading ? 'Uploading…' : 'Complete Upload'}
            </button>
            <button
              className="rounded border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-900 hover:bg-gray-100 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
              onClick={handleReset}
              disabled={uploading}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
