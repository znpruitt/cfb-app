import { getAppState, setAppState } from './server/appStateStore.ts';

function scope(slug: string): string {
  return `preseason-owners:${slug}`;
}

export async function getPreseasonOwners(slug: string, year: number): Promise<string[] | null> {
  try {
    const record = await getAppState<string[]>(scope(slug), String(year));
    return record?.value ?? null;
  } catch {
    return null;
  }
}

export async function savePreseasonOwners(
  slug: string,
  year: number,
  owners: string[]
): Promise<void> {
  await setAppState<string[]>(scope(slug), String(year), owners);
}
