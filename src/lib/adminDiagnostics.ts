import type { DiagEntry } from './diagnostics';
import {
  isActionableScoreAttachmentIssue,
  isIgnoredOutOfScopeProviderRow,
} from './scoreAttachmentDiagnostics';

export function splitIssueDiagnostics(diag: DiagEntry[]): {
  actionableDiag: DiagEntry[];
  ignoredDebugDiag: Array<Extract<DiagEntry, { kind: 'ignored_score_row' }>>;
} {
  return {
    actionableDiag: diag.filter((entry): entry is DiagEntry => {
      if (entry.kind !== 'ignored_score_row') return true;
      return isActionableScoreAttachmentIssue(entry.diagnostic);
    }),
    ignoredDebugDiag: diag.filter(
      (entry): entry is Extract<DiagEntry, { kind: 'ignored_score_row' }> =>
        entry.kind === 'ignored_score_row' &&
        entry.debugOnly &&
        isIgnoredOutOfScopeProviderRow(entry.diagnostic)
    ),
  };
}
