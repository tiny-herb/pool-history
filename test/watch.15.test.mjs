import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { postFromHistory } from '../src/watch.mjs';

const live = (tag, provider, prompt, completion) => ({
  tag, provider, prompt, completion, discount: 0,
  context: 1048576, quantization: 'fp8', status: 0, uptime30m: 100, uptime1d: 100,
  uptimePage: null, latency30m: null, throughput30m: null,
});
const full = (takenAt, endpoints) => ({
  takenAt, source: 'openrouter-api', partial: false, note: null, modelCount: 1,
  models: { 'z/rise': { name: 'Rise', listed: { prompt: 1, completion: 2 }, endpoints } },
});

async function folder() {
  const root = await mkdtemp(join(tmpdir(), 'watch-post-dry-'));
  const dir = join(root, 'snapshots');
  await mkdir(dir);
  // N1 raises input and output by 50%.
  await writeFile(join(dir, '2026-11-17T1607Z.json'),
    JSON.stringify(full('2026-11-17T16:07:00Z', [live('n1', 'N1', 1, 2), live('n2', 'N2', 1.2, 2.4)])));
  await writeFile(join(dir, '2026-11-17T1622Z.json'),
    JSON.stringify(full('2026-11-17T16:22:00Z', [live('n1', 'N1', 1.5, 3), live('n2', 'N2', 1.2, 2.4)])));
  return { root, dir, statePath: join(root, 'posted.json') };
}

const offline = async () => {
  throw new TypeError('fetch failed: offline');
};

test('postFromHistory dry run needs no Discord token and logs each body', async () => {
  const { root, dir, statePath } = await folder();
  const lines = [];

  const result = await postFromHistory({
    dir,
    statePath,
    env: {},
    fetch: offline,
    now: () => new Date('2026-11-17T16:23:00Z'),
    sleep: async () => {},
    dryRun: true,
    log: line => lines.push(line),
  });

  assert.deepEqual(result, { posted: 1, summarized: 0 });
  assert.equal(lines.length, 1);
  const body = JSON.parse(lines[0]);
  assert.equal(lines[0], JSON.stringify(body, null, 2));
  assert.equal(body.embeds[0].title, 'Rise');
  assert.deepEqual(body.allowed_mentions, { parse: [] });
  assert.deepEqual(await readdir(root), ['snapshots']);
});

test('postFromHistory without a Discord token and without dry run skips posting', async () => {
  const { root, dir, statePath } = await folder();
  const lines = [];

  const result = await postFromHistory({
    dir,
    statePath,
    env: {},
    fetch: offline,
    now: () => new Date('2026-11-17T16:23:00Z'),
    sleep: async () => {},
    dryRun: false,
    log: line => lines.push(line),
  });

  assert.deepEqual(result, { posted: 0, summarized: 0 });
  assert.deepEqual(lines, ['post skipped: DISCORD_BOT_TOKEN or DISCORD_CHANNEL_ID not set']);
  assert.deepEqual(await readdir(root), ['snapshots']);
});
