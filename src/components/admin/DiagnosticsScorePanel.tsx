'use client';

import ScoreAttachmentDebugPanel from '../ScoreAttachmentDebugPanel';

type Props = {
  season: number;
};

export default function DiagnosticsScorePanel({ season }: Props) {
  return (
    <ScoreAttachmentDebugPanel
      season={season}
      onStageAlias={() => {
        // Alias staging requires the full alias editor on the Aliases page.
        alert('To stage alias repairs, use the Aliases page (/admin/aliases).');
      }}
    />
  );
}
