type ConferenceTrackedGame = {
  awayConf: string;
  homeConf: string;
  canAway: string;
  canHome: string;
};

export function deriveConferenceOptionsFromTrackedGames(params: {
  games: ConferenceTrackedGame[];
  isFbsTeamName: (name: string) => boolean;
}): string[] {
  const { games, isFbsTeamName } = params;
  const conferenceSet = new Set<string>();

  for (const game of games) {
    const awayConf = game.awayConf?.trim();
    const homeConf = game.homeConf?.trim();
    if (isFbsTeamName(game.canAway) && awayConf) conferenceSet.add(awayConf);
    if (isFbsTeamName(game.canHome) && homeConf) conferenceSet.add(homeConf);
  }

  return ['ALL', ...Array.from(conferenceSet).sort((a, b) => a.localeCompare(b))];
}
