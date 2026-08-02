/**
 * Dependency-free provider-refresh-status interpretation constants.
 *
 * Kept in its own leaf module (no server or client imports) so the SAME value
 * can be shared by the client-rendered admin panel summary and the server-only
 * System Health model without pulling server-only modules (`pg`, etc.) into the
 * client bundle.
 */

/**
 * An `in-progress` attempt older than this is treated as INTERRUPTED — the
 * process likely died mid-refresh and never resolved the record. Fixed in code
 * (not operator-editable). Single source of truth for the threshold.
 */
export const INTERRUPTED_ATTEMPT_AFTER_MS = 10 * 60 * 1000;
