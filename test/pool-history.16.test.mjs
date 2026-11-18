// `watch --once --history-from origin/data` run from the command line, in a checkout whose `origin` is
// a bare repository in a temp folder. A preloaded fetch reports any request, so the test shows the
// round makes none: no OpenRouter check.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const modulePath = fileURLToPath(new URL('../pool-history.mjs', import.meta.url));
const noNetwork = 'data:text/javascript,globalThis.fetch=async url=>{process.stderr.write(`REQUEST ${url}\\n`);throw new TypeError("offline")}';

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
const full = (takenAt, endpoints) => `${JSON.stringify({
  takenAt, source: 'openrouter-api', partial: false, note: null, modelCount: 1,
  models: { 'z/rise': { name: 'Rise', listed: { prompt: 1, completion: 2 }, endpoints } },
}, null, 2)}\n`;

async function checkout() {
  const root = await mkdtemp(join(tmpdir(), 'pool-history-sync-'));
  const bare = join(root, 'remote.git');
  const work = join(root, 'work');
  const scratch = join(root, 'tree');
  git(['init', '--quiet', '--bare', bare], root);
  await mkdir(join(scratch, 'snapshots'), { recursive: true });
  await writeFile(join(scratch, 'snapshots', '2026-11-17T1609Z.json'),
    full('2026-11-17T16:09:41Z', [live('n1', 'N1', 1, 2)]));
  await writeFile(join(scratch, 'snapshots', '2026-11-17T1624Z.json'),
    full('2026-11-17T16:24:13Z', [live('n1', 'N1', 1.5, 3)]));
  await writeFile(join(scratch, 'checks.jsonl'),
    '{"at":"2026-11-17T16:09:41Z","models":1,"errors":[]}\n{"at":"2026-11-17T16:24:13Z","models":1,"errors":[]}\n');
  const index = { GIT_INDEX_FILE: join(root, 'tree.index') };
  git([`--git-dir=${bare}`, `--work-tree=${scratch}`, 'add', '-A', '.'], root, index);
  const tree = git([`--git-dir=${bare}`, 'write-tree'], root, index);
  const commit = git([`--git-dir=${bare}`, 'commit-tree', tree, '-m', 'Check'], root);
  git([`--git-dir=${bare}`, 'update-ref', 'refs/heads/data', commit], root);
  await rm(scratch, { recursive: true });
  await mkdir(work);
  git(['init', '--quiet', work], root);
  git(['remote', 'add', 'origin', bare], work);
  return { bare, work };
}

function run(args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, ['--import', noNetwork, modulePath, ...args], {
      cwd,
      env: { ...process.env, DISCORD_BOT_TOKEN: '', DISCORD_CHANNEL_ID: '', OPENROUTER_API_KEY: '', SITE_URL: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => resolvePromise({ code, stdout, stderr }));
  });
}

test('watch --once --history-from origin/data copies the branch into data/ and checks nothing itself', async () => {
  const { bare, work } = await checkout();
  const refs = git(['for-each-ref', '--format=%(refname) %(objectname)'], bare);

  const result = await run(['watch', '--once', '--history-from', 'origin/data'], work);

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  const lines = result.stdout.trimEnd().split('\n');
  assert.deepEqual(lines.slice(0, 2), [
    'OPENROUTER_API_KEY not set: cards post without the Test request button',
    'post skipped: DISCORD_BOT_TOKEN or DISCORD_CHANNEL_ID not set',
  ]);
  assert.match(lines[2],
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z sync: 2 snapshots, newest 2026-11-17T16:24Z; posted 0, summarized 0$/);
  assert.equal(lines.length, 3);
  assert.deepEqual(await readdir(join(work, 'data', 'snapshots')),
    ['2026-11-17T1609Z.json', '2026-11-17T1624Z.json']);
  assert.match(await readFile(join(work, 'data', 'checks.jsonl'), 'utf8'), /16:24:13Z/);
  // No site built, no push: the remote's refs are as they were.
  assert.equal(existsSync(join(work, 'site')), false);
  assert.equal(git(['for-each-ref', '--format=%(refname) %(objectname)'], bare), refs);
});

test('watch --history-from without <remote>/<branch> fails with exit 2 before doing anything', async () => {
  const { work } = await checkout();

  const result = await run(['watch', '--once', '--history-from', 'data'], work);

  assert.equal(result.code, 2);
  assert.equal(result.stderr,
    'watch failed: --history-from must be <remote>/<branch>, for example origin/data\n');
  assert.equal(existsSync(join(work, 'data')), false);
});
