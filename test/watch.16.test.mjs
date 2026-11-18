// `watch --history-from <remote>/<branch>`: the rounds copy the scheduled job's branch into data/ and
// post from it. A bare repository in a temp folder stands in for GitHub; nothing touches the network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  SYNC_MINUTE,
  nextRun,
  parseHistoryFrom,
  runGit,
  syncLine,
  syncOnce,
} from '../src/watch.mjs';

const IDENTITY = {
  GIT_AUTHOR_NAME: 'Tiny Herb',
  GIT_AUTHOR_EMAIL: 'pool-history@invalid',
  GIT_COMMITTER_NAME: 'Tiny Herb',
  GIT_COMMITTER_EMAIL: 'pool-history@invalid',
};

function git(args, cwd, env = {}) {
  return execFileSync('git', ['-c', 'core.autocrlf=false', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...IDENTITY, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

const live = (tag, provider, prompt, completion) => ({
  tag, provider, prompt, completion, discount: 0,
  context: 1048576, quantization: 'fp8', status: 0, uptime30m: 100, uptime1d: 100,
  uptimePage: null, latency30m: null, throughput30m: null,
});
const full = (takenAt, endpoints) => ({
  takenAt, source: 'openrouter-api', partial: false, note: null, modelCount: 1,
  models: { 'z/rise': { name: 'Rise', listed: { prompt: 1, completion: 2 }, endpoints } },
});
const fileName = takenAt => `${takenAt.slice(0, 13)}${takenAt.slice(14, 16)}Z.json`;
const check = takenAt => `${JSON.stringify({ at: takenAt, models: 1, errors: [] })}\n`;

// N1 raises input and output by 50% between the two checks; the second holds a card-worthy item.
const before = [live('n1', 'N1', 1, 2), live('n2', 'N2', 1.2, 2.4)];
const raised = [live('n1', 'N1', 1.5, 3), live('n2', 'N2', 1.2, 2.4)];
const raisedAgain = [live('n1', 'N1', 1.5, 3), live('n2', 'N2', 1.8, 3.6)];

function history(...checks) {
  const files = {};
  let log = '';
  for (const [takenAt, endpoints] of checks) {
    files[`snapshots/${fileName(takenAt)}`] = `${JSON.stringify(full(takenAt, endpoints), null, 2)}\n`;
    log += check(takenAt);
  }
  files['checks.jsonl'] = log;
  return files;
}

// Writes `files` as the next commit of `data` in the bare repository, the way scripts/publish.mjs
// lays the branch out, without any push.
async function publish(bare, files) {
  const scratch = await mkdtemp(join(tmpdir(), 'watch-sync-tree-'));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(scratch, path, '..'), { recursive: true });
    await writeFile(join(scratch, path), text);
  }
  const index = { GIT_INDEX_FILE: join(scratch, '..', `${scratch.split(/[\\/]/).at(-1)}.index`) };
  git([`--git-dir=${bare}`, `--work-tree=${scratch}`, 'add', '-A', '.'], scratch, index);
  const tree = git([`--git-dir=${bare}`, 'write-tree'], scratch, index);
  let parent = [];
  try {
    parent = ['-p', git([`--git-dir=${bare}`, 'rev-parse', '--verify', 'refs/heads/data'], scratch)];
  } catch {}
  const commit = git([`--git-dir=${bare}`, 'commit-tree', tree, ...parent, '-m', 'Check'], scratch);
  git([`--git-dir=${bare}`, 'update-ref', 'refs/heads/data', commit], scratch);
  await rm(scratch, { recursive: true, force: true });
  await rm(index.GIT_INDEX_FILE, { force: true });
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'watch-sync-'));
  const bare = join(root, 'remote.git');
  const work = join(root, 'work');
  git(['init', '--quiet', '--bare', bare], root);
  await mkdir(work);
  git(['init', '--quiet', work], root);
  git(['remote', 'add', 'origin', bare], work);
  const data = join(work, 'data');
  await mkdir(join(data, 'snapshots'), { recursive: true });
  return { root, bare, work, data };
}

