import type { AliasStaging, DiagEntry } from './diagnostics';
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

export function hasStagedAliasChanges(aliasStaging: AliasStaging): boolean {
  return Object.keys(aliasStaging.upserts).length > 0 || aliasStaging.deletes.length > 0;
}

export function getAdminAlertCount(params: {
  issues: string[];
  diag: DiagEntry[];
  aliasStaging: AliasStaging;
}): number {
  const { actionableDiag } = splitIssueDiagnostics(params.diag);
  return (
    params.issues.length +
    actionableDiag.length +
    params.aliasStaging.deletes.length +
    Object.keys(params.aliasStaging.upserts).length
  );
}
