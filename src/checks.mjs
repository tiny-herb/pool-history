import { mkdir, appendFile, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export function checkRecord(snapshot) {
  const errors = Object.entries(snapshot?.models ?? {})
    .filter(([, entry]) => entry && typeof entry.error === 'string')
    .map(([id]) => id)
    .sort();

  return {
    at: snapshot.takenAt,
    models: snapshot.modelCount,
    errors
  };
}

export async function appendCheck(path, record) {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(record)}\n`, 'utf8');
}

export async function readChecks(path) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }

  const records = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;

    try {
      const record = JSON.parse(line);
      if (typeof record?.at !== 'string') continue;
      records.push(record);
    } catch {
      // A malformed or truncated line is ignored.
    }
  }

  return records.sort((a, b) => a.at.localeCompare(b.at));
}
