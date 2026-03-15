import { CONFERENCE_CHAMPIONSHIP_SLOTS } from './conferenceChampionships';
import type { GameStage } from './schedule';

export type TemplateEvent = {
  id: string;
  eventKey: string;
  label: string;
  stage: GameStage;
  week: number;
  date: string | null;
  slotOrder: number;
  conference: string | null;
  bowlName: string | null;
  playoffRound: string | null;
  venue: string | null;
  homeDisplay: string;
  awayDisplay: string;
  homeDerivedFrom?: string;
  awayDerivedFrom?: string;
};

const BOWL_TEMPLATES = [
  { slug: 'rose-bowl', label: 'Rose Bowl', week: 17, slotOrder: 10 },
  { slug: 'sugar-bowl', label: 'Sugar Bowl', week: 17, slotOrder: 11 },
  { slug: 'orange-bowl', label: 'Orange Bowl', week: 17, slotOrder: 12 },
  { slug: 'cotton-bowl', label: 'Cotton Bowl', week: 17, slotOrder: 13 },
] as const;

export function buildPostseasonTemplate(season: number): TemplateEvent[] {
  const out: TemplateEvent[] = [];

  CONFERENCE_CHAMPIONSHIP_SLOTS.forEach((conf, idx) => {
    out.push({
      id: `${season}-${conf.slug}-championship`,
      eventKey: `${conf.slug}-championship`,
      label: `${conf.title} Championship Game`,
      stage: 'conference_championship',
      week: 15,
      date: null,
      slotOrder: idx + 1,
      conference: conf.title,
      bowlName: null,
      playoffRound: null,
      venue: null,
      homeDisplay: `${conf.title} Team TBD`,
      awayDisplay: `${conf.title} Team TBD`,
    });
  });

  BOWL_TEMPLATES.forEach((bowl) => {
    out.push({
      id: `${season}-${bowl.slug}`,
      eventKey: bowl.slug,
      label: bowl.label,
      stage: 'bowl',
      week: bowl.week,
      date: null,
      slotOrder: bowl.slotOrder,
      conference: null,
      bowlName: bowl.label,
      playoffRound: null,
      venue: null,
      homeDisplay: 'Team TBD',
      awayDisplay: 'Team TBD',
    });
  });

  out.push(
    {
      id: `${season}-cfp-quarterfinal-1`,
      eventKey: 'cfp-quarterfinal-1',
      label: 'CFP Quarterfinal 1',
      stage: 'playoff',
      week: 17,
      date: null,
      slotOrder: 21,
      conference: null,
      bowlName: null,
      playoffRound: 'quarterfinal',
      venue: null,
      homeDisplay: 'Team TBD',
      awayDisplay: 'Team TBD',
    },
    {
      id: `${season}-cfp-quarterfinal-2`,
      eventKey: 'cfp-quarterfinal-2',
      label: 'CFP Quarterfinal 2',
      stage: 'playoff',
      week: 17,
      date: null,
      slotOrder: 22,
      conference: null,
      bowlName: null,
      playoffRound: 'quarterfinal',
      venue: null,
      homeDisplay: 'Team TBD',
      awayDisplay: 'Team TBD',
    },
    {
      id: `${season}-cfp-quarterfinal-3`,
      eventKey: 'cfp-quarterfinal-3',
      label: 'CFP Quarterfinal 3',
      stage: 'playoff',
      week: 17,
      date: null,
      slotOrder: 23,
      conference: null,
      bowlName: null,
      playoffRound: 'quarterfinal',
      venue: null,
      homeDisplay: 'Team TBD',
      awayDisplay: 'Team TBD',
    },
    {
      id: `${season}-cfp-quarterfinal-4`,
      eventKey: 'cfp-quarterfinal-4',
      label: 'CFP Quarterfinal 4',
      stage: 'playoff',
      week: 17,
      date: null,
      slotOrder: 24,
      conference: null,
      bowlName: null,
      playoffRound: 'quarterfinal',
      venue: null,
      homeDisplay: 'Team TBD',
      awayDisplay: 'Team TBD',
    },
    {
      id: `${season}-cfp-semifinal-1`,
      eventKey: 'cfp-semifinal-1',
      label: 'CFP Semifinal 1',
      stage: 'playoff',
      week: 18,
      date: null,
      slotOrder: 31,
      conference: null,
      bowlName: null,
      playoffRound: 'semifinal',
      venue: null,
      homeDisplay: 'Winner of CFP Quarterfinal 1',
      awayDisplay: 'Winner of CFP Quarterfinal 2',
      homeDerivedFrom: `${season}-cfp-quarterfinal-1`,
      awayDerivedFrom: `${season}-cfp-quarterfinal-2`,
    },
    {
      id: `${season}-cfp-semifinal-2`,
      eventKey: 'cfp-semifinal-2',
      label: 'CFP Semifinal 2',
      stage: 'playoff',
      week: 18,
      date: null,
      slotOrder: 32,
      conference: null,
      bowlName: null,
      playoffRound: 'semifinal',
      venue: null,
      homeDisplay: 'Winner of CFP Quarterfinal 3',
      awayDisplay: 'Winner of CFP Quarterfinal 4',
      homeDerivedFrom: `${season}-cfp-quarterfinal-3`,
      awayDerivedFrom: `${season}-cfp-quarterfinal-4`,
    },
    {
      id: `${season}-national-championship`,
      eventKey: 'national-championship',
      label: 'National Championship',
      stage: 'playoff',
      week: 19,
      date: null,
      slotOrder: 41,
      conference: null,
      bowlName: null,
      playoffRound: 'national_championship',
      venue: null,
      homeDisplay: 'Winner of CFP Semifinal 1',
      awayDisplay: 'Winner of CFP Semifinal 2',
      homeDerivedFrom: `${season}-cfp-semifinal-1`,
      awayDerivedFrom: `${season}-cfp-semifinal-2`,
    }
  );

  return out;
}
