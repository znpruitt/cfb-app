import { getAppState, setAppState } from './appStateStore.ts';

export type FeedbackCategory =
  | 'wrong_score'
  | 'missing_game'
  | 'wrong_odds'
  | 'data_mismatch'
  | 'other';

export type FeedbackReport = {
  id: string;
  category: FeedbackCategory;
  note: string;
  submittedAt: string;
  resolved: boolean;
};

type FeedbackStore = Record<string, FeedbackReport>;

const FEEDBACK_SCOPE = 'feedback';
const FEEDBACK_KEY = 'reports';

let memoryStore: FeedbackStore | null = null;
let writeQueue: Promise<void> = Promise.resolve();

async function runMutation<T>(task: () => Promise<T>): Promise<T> {
  const prior = writeQueue;
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  writeQueue = prior.then(() => current);

  await prior;
  try {
    return await task();
  } finally {
    release();
  }
}

async function readStore(): Promise<FeedbackStore> {
  const record = await getAppState<FeedbackStore>(FEEDBACK_SCOPE, FEEDBACK_KEY);
  const store = record?.value;
  return store && typeof store === 'object' && !Array.isArray(store) ? store : {};
}

async function writeStore(store: FeedbackStore): Promise<void> {
  await setAppState(FEEDBACK_SCOPE, FEEDBACK_KEY, store);
}

export async function addFeedbackReport(report: FeedbackReport): Promise<void> {
  await runMutation(async () => {
    const current = await readStore();
    current[report.id] = report;
    memoryStore = current;
    await writeStore(current);
  });
}

export async function getFeedbackReports(): Promise<FeedbackReport[]> {
  if (memoryStore === null) {
    memoryStore = await readStore();
  }
  return Object.values(memoryStore).sort(
    (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
  );
}

export async function resolveFeedbackReport(id: string): Promise<boolean> {
  return await runMutation(async () => {
    const current = await readStore();
    if (!current[id]) return false;
    current[id] = { ...current[id], resolved: true };
    memoryStore = current;
    await writeStore(current);
    return true;
  });
}

export async function deleteFeedbackReport(id: string): Promise<boolean> {
  return await runMutation(async () => {
    const current = await readStore();
    if (!current[id]) return false;
    delete current[id];
    memoryStore = current;
    await writeStore(current);
    return true;
  });
}

export async function getOpenFeedbackCount(): Promise<number> {
  const reports = await getFeedbackReports();
  return reports.filter((r) => !r.resolved).length;
}

export function __resetFeedbackStoreForTests(): void {
  memoryStore = null;
  writeQueue = Promise.resolve();
}
