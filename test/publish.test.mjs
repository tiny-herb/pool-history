// scripts/publish.mjs against local bare repositories standing in for GitHub, with a fake
// OpenRouter API and clock loaded into every node process through NODE_OPTIONS. Each run is a
// fresh shallow clone, as on a GitHub runner, so state can only carry over through the remote.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PUBLISH = fileURLToPath(new URL('../scripts/publish.mjs', import.meta.url));
const SITE_URL = 'https://tiny-herb.github.io/pool-history';
const CATALOGUE = 'https://openrouter.ai/api/v1/models?output_modalities=all';
const SOLO = 'https://openrouter.ai/api/v1/models/z/solo/endpoints';
const IDENTITY = {
  GIT_AUTHOR_NAME: 'Tiny Herb',
  GIT_AUTHOR_EMAIL: 'pool-history@invalid',
  GIT_COMMITTER_NAME: 'Tiny Herb',
  GIT_COMMITTER_EMAIL: 'pool-history@invalid',
};

const FAKE = `
import { readFileSync } from 'node:fs';
const routes = JSON.parse(readFileSync(process.env.FAKE_API, 'utf8'));
const shift = Date.parse(process.env.FAKE_NOW) - Date.now();
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...args) { if (args.length) super(...args); else super(RealDate.now() + shift); }
  static now() { return RealDate.now() + shift; }
};
globalThis.fetch = async url => {
  const route = routes[String(url)] ?? { status: 404, body: { error: 'not found' } };
  return new Response(JSON.stringify(route.body), { status: route.status ?? 200 });
};
`;

function endpoint(provider, prompt, completion) {
  return {
    provider_name: provider,
    tag: provider.toLowerCase(),
    pricing: { prompt, completion },
    context_length: 131072,
    quantization: 'fp8',
    status: 0,
    uptime_last_30m: 100,
    uptime_last_1d: 100,
  };
}

function api(betaPrompt) {
  return {
    [CATALOGUE]: { body: { data: [{ id: 'z/solo', name: 'Solo', pricing: { prompt: '0.000001', completion: '0.000002' } }] } },
    [SOLO]: {
      body: {
        data: {
          id: 'z/solo',
          name: 'Solo',
          endpoints: [endpoint('Alpha', '0.000001', '0.000002'), endpoint('Beta', betaPrompt, '0.0000024')],
        },
      },
    },
  };
}

