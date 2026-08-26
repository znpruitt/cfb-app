# PLATFORM-086F2 Admin Control-Plane Record

> **Status: Archived — historical reference only** (as of 2026-08-26). Not current implementation
> authority. See [`docs/archive/README.md`](../README.md); current admin authority lives in
> [`docs/architecture/admin-control-plane.md`](../../architecture/admin-control-plane.md).

Status: Archived
Last verified: 2026-08-26
Owner: Project documentation
Canonical for: historical decisions and outcomes from the 2026 PLATFORM-086F2 admin-control-plane campaign
Supersedes: historical migration detail formerly embedded in `docs/architecture/admin-control-plane.md`

This file preserves the completed PLATFORM-086F2 migration record. It is not a current route,
permission, or operator-action reference. Current admin authority lives in
[`../../architecture/admin-control-plane.md`](../../architecture/admin-control-plane.md); access
rules live in [`../../architecture/auth-and-privacy.md`](../../architecture/auth-and-privacy.md);
operator procedures live in [`../../deployment-runbook.md`](../../deployment-runbook.md).

## Audit baseline and locked decisions

The F2A audit inspected clean `main` at `7d5741a` on 2026-07-30. It found a flat admin area that
mixed observation, provider mutations, lifecycle controls, registry configuration, and
league-scoped operations. The accepted restructuring preserved these decisions:

1. Existing admin URLs would remain stable while ownership and presentation changed.
2. Every admin surface would remain `platform_admin`-gated. “Commissioner Tools” would stay an
   audience label, not become a Clerk role.
3. Season rollover would use the same strict national-championship eligibility authority as the
   automatic lifecycle path, with no hidden force bypass.
4. Scheduler delivery would be represented by latest-only durable execution receipts, separate
   from provider-refresh status.
5. The draft would remove SP+ and betting win totals as recommendation signals and use a neutral,
   deterministic team order.

## Shipped slices

| Slice | Historical outcome |
| --- | --- |
| F2A | Audited routes, actions, costs, mutations, and ownership; established the target IA. |
| F2B | Hardened lifecycle writes, removed render-time mutation, and made league year lifecycle-managed. |
| F2C | Consolidated provider and recovery actions on Data Maintenance & Recovery with shared cost, target, mutation, owner, and action-class disclosures. |
| F2D | Removed provider-repair mutations from Diagnostics/System Health and relocated them to Data Maintenance, including the explicitly mutating score-attachment recovery. |
| F2E | Added latest-only scheduler execution receipts and their cache-only System Health projection. |
| F2F | Consolidated System Health into one server-built view model so sections do not infer one operational fact from another. |
| F2G | Redesigned System Health, retired the draft-level SP+/win-total assistance, and surfaced `/admin/draft` in the platform navigation. |
| F2H | Converged lifecycle writes on guarded authorities, made the cron the sole season-rollover executor, and retired `/admin/season` plus its manual rollover/archive panels. |
| F2I | Audited labels and destructive actions; made league deletion explicit and regression-covered. |
| F2J | Closed navigation, wording, theme, and documentation gaps and completed the campaign on 2026-08-08. |

## Resulting information architecture

- **Platform Operations:** System Health and Data Maintenance & Recovery.
- **Platform Configuration:** League Management, Team Identity, and Draft Sequencing.
- **Commissioner Tools:** league-scoped setup, owners, roster, settings, insights, and test controls;
  still platform-admin-only.

Season Management was intentionally removed. The daily lifecycle cron is the only rollover
executor; System Health observes its receipt, while per-league history surfaces expose completed
archives.

## Historical implementation notes

- Manual rollover first converged on the strict shared eligibility gate, then was made read-only,
  and finally disappeared with the `/admin/season` surface. Those intermediate contracts must not
  be read as current behavior.
- The old Diagnostics page issued provider refreshes and a mutating score-attachment trace. Those
  operations moved to Data Maintenance; System Health became observation-first except for bounded
  automation pause/enable controls.
- League creation and lifecycle projection were hardened over several F2H slices. Current behavior
  is governed by the lifecycle invariants in `AGENTS.md`, not by the intermediate migration notes.
- `/admin/draft` was made reachable from the admin home. Calendar-year presentation limitations
  discovered during the campaign were recorded for later work rather than hidden by the redesign.

The detailed slice-by-slice prompts remain in [`../../prompt-registry.md`](../../prompt-registry.md),
shipped outcomes remain in [`../../completed-work.md`](../../completed-work.md), and Git preserves
the retired forensic detail.
