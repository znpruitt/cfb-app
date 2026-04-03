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
        // Alias staging requires the full alias editor on the Data Management page.
        // eslint-disable-next-line no-alert
        alert('To stage alias repairs, use the Data Management page (/admin/data).');
      }}
    />
  );
}
