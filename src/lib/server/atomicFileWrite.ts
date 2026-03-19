import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export async function writeJsonFileAtomic(filePath: string, value: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  const tempPath = path.join(dir, `.tmp-${path.basename(filePath)}-${process.pid}-${randomUUID()}`);
  const json = `${JSON.stringify(value, null, 2)}
`;

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(tempPath, json, 'utf8');
  await fs.rename(tempPath, filePath);
}