async function writeLocal(data, files) {
  await rm(join(data, 'snapshots'), { recursive: true, force: true });
  await mkdir(join(data, 'snapshots'), { recursive: true });
  for (const [path, text] of Object.entries(files)) await writeFile(join(data, path), text);
}

async function tree(dir) {
  const out = {};
  for (const name of (await readdir(dir)).sort()) out[name] = await readFile(join(dir, name), 'utf8');
  return out;
}

const DISCORD = { DISCORD_BOT_TOKEN: 'bot-token', DISCORD_CHANNEL_ID: 'chan' };

function network() {
  const requests = [];
  const fetch = async (url, init = {}) => {
    requests.push(`${init.method || 'GET'} ${url}`);
    if (String(url).startsWith('https://discord.com/')) {
      return new Response(JSON.stringify({ id: '1' }), { status: 200 });
    }
    throw new TypeError(`unexpected request ${url}`);
  };
  return { requests, fetch };
}

function spyGit() {
  const calls = [];
  return {
    calls,
    git: (args, options) => {
      calls.push(args);
      return runGit(args, options);
    },
  };
}

function round({ work, git, fetch, at, env = DISCORD, dryRun = false, lines = [] }) {
  return syncOnce({
    dataDir: 'data',
    from: 'origin/data',
    env,
    cwd: work,
    git,
    fetch,
    now: () => new Date(at),
    sleep: async () => {},
    dryRun,
    log: line => lines.push(line),
  });
}

const handedOver = { from: 'origin/data', since: '2026-11-17T15:00:00.000Z' };

test('a synced round replaces the local snapshots with the branch\'s and posts from them, with no check and no push', async () => {
  const { bare, work, data } = await setup();
  const branch = history(['2026-11-17T16:09:41Z', before], ['2026-11-17T16:24:13Z', raised]);
  await publish(bare, branch);
  // The bot's own stale copy, already switched over earlier.
  await writeLocal(data, {
    'snapshots/2026-11-17T1500Z.json': JSON.stringify(full('2026-11-17T15:00:00Z', before)),
    'checks.jsonl': check('2026-11-17T15:00:00Z'),
    'posted.json': JSON.stringify({ since: '2026-11-17T15:00:00Z', posted: [] }),
    'history-from.json': JSON.stringify(handedOver),
  });
  const refsBefore = git(['for-each-ref', '--format=%(refname) %(objectname)'], bare);
  const { requests, fetch } = network();
  const spy = spyGit();

  const result = await round({ work, git: spy.git, fetch, at: '2026-11-17T16:27:00Z' });

  assert.deepEqual(await tree(join(data, 'snapshots')), {
    '2026-11-17T1609Z.json': branch['snapshots/2026-11-17T1609Z.json'],
    '2026-11-17T1624Z.json': branch['snapshots/2026-11-17T1624Z.json'],
  });
  assert.equal(await readFile(join(data, 'checks.jsonl'), 'utf8'), branch['checks.jsonl']);
  assert.deepEqual(result, {
    from: 'origin/data', snapshots: 2, newest: '2026-11-17T16:24Z', error: null, handled: null,
    posted: 1, summarized: 0,
  });
  assert.equal(syncLine('2026-11-17T16:27Z', result),
    '2026-11-17T16:27Z sync: 2 snapshots, newest 2026-11-17T16:24Z; posted 1, summarized 0');
  assert.deepEqual(requests, ['POST https://discord.com/api/v10/channels/chan/messages']);
  assert.deepEqual(JSON.parse(await readFile(join(data, 'posted.json'), 'utf8')).posted,
    ['z/rise-2026-11-17T16:24:13Z']);

  // Nothing pushed: the only git commands are init, get-url, fetch and read-tree; the remote is as it was.
  assert.deepEqual(spy.calls.map(args => args.find(arg => !arg.startsWith('-'))),
    ['init', 'remote', 'fetch', 'read-tree']);
  assert.ok(spy.calls.every(args => !args.includes('push')));
  assert.equal(git(['for-each-ref', '--format=%(refname) %(objectname)'], bare), refsBefore);
  // Only the bot's own files are left in data/: no temp folder, no index.
  assert.deepEqual((await readdir(data)).sort(),
    ['checks.jsonl', 'history-from.json', 'history.git', 'posted.json', 'snapshots']);
  // The checkout it runs from gained no ref.
  assert.equal(git(['for-each-ref', '--format=%(refname)'], work), '');
});

