'use client';

import React, { useEffect, useState } from 'react';
import { requireAdminAuthHeaders } from '@/lib/adminAuth';
import type { League } from '@/lib/league';
import type {
  RosterValidationResult,
  ResolvedEntry,
  UnresolvedEntry,
} from '@/lib/rosterUploadValidator';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  if (confidence >= 0.9) return 'text-green-700 dark:text-green-400';
  if (confidence >= 0.75) return 'text-amber-700 dark:text-amber-400';
  return 'text-orange-700 dark:text-orange-400';
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
    <div className="mt-1 space-y-1">
      <input
        type="text"
        placeholder="Search FBS teams…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
        autoFocus
      />
      <select
        size={6}
        className="w-full rounded border border-gray-300 bg-white px-1 py-0.5 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
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

export default function RosterUploadPanel(): React.ReactElement {
  const [phase, setPhase] = useState<Phase>('upload');

  // Upload phase
  const [leagues, setLeagues] = useState<League[]>([]);
  const [selectedLeague, setSelectedLeague] = useState('');
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [csvText, setCsvText] = useState('');
  const [validating, setValidating] = useState(false);
  const [validateError, setValidateError] = useState<string | null>(null);

  // Review phase
  const [validation, setValidation] = useState<ValidationResponse | null>(null);
  const [resolutions, setResolutions] = useState<Map<string, string>>(new Map());
  const [pickerFor, setPickerFor] = useState<string | null>(null); // inputName with picker open
  const [confirmedCollapsed, setConfirmedCollapsed] = useState(true);

  // Upload phase
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<{ teams: number; aliases: number } | null>(null);

  useEffect(() => {
    void loadLeagues();
  }, []);

  async function loadLeagues() {
    try {
      const res = await fetch('/api/admin/leagues', { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as { leagues: League[] };
      setLeagues(data.leagues ?? []);
      if ((data.leagues ?? []).length > 0) {
        const first = data.leagues[0]!;
        setSelectedLeague(first.slug);
        setSelectedYear(first.year);
      }
    } catch {
      // non-critical
    }
  }

  function handleLeagueChange(slug: string) {
    setSelectedLeague(slug);
    const league = leagues.find((l) => l.slug === slug);
    if (league) setSelectedYear(league.year);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setCsvText((ev.target?.result as string) ?? '');
    };
    reader.readAsText(file);
  }

  async function handleValidate() {
    setValidateError(null);
    setValidating(true);
    setResolutions(new Map());
    setPickerFor(null);
    try {
      const authHeaders = requireAdminAuthHeaders() as Record<string, string>;
      const leagueParam = selectedLeague ? `&league=${encodeURIComponent(selectedLeague)}` : '';
      const res = await fetch(`/api/owners/validate?year=${selectedYear}${leagueParam}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders },
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
        // All teams resolved — skip review, go straight to upload confirmation
        await completeUpload(data, new Map());
      } else {
        setPhase('review');
      }
    } catch (err) {
      setValidateError((err as Error).message);
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

  function handleOpenPicker(inputName: string) {
    setPickerFor((prev) => (prev === inputName ? null : inputName));
  }

  async function handleCompleteUpload() {
    if (!validation) return;
    await completeUpload(validation, resolutions);
  }

  async function completeUpload(val: ValidationResponse, resolvedMap: Map<string, string>) {
    setUploadError(null);
    setUploading(true);
    try {
      const authHeaders = requireAdminAuthHeaders() as Record<string, string>;
      const leagueParam = selectedLeague ? `&league=${encodeURIComponent(selectedLeague)}` : '';

      // Build CSV with all canonical names
      const resolvedCsv = buildResolvedCsv(val.resolved, val.needsConfirmation, resolvedMap);

      // PUT resolved CSV to owners
      const ownersRes = await fetch(`/api/owners?year=${selectedYear}${leagueParam}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', ...authHeaders },
        body: JSON.stringify({ csvText: resolvedCsv }),
      });
      if (!ownersRes.ok) {
        const text = await ownersRes.text();
        setUploadError(text || `Upload failed (${ownersRes.status})`);
        return;
      }

      // Save confirmed fuzzy matches and manual selections as global aliases
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
          headers: { 'content-type': 'application/json', ...authHeaders },
          body: JSON.stringify({ upserts: aliasesToSave }),
        });
        if (aliasRes.ok) {
          aliasesSaved = Object.keys(aliasesToSave).length;
        }
      }

      const teamCount = val.resolved.length + val.needsConfirmation.length;
      setUploadResult({ teams: teamCount, aliases: aliasesSaved });
      setPhase('done');
    } catch (err) {
      setUploadError((err as Error).message);
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
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const confirmedCount = validation ? validation.resolved.length + resolutions.size : 0;
  const totalCount = validation
    ? validation.resolved.length + validation.needsConfirmation.length
    : 0;
  const allResolved =
    validation !== null && resolutions.size === validation.needsConfirmation.length;

  return (
    <div className="mb-4 rounded-2xl border border-gray-300 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-zinc-400">
        Roster Upload
      </p>
      <h2 className="mb-4 text-lg font-semibold text-gray-950 dark:text-zinc-50">
        Owner Roster CSV Upload
      </h2>

      {/* ---------------------------------------------------------------- */}
      {/* Persistent upload error — shown regardless of phase              */}
      {/* Covers the auto-upload path (isComplete: true, no review phase)  */}
      {/* as well as failures during the review phase Complete Upload step. */}
      {/* ---------------------------------------------------------------- */}
      {uploadError && (
        <div className="mb-4 rounded border border-red-200 bg-red-50/80 p-3 dark:border-red-800/40 dark:bg-red-950/20">
          <p className="text-sm text-red-700 dark:text-red-400">{uploadError}</p>
          <button
            type="button"
            className="mt-2 text-xs underline text-red-700 hover:no-underline dark:text-red-400"
            onClick={handleReset}
          >
            Try again
          </button>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Phase: done                                                       */}
      {/* ---------------------------------------------------------------- */}
      {phase === 'done' && uploadResult && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-green-700 dark:text-green-400">
            Upload complete — {uploadResult.teams} team{uploadResult.teams !== 1 ? 's' : ''}{' '}
            uploaded
            {uploadResult.aliases > 0
              ? `, ${uploadResult.aliases} alias${uploadResult.aliases !== 1 ? 'es' : ''} saved`
              : ''}
            .
          </p>
          <button
            className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 hover:bg-gray-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700/60"
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
          {/* League + year selectors */}
          <div className="flex flex-wrap items-end gap-4">
            {leagues.length > 0 && (
              <div className="space-y-1">
                <label className="block text-xs font-medium text-gray-700 dark:text-zinc-300">
                  League
                </label>
                <select
                  value={selectedLeague}
                  onChange={(e) => handleLeagueChange(e.target.value)}
                  className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                >
                  {leagues.map((l) => (
                    <option key={l.slug} value={l.slug}>
                      {l.displayName}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-700 dark:text-zinc-300">
                Year
              </label>
              <input
                type="number"
                value={selectedYear}
                min={2000}
                max={2100}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                className="w-24 rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
              />
            </div>
          </div>

          {/* File picker */}
          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-700 dark:text-zinc-300">
              CSV file — columns: <code>Team, Owner</code>
            </label>
            <input
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="text-sm file:mr-2 file:rounded file:border file:px-2 file:py-1 file:bg-white file:border-gray-300 dark:file:bg-zinc-800 dark:file:border-zinc-700"
            />
          </div>

          <button
            className="rounded border border-blue-600 bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            onClick={() => void handleValidate()}
            disabled={!csvText.trim() || validating}
          >
            {validating ? 'Validating…' : 'Validate Upload'}
          </button>

          {validateError && (
            <p className="text-sm text-red-700 dark:text-red-400">{validateError}</p>
          )}
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Phase: review                                                     */}
      {/* ---------------------------------------------------------------- */}
      {phase === 'review' && validation && (
        <div className="space-y-5">
          {/* Progress indicator */}
          <p className="text-sm text-gray-600 dark:text-zinc-400">
            <span className="font-semibold text-gray-900 dark:text-zinc-100">
              {confirmedCount} of {totalCount}
            </span>{' '}
            teams resolved
          </p>

          {/* ---- Confirmed section (collapsible) ---- */}
          {validation.resolved.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-gray-50/60 dark:border-zinc-700 dark:bg-zinc-800/40">
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
                <ul className="divide-y divide-gray-100 px-4 pb-3 dark:divide-zinc-700">
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

          {/* ---- Needs confirmation section ---- */}
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
                              <p className="text-xs">
                                <span className="font-medium text-green-700 dark:text-green-400">
                                  ✓ {resolved}
                                </span>
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
                              className="rounded border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                              onClick={() => handleOpenPicker(item.inputName)}
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

          {/* ---- No match found section ---- */}
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
                        className="rounded-lg border border-orange-200 bg-orange-50/60 p-3 dark:border-orange-700/40 dark:bg-orange-950/20"
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
                              <p className="text-xs font-medium text-green-700 dark:text-green-400">
                                ✓ {resolved}
                              </p>
                            ) : (
                              <p className="text-xs text-orange-700 dark:text-orange-400">
                                Select the correct FBS team below.
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            className="shrink-0 rounded border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                            onClick={() => handleOpenPicker(item.inputName)}
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

          {/* ---- Complete Upload ---- */}
          <div className="flex flex-wrap items-center gap-3 border-t border-gray-200 pt-4 dark:border-zinc-700">
            <button
              className="rounded border border-blue-600 bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => void handleCompleteUpload()}
              disabled={!allResolved || uploading}
            >
              {uploading ? 'Uploading…' : 'Complete Upload'}
            </button>
            <button
              className="rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 hover:bg-gray-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
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
