import React from 'react';

type ScoreboardTeamNameProps = {
  abbreviation: string | null;
  marker: string;
  teamName: string;
};

export const SCOREBOARD_TEAM_NAME_FALLBACK_MEASUREMENTS = {
  atLeast22Characters: { minimumNameLength: 22, requiredWidthPx: 402.469 },
  atLeast18Characters: { minimumNameLength: 18, requiredWidthPx: 377.672 },
  atLeast13Characters: { minimumNameLength: 13, requiredWidthPx: 360.141 },
  atLeast11Characters: { minimumNameLength: 11, requiredWidthPx: 341.484 },
  atLeast8Characters: { minimumNameLength: 8, requiredWidthPx: 323.625 },
  anyLength: { minimumNameLength: 1, requiredWidthPx: 305.859 },
} as const;

export const SCOREBOARD_TEAM_NAME_FALLBACK_THRESHOLDS = {
  atLeast22Characters: Math.ceil(
    SCOREBOARD_TEAM_NAME_FALLBACK_MEASUREMENTS.atLeast22Characters.requiredWidthPx
  ),
  atLeast18Characters: Math.ceil(
    SCOREBOARD_TEAM_NAME_FALLBACK_MEASUREMENTS.atLeast18Characters.requiredWidthPx
  ),
  atLeast13Characters: Math.ceil(
    SCOREBOARD_TEAM_NAME_FALLBACK_MEASUREMENTS.atLeast13Characters.requiredWidthPx
  ),
  atLeast11Characters: Math.ceil(
    SCOREBOARD_TEAM_NAME_FALLBACK_MEASUREMENTS.atLeast11Characters.requiredWidthPx
  ),
  atLeast8Characters: Math.ceil(
    SCOREBOARD_TEAM_NAME_FALLBACK_MEASUREMENTS.atLeast8Characters.requiredWidthPx
  ),
  anyLength: Math.ceil(SCOREBOARD_TEAM_NAME_FALLBACK_MEASUREMENTS.anyLength.requiredWidthPx),
} as const;

type ScoreboardTeamNameFallbackKey = keyof typeof SCOREBOARD_TEAM_NAME_FALLBACK_THRESHOLDS;

type ScoreboardTeamNameFallbackRule = {
  abbreviationClassName: string;
  fullNameClassName: string;
  key: ScoreboardTeamNameFallbackKey;
  minimumNameLength: number;
  thresholdPx: number;
};

/*
 * These literal utilities are required for Tailwind discovery. Their numeric portions are pinned
 * to the derived constants by ScoreboardTeamName.test.tsx.
 *
 * A container query cannot measure rendered text, so each label selects a rule from its character
 * count and swaps at that rule's measured container width. This is deliberately conservative: a
 * name may abbreviate before it had to, and at extreme widths even its abbreviation may not fit.
 * The browser assertion named "scoreboard name fallback swaps per label and exposes its precision
 * limits" pins both sides of that caveat against rendered pixels.
 */
const SCOREBOARD_TEAM_NAME_FALLBACK_RULES: readonly ScoreboardTeamNameFallbackRule[] = [
  {
    key: 'atLeast22Characters',
    minimumNameLength:
      SCOREBOARD_TEAM_NAME_FALLBACK_MEASUREMENTS.atLeast22Characters.minimumNameLength,
    thresholdPx: SCOREBOARD_TEAM_NAME_FALLBACK_THRESHOLDS.atLeast22Characters,
    fullNameClassName: '@max-[403px]:hidden',
    abbreviationClassName: 'hidden @max-[403px]:inline',
  },
  {
    key: 'atLeast18Characters',
    minimumNameLength:
      SCOREBOARD_TEAM_NAME_FALLBACK_MEASUREMENTS.atLeast18Characters.minimumNameLength,
    thresholdPx: SCOREBOARD_TEAM_NAME_FALLBACK_THRESHOLDS.atLeast18Characters,
    fullNameClassName: '@max-[378px]:hidden',
    abbreviationClassName: 'hidden @max-[378px]:inline',
  },
  {
    key: 'atLeast13Characters',
    minimumNameLength:
      SCOREBOARD_TEAM_NAME_FALLBACK_MEASUREMENTS.atLeast13Characters.minimumNameLength,
    thresholdPx: SCOREBOARD_TEAM_NAME_FALLBACK_THRESHOLDS.atLeast13Characters,
    fullNameClassName: '@max-[361px]:hidden',
    abbreviationClassName: 'hidden @max-[361px]:inline',
  },
  {
    key: 'atLeast11Characters',
    minimumNameLength:
      SCOREBOARD_TEAM_NAME_FALLBACK_MEASUREMENTS.atLeast11Characters.minimumNameLength,
    thresholdPx: SCOREBOARD_TEAM_NAME_FALLBACK_THRESHOLDS.atLeast11Characters,
    fullNameClassName: '@max-[342px]:hidden',
    abbreviationClassName: 'hidden @max-[342px]:inline',
  },
  {
    key: 'atLeast8Characters',
    minimumNameLength:
      SCOREBOARD_TEAM_NAME_FALLBACK_MEASUREMENTS.atLeast8Characters.minimumNameLength,
    thresholdPx: SCOREBOARD_TEAM_NAME_FALLBACK_THRESHOLDS.atLeast8Characters,
    fullNameClassName: '@max-[324px]:hidden',
    abbreviationClassName: 'hidden @max-[324px]:inline',
  },
  {
    key: 'anyLength',
    minimumNameLength: SCOREBOARD_TEAM_NAME_FALLBACK_MEASUREMENTS.anyLength.minimumNameLength,
    thresholdPx: SCOREBOARD_TEAM_NAME_FALLBACK_THRESHOLDS.anyLength,
    fullNameClassName: '@max-[306px]:hidden',
    abbreviationClassName: 'hidden @max-[306px]:inline',
  },
];

export const SCOREBOARD_TEAM_NAME_FALLBACK_RULE_SPECS = SCOREBOARD_TEAM_NAME_FALLBACK_RULES.map(
  ({ abbreviationClassName, fullNameClassName, key, minimumNameLength, thresholdPx }) => ({
    abbreviationClassName,
    fullNameClassName,
    key,
    minimumNameLength,
    thresholdPx,
  })
);

function fallbackRuleFor(teamName: string): ScoreboardTeamNameFallbackRule {
  const nameLength = teamName.trim().length;
  return (
    SCOREBOARD_TEAM_NAME_FALLBACK_RULES.find(
      ({ minimumNameLength }) => nameLength >= minimumNameLength
    ) ?? SCOREBOARD_TEAM_NAME_FALLBACK_RULES.at(-1)!
  );
}

export default function ScoreboardTeamName({
  abbreviation,
  marker,
  teamName,
}: ScoreboardTeamNameProps): React.ReactElement {
  if (abbreviation === null) {
    return <span data-scoreboard-team={marker}>{teamName}</span>;
  }

  const rule = fallbackRuleFor(teamName);
  return (
    <span
      data-scoreboard-team-label={marker}
      data-scoreboard-team-fallback={rule.key}
      data-scoreboard-team-fallback-max-width={rule.thresholdPx}
    >
      <span className="sr-only" data-scoreboard-team-accessible={marker}>
        {teamName}
      </span>
      <span
        aria-hidden="true"
        className={rule.fullNameClassName}
        data-scoreboard-team-full={marker}
        data-scoreboard-team={marker}
      >
        {teamName}
      </span>
      <span
        aria-hidden="true"
        className={rule.abbreviationClassName}
        data-scoreboard-team-abbreviation={marker}
      >
        {abbreviation}
      </span>
    </span>
  );
}