test('a later round fetches only what is new and posts it', async () => {
  const { bare, work, data } = await setup();
  await publish(bare, history(['2026-11-17T16:09:41Z', before], ['2026-11-17T16:24:13Z', raised]));
  await writeLocal(data, {
    'posted.json': JSON.stringify({ since: '2026-11-17T15:00:00Z', posted: [] }),
    'history-from.json': JSON.stringify(handedOver),
  });
  const { requests, fetch } = network();
  await round({ work, fetch, at: '2026-11-17T16:27:00Z' });
  await publish(bare, history(
    ['2026-11-17T16:09:41Z', before], ['2026-11-17T16:24:13Z', raised], ['2026-11-17T16:39:05Z', raisedAgain],
  ));

  const result = await round({ work, fetch, at: '2026-11-17T16:42:00Z' });

  assert.equal(syncLine('2026-11-17T16:42Z', result),
    '2026-11-17T16:42Z sync: 3 snapshots, newest 2026-11-17T16:39Z; posted 1, summarized 0');
  assert.equal(requests.length, 2);
  assert.deepEqual(JSON.parse(await readFile(join(data, 'posted.json'), 'utf8')).posted,
    ['z/rise-2026-11-17T16:24:13Z', 'z/rise-2026-11-17T16:39:05Z']);
});

test('a failed fetch keeps the previous copy, logs it and still posts from it', async () => {
  const { root, bare, work, data } = await setup();
  const branch = history(['2026-11-17T16:09:41Z', before], ['2026-11-17T16:24:13Z', raised]);
  await publish(bare, branch);
  await writeLocal(data, {
    'posted.json': JSON.stringify({ since: '2026-11-17T15:00:00Z', posted: [] }),
    'history-from.json': JSON.stringify(handedOver),
  });
  // First round without Discord settings: the copy arrives, nothing is posted.
  const lines = [];
  const first = await round({ work, fetch: network().fetch, at: '2026-11-17T16:27:00Z', env: {}, lines });
  assert.deepEqual(lines, ['post skipped: DISCORD_BOT_TOKEN or DISCORD_CHANNEL_ID not set']);
  assert.equal(first.posted, 0);
  const copy = await tree(join(data, 'snapshots'));
  const checks = await readFile(join(data, 'checks.jsonl'), 'utf8');

  // The remote goes away; the next round cannot fetch.
  await rename(bare, join(root, 'gone.git'));
  const { requests, fetch } = network();
  const result = await round({ work, fetch, at: '2026-11-17T16:42:00Z' });

  assert.equal(result.error.length > 0, true);
  assert.match(syncLine('2026-11-17T16:42Z', result),
    /^2026-11-17T16:42Z sync failed: .+; kept the previous copy, 2 snapshots, newest 2026-11-17T16:24Z; posted 1, summarized 0$/);
  assert.deepEqual(await tree(join(data, 'snapshots')), copy);
  assert.equal(await readFile(join(data, 'checks.jsonl'), 'utf8'), checks);
  assert.deepEqual(requests, ['POST https://discord.com/api/v10/channels/chan/messages']);
  assert.ok((await readdir(data)).every(name => !name.startsWith('.sync-')));
});

