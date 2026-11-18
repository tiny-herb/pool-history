import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('../pool-history.mjs', import.meta.url));

// The child never reaches the network: every fetch fails as if offline.
const offline = ['--import', 'data:text/javascript,globalThis.fetch=async()=>{throw new TypeError("fetch failed: offline")}'];

const live = (tag, provider, prompt, completion) => ({
  tag, provider, prompt, completion, discount: 0,
  context: 1048576, quantization: 'fp8', status: 0, uptime30m: 100, uptime1d: 100,
  uptimePage: null, latency30m: null, throughput30m: null,
});
const full = (takenAt, endpoints) => ({
  takenAt, source: 'openrouter-api', partial: false, note: null, modelCount: 1,
  models: { 'z/rise': { name: 'Rise', listed: { prompt: 1, completion: 2 }, endpoints } },
});

// Two checks 15 minutes apart; N1 raises input and output by 50%.
const snapshots = {
  '2026-11-17T1607Z.json': full('2026-11-17T16:07:00Z', [live('n1', 'N1', 1, 2), live('n2', 'N2', 1.2, 2.4)]),
  '2026-11-17T1622Z.json': full('2026-11-17T16:22:00Z', [live('n1', 'N1', 1.5, 3), live('n2', 'N2', 1.2, 2.4)]),
};

test('post --dry-run prints each body as two-space JSON, then the would-post line', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pool-history-post-dry-'));
  await mkdir(join(root, 'data', 'snapshots'), { recursive: true });
  for (const [name, value] of Object.entries(snapshots)) {
    await writeFile(join(root, 'data', 'snapshots', name), `${JSON.stringify(value)}\n`);
  }

  const env = { ...process.env, OPENROUTER_API_KEY: 'test-key' };
  delete env.DISCORD_BOT_TOKEN;
  delete env.DISCORD_CHANNEL_ID;
  delete env.SITE_URL;
  const result = spawnSync(process.execPath, [...offline, entry, 'post', '--dry-run'], {
    cwd: root,
    env,
    encoding: 'utf8',
    windowsHide: true,
  });

  assert.equal(result.stderr, '');
  assert.equal(result.status, 0);

  // A dry run prints each body as indented JSON (two spaces), then the summary line.
  const lines = result.stdout.split('\n');
  assert.equal(lines.pop(), '');
  assert.equal(lines.pop(), 'post: would post 1, summarized 0 (dry run: nothing sent, posted.json unchanged)');
  const blocks = lines.join('\n').split(/\n(?=\{\n)/).filter(block => block.startsWith('{\n'));
  assert.equal(blocks.length, 1);

  const body = JSON.parse(blocks[0]);
  assert.equal(blocks[0], JSON.stringify(body, null, 2));
  assert.deepEqual(body.allowed_mentions, { parse: [] });
  assert.equal(body.embeds[0].color, 13172480);
  assert.ok(body.embeds[0].author.name.length > 0);
  assert.ok(body.components.some(row => row.components.some(button =>
    button.type === 2 && button.label === 'Test request')));
  assert.match(JSON.stringify(body), /Rise/);

  assert.doesNotMatch(result.stdout, /test-key/);
  assert.deepEqual(await readdir(join(root, 'data')), ['snapshots']);
});

// Without DISCORD_BOT_TOKEN or DISCORD_CHANNEL_ID, `post` fails (a runtime error is
// `<command> failed: <message>`, exit 2); only `watch` skips posting.
test('post without a Discord token or channel and without --dry-run fails with exit 2 and writes nothing', async () => {
  for (const discord of [{}, { DISCORD_BOT_TOKEN: 'tok.en' }, { DISCORD_CHANNEL_ID: '123' }]) {
    const root = await mkdtemp(join(tmpdir(), 'pool-history-post-notoken-'));
    await mkdir(join(root, 'data', 'snapshots'), { recursive: true });
    for (const [name, value] of Object.entries(snapshots)) {
      await writeFile(join(root, 'data', 'snapshots', name), `${JSON.stringify(value)}\n`);
    }

    const env = { ...process.env, OPENROUTER_API_KEY: 'test-key', ...discord };
    if (!discord.DISCORD_BOT_TOKEN) delete env.DISCORD_BOT_TOKEN;
    if (!discord.DISCORD_CHANNEL_ID) delete env.DISCORD_CHANNEL_ID;
    const result = spawnSync(process.execPath, [...offline, entry, 'post'], {
      cwd: root,
      env,
      encoding: 'utf8',
      windowsHide: true,
    });

    assert.equal(result.stderr, 'post failed: DISCORD_BOT_TOKEN or DISCORD_CHANNEL_ID not set\n');
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.deepEqual(await readdir(join(root, 'data')), ['snapshots']);
  }
});
