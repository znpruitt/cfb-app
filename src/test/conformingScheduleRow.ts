import type { ScheduleWireItem } from '../lib/schedule.ts';

/**
 * A durable schedule row that CONFORMS to `ScheduleWireItem`, for tests that seed the store
 * (PLATFORM-813 v4).
 *
 * The canonical reader now rejects a row that does not match the declared type
 * (`assertConformingScheduleRows`), so a fixture seeding `{ week, homeTeam }` is seeding a row
 * the type says cannot exist. This supplies every REQUIRED field; the test states only what it
 * is about.
 *
 * **EACH DEFAULT IS THE VALUE THAT BEHAVES AS THE FIELD'S ABSENCE DID**, so completing an
 * incomplete fixture is a no-op for the test's behaviour rather than new data it never
 * asked for: `startDate: null` (the type's own "no kickoff"), `''` for the strings (every
 * consumer already reads absence through `?? ''` or a falsy check), and `false` for the
 * booleans (read through truthiness). A test that needs a real value passes it.
 *
 * Deliberately NOT a place to build malformed rows. A test about non-conformance writes the
 * bad value itself, next to its assertion, where a reader can see it.
 */
export function conformingScheduleRow(overrides: Partial<ScheduleWireItem> = {}): ScheduleWireItem {
  return {
    id: '',
    week: 1,
    startDate: null,
    neutralSite: false,
    conferenceGame: false,
    homeTeam: '',
    awayTeam: '',
    homeConference: '',
    awayConference: '',
    status: '',
    ...overrides,
  };
}