test('a branch without snapshots/ leaves the previous copy in place', async () => {
  const { bare, work, data } = await setup();
  await publish(bare, { 'checks.jsonl': check('2026-11-17T16:24:13Z') });
  await writeLocal(data, {
    'snapshots/2026-11-17T1500Z.json': JSON.stringify(full('2026-11-17T15:00:00Z', before)),
    'checks.jsonl': check('2026-11-17T15:00:00Z'),
    'history-from.json': JSON.stringify(handedOver),
  });

  const result = await round({ work, fetch: network().fetch, at: '2026-11-17T16:27:00Z', env: {} });

  assert.equal(result.error, 'origin/data has no snapshots/ folder');
  assert.deepEqual(Object.keys(await tree(join(data, 'snapshots'))), ['2026-11-17T1500Z.json']);
  assert.equal(await readFile(join(data, 'checks.jsonl'), 'utf8'), check('2026-11-17T15:00:00Z'));
});

test('the first synced round after a local history posts nothing twice', async () => {
  const { bare, work, data } = await setup();
  // The bot's own history saw the price rise at 16:22:00 and posted it.
  await writeLocal(data, {
    'snapshots/2026-11-17T1607Z.json': JSON.stringify(full('2026-11-17T16:07:00Z', before)),
    'snapshots/2026-11-17T1622Z.json': JSON.stringify(full('2026-11-17T16:22:00Z', raised)),
    'checks.jsonl': check('2026-11-17T16:07:00Z') + check('2026-11-17T16:22:00Z'),
    'posted.json': JSON.stringify({ since: '2026-11-17T10:00:00Z', posted: ['z/rise-2026-11-17T16:22:00Z'] }),
  });
  // The job's history saw the same rise at its own check time, so under another id.
  await publish(bare, history(['2026-11-17T16:09:41Z', before], ['2026-11-17T16:24:13Z', raised]));
  const { requests, fetch } = network();

  const first = await round({ work, fetch, at: '2026-11-17T16:27:00Z' });

  assert.equal(syncLine('2026-11-17T16:27Z', first),
    '2026-11-17T16:27Z sync: 2 snapshots, newest 2026-11-17T16:24Z; ' +
    'switched to origin/data, 1 item marked as already posted; posted 0, summarized 0');
  assert.deepEqual(requests, []);
  assert.deepEqual(JSON.parse(await readFile(join(data, 'posted.json'), 'utf8')), {
    since: '2026-11-17T10:00:00Z',
    posted: ['z/rise-2026-11-17T16:22:00Z', 'z/rise-2026-11-17T16:24:13Z'],
  });
  assert.deepEqual(JSON.parse(await readFile(join(data, 'history-from.json'), 'utf8')),
    { from: 'origin/data', since: '2026-11-17T16:27:00.000Z' });

  // The next round posts only what is new since the switch.
  await publish(bare, history(
    ['2026-11-17T16:09:41Z', before], ['2026-11-17T16:24:13Z', raised], ['2026-11-17T16:39:05Z', raisedAgain],
  ));
  const second = await round({ work, fetch, at: '2026-11-17T16:42:00Z' });

  assert.equal(syncLine('2026-11-17T16:42Z', second),
    '2026-11-17T16:42Z sync: 3 snapshots, newest 2026-11-17T16:39Z; posted 1, summarized 0');
  assert.equal(requests.length, 1);
  assert.deepEqual(JSON.parse(await readFile(join(data, 'posted.json'), 'utf8')).posted, [
    'z/rise-2026-11-17T16:22:00Z', 'z/rise-2026-11-17T16:24:13Z', 'z/rise-2026-11-17T16:39:05Z',
  ]);
});

