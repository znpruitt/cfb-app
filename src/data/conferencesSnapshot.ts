import type { CfbdConferenceRecord } from '@/lib/conferenceSubdivision';

// Checked-in fallback snapshot used when CFBD conferences cannot be fetched and runtime cache is cold.
export const CONFERENCES_SNAPSHOT: CfbdConferenceRecord[] = [
  { name: 'ACC', shortName: 'ACC', abbreviation: 'ACC', classification: 'fbs' },
  { name: 'Big Ten', shortName: 'Big Ten', abbreviation: 'B1G', classification: 'fbs' },
  { name: 'Big 12', shortName: 'Big 12', abbreviation: 'Big 12', classification: 'fbs' },
  { name: 'SEC', shortName: 'SEC', abbreviation: 'SEC', classification: 'fbs' },
  { name: 'Pac-12', shortName: 'Pac-12', abbreviation: 'Pac-12', classification: 'fbs' },
  {
    name: 'American Athletic Conference',
    shortName: 'American Athletic',
    abbreviation: 'AAC',
    classification: 'fbs',
  },
  {
    name: 'Mid-American Conference',
    shortName: 'Mid-American',
    abbreviation: 'MAC',
    classification: 'fbs',
  },
  {
    name: 'Mountain West Conference',
    shortName: 'Mountain West',
    abbreviation: 'MWC',
    classification: 'fbs',
  },
  {
    name: 'Conference USA',
    shortName: 'Conference USA',
    abbreviation: 'C-USA',
    classification: 'fbs',
  },
  {
    name: 'Sun Belt Conference',
    shortName: 'Sun Belt',
    abbreviation: 'Sun Belt',
    classification: 'fbs',
  },
  {
    name: 'FBS Independents',
    shortName: 'Independent',
    abbreviation: 'IND',
    classification: 'fbs',
  },
  {
    name: 'Patriot League',
    shortName: 'Patriot',
    abbreviation: 'PAT',
    classification: 'fcs',
  },
  {
    name: 'Great American Conference',
    shortName: 'Great American',
    abbreviation: 'GAC',
    classification: 'ii',
  },
];