function git(args, cwd) {
  return execFileSync('git', ['-c', 'core.autocrlf=false', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...IDENTITY },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

// A bare repository holding main with the same .gitignore as the real one.
function makeRemote(root) {
  const remote = join(root, 'remote.git');
  const seed = join(root, 'seed');
  git(['init', '--quiet', '--bare', '-b', 'main', remote], root);
  git(['init', '--quiet', '-b', 'main', seed], root);
  writeFileSync(join(seed, '.gitignore'), 'data/\nsite/\n');
  git(['add', '.gitignore'], seed);
  git(['commit', '--quiet', '-m', 'main'], seed);
  git(['push', '--quiet', remote, 'main'], seed);
  return remote;
}

let runs = 0;
function publish(root, remote, routes, now) {
  const run = join(root, `run-${++runs}`);
  git(['clone', '--quiet', '--depth=1', pathToFileURL(remote).href, run], root);
  const apiFile = join(root, `api-${runs}.json`);
  writeFileSync(apiFile, JSON.stringify(routes));
  const fake = join(root, 'fake.mjs');
  writeFileSync(fake, FAKE);
  return spawnSync(process.execPath, [PUBLISH], {
    cwd: run,
    encoding: 'utf8',
    env: {
      ...process.env,
      SITE_URL,
      FAKE_API: apiFile,
      FAKE_NOW: now,
      NODE_OPTIONS: `--import=${pathToFileURL(fake).href}`,
    },
  });
}

const files = (remote, ref) => git(['ls-tree', '-r', '--name-only', ref], remote).split('\n');
const show = (remote, spec) => git(['show', spec], remote);
const count = (remote, ref) => Number(git(['rev-list', '--count', ref], remote));

test('two scheduled runs persist the check record on data and replace the one gh-pages commit', t => {
  const root = mkdtempSync(join(tmpdir(), 'publish-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const remote = makeRemote(root);

  const first = publish(root, remote, api('0.0000012'), '2026-11-17T10:07:00Z');
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /check: 1 models, 0 error\(s\), 1 changed, kept full/);

  assert.deepEqual(files(remote, 'data'), ['checks.jsonl', 'snapshots/2026-11-17T1007Z.json']);
  assert.equal(count(remote, 'data'), 1);
  const pagesFiles = files(remote, 'gh-pages');
  for (const name of ['.nojekyll', 'index.html', 'feed.xml', 'style.css']) {
    assert.ok(pagesFiles.includes(name), `gh-pages lacks ${name}`);
  }
  assert.equal(show(remote, 'gh-pages:.nojekyll'), '');
  const feed1 = show(remote, 'gh-pages:feed.xml');
  // The channel links to the site; an item's own link is the OpenRouter page.
  assert.match(feed1, /<rss version="2.0"/);
  assert.ok(feed1.includes(`<link>${SITE_URL}/</link>`), feed1);
  assert.ok(feed1.includes(`<atom:link href="${SITE_URL}/feed.xml" rel="self"`), feed1);
  assert.equal(
    git(['log', '-1', '--format=%an <%ae>|%cn <%ce>', 'data'], remote),
    'Tiny Herb <pool-history@invalid>|Tiny Herb <pool-history@invalid>',
  );
  assert.match(git(['log', '-1', '--format=%B', 'data'], remote), /^Check at 2026-11-17T10:07:0\dZ: 1 models, 0 error\(s\), 1 changed, kept full/);
  const firstPages = git(['rev-parse', 'gh-pages'], remote);

  const second = publish(root, remote, api('0.0000015'), '2026-11-17T10:22:00Z');
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /check: 1 models, 0 error\(s\), 1 changed, kept partial/);

  // Keep rule: a full snapshot already exists for the day, so the changed model is
  // kept as a partial beside it, and the check log has one line per check.
  assert.deepEqual(files(remote, 'data'), [
    'checks.jsonl',
    'snapshots/2026-11-17T1007Z.json',
    'snapshots/2026-11-17T1022Z.json',
  ]);
  assert.equal(count(remote, 'data'), 2);
  const partial = JSON.parse(show(remote, 'data:snapshots/2026-11-17T1022Z.json'));
  assert.equal(partial.partial, true);
  assert.deepEqual(partial.catalogue, ['z/solo']);
  assert.deepEqual(partial.models['z/solo'].endpoints.map(e => [e.tag, e.prompt]), [['alpha', 1], ['beta', 1.5]]);
  const checks = show(remote, 'data:checks.jsonl').split('\n').map(line => JSON.parse(line));
  assert.deepEqual(checks.map(check => check.at.slice(0, 16)), ['2026-11-17T10:07', '2026-11-17T10:22']);

  assert.equal(count(remote, 'gh-pages'), 1);
  assert.notEqual(git(['rev-parse', 'gh-pages'], remote), firstPages);
  const feed2 = show(remote, 'gh-pages:feed.xml');
  const items = [...feed2.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(match => match[1]);
  const change = items.find(item => item.includes('Beta · input $1.20 to $1.50 per M (+25%)'));
  assert.ok(change, `no item for Beta's price change in:\n${feed2}`);
  assert.ok(change.includes(`<a href="${SITE_URL}/events.html">Pool history</a>`), change);
  assert.ok(change.includes('<link>https://openrouter.ai/z/solo</link>'), change);

  // A refused check (an empty catalogue) fails the run and moves no branch.
  const before = git(['for-each-ref', '--format=%(refname) %(objectname)'], remote);
  const refused = publish(root, remote, { [CATALOGUE]: { body: { data: [] } } }, '2026-11-17T10:37:00Z');
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /check refused: the catalogue came back empty; nothing written/);
  assert.equal(git(['for-each-ref', '--format=%(refname) %(objectname)'], remote), before);
});

test('a first run whose catalogue read fails creates neither branch', t => {
  const root = mkdtempSync(join(tmpdir(), 'publish-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const remote = makeRemote(root);

  const failed = publish(root, remote, {}, '2026-11-17T10:07:00Z');
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /returned HTTP 404/);
  assert.equal(git(['for-each-ref', '--format=%(refname)'], remote), 'refs/heads/main');
});