test('a dry run of the first synced round marks nothing and does not record the switch', async () => {
  const { bare, work, data } = await setup();
  const posted = JSON.stringify({ since: '2026-11-17T10:00:00Z', posted: ['z/rise-2026-11-17T16:22:00Z'] });
  await writeLocal(data, { 'posted.json': posted });
  await publish(bare, history(['2026-11-17T16:09:41Z', before], ['2026-11-17T16:24:13Z', raised]));
  const lines = [];

  const result = await round({ work, fetch: network().fetch, at: '2026-11-17T16:27:00Z', dryRun: true, lines });

  assert.deepEqual({ handled: result.handled, posted: result.posted }, { handled: 1, posted: 0 });
  assert.deepEqual(lines, []);
  assert.equal(await readFile(join(data, 'posted.json'), 'utf8'), posted);
  assert.equal(existsSync(join(data, 'history-from.json')), false);
});

test('a bot with no posted.json takes its first synced round as a first run', async () => {
  const { bare, work, data } = await setup();
  await publish(bare, history(['2026-11-17T16:09:41Z', before], ['2026-11-17T16:24:13Z', raised]));
  const { requests, fetch } = network();

  const result = await round({ work, fetch, at: '2026-11-17T16:27:00Z' });

  assert.deepEqual({ handled: result.handled, posted: result.posted }, { handled: null, posted: 1 });
  assert.deepEqual(requests, ['POST https://discord.com/api/v10/channels/chan/messages']);
  assert.equal(existsSync(join(data, 'history-from.json')), true);
});

test('with no copy at all a failed fetch posts nothing and the round goes on', async () => {
  const { work } = await setup();
  git(['remote', 'set-url', 'origin', join(work, 'missing.git')], work);
  const { requests, fetch } = network();

  const result = await round({ work, fetch, at: '2026-11-17T16:27:00Z' });

  assert.match(syncLine('2026-11-17T16:27Z', result),
    /^2026-11-17T16:27Z sync failed: .+; kept the previous copy, no snapshots; posted 0, summarized 0$/);
  assert.deepEqual(requests, []);
});

test('a git command that hangs is stopped by its timeout and fails the sync, not the watcher', async () => {
  const { work } = await setup();
  // hash-object --stdin waits for input that never comes.
  await assert.rejects(runGit(['hash-object', '--stdin'], { cwd: work, timeout: 300 }),
    { message: 'git hash-object: timed out after 0.3 s' });

  const hanging = (args, options) => runGit(['hash-object', '--stdin'], { ...options, timeout: 300 });
  const result = await round({ work, git: hanging, fetch: network().fetch, at: '2026-11-17T16:27:00Z' });
  assert.equal(syncLine('2026-11-17T16:27Z', result),
    '2026-11-17T16:27Z sync failed: git hash-object: timed out after 0.3 s; ' +
    'kept the previous copy, no snapshots; posted 0, summarized 0');
});

test('a synced watcher runs five minutes after the job: :12, :27, :42, :57 for --every 15', () => {
  assert.equal(SYNC_MINUTE, 12);
  const at = (now, every = 15) => nextRun(new Date(now), every, SYNC_MINUTE).toISOString();
  assert.equal(at('2026-11-17T12:07:00Z'), '2026-11-17T12:12:00.000Z');
  assert.equal(at('2026-11-17T12:12:00Z'), '2026-11-17T12:27:00.000Z');
  assert.equal(at('2026-11-17T12:40:30Z'), '2026-11-17T12:42:00.000Z');
  assert.equal(at('2026-11-17T12:57:10Z'), '2026-11-17T13:12:00.000Z');
  // Without the third argument the usual rhythm is unchanged.
  assert.equal(nextRun(new Date('2026-11-17T12:00:00Z'), 15).toISOString(), '2026-11-17T12:07:00.000Z');
});

test('--history-from names a remote and a branch', () => {
  assert.deepEqual(parseHistoryFrom('origin/data'), { remote: 'origin', branch: 'data' });
  for (const bad of ['data', 'origin/', '/data', '--upload-pack=x/data', 'origin/-x', 'a b/data']) {
    assert.throws(() => parseHistoryFrom(bad),
      { message: '--history-from must be <remote>/<branch>, for example origin/data' });
  }
});
