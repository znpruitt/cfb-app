/**
 * The canonical schedule SEASON-TYPE vocabulary, and nothing else.
 *
 * **WHAT THIS FILE USED TO BE, because its name still says it (PLATFORM-833).**
 * It held the shared schedule empty-response policy —
 * `classifyEmptyScheduleRefresh` and `hasRequiredSeasonTypeFailure` — and its
 * header called itself *the single source of truth for the schedule
 * empty-response policy, shared by the authorized `/api/schedule` route and the
 * season-transition cron so the two can never drift*.
 *
 * **That claim outlived the policy.** PLATFORM-663 made the full-season refresh
 * authority the only committing schedule path, and that authority enforces
 * completeness and the empty-response classification in its own commit
 * transaction. Both functions were left with ZERO production callers while the
 * docstring went on asserting they prevented drift — a false claim a reader would
 * act on, which is worse than dead code. They were deleted here rather than
 * marked deprecated: `AGENTS.md`'s amendment in `91aa30a3` is what records the
 * argument now, and a binding document is a stronger home for it than a comment on
 * an uncalled function.
 *
 * **WHY THE FILE SURVIVES AT ALL.** `ScheduleSeasonType` has live consumers —
 * `api/cron/season-transition/route.ts` and `lifecycleCronExecutionLog.ts` — so
 * deleting the module would break them. The type does not belong in a file named
 * for a fetch policy that no longer exists; relocating it is
 * [#837](https://github.com/znpruitt/cfb-app/issues/837), which is not done here
 * only because both consumers sit outside PLATFORM-833's scope.
 *
 * Asserted by `scheduleSeasonFetch.test.ts`, which pins that this module exports
 * the type and NOT the two removed functions, so neither can return without the
 * test noticing.
 */
export type ScheduleSeasonType = 'regular' | 'postseason';
