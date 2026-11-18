// One scheduled update of the public copy, run by .github/workflows/update.yml from the root of a
// fresh checkout of main whose `origin` is the GitHub repository.
//
// Branch `data` holds `snapshots/` and `checks.jsonl`, the state `check` needs from the last run.
// Branch `gh-pages` holds the built site as one commit, replaced every run.
//
// Order: restore data/ from `data`, run `check` (it snapshots and rebuilds site/), then push both
// branches in one atomic push. A failed check or build throws before the push, so neither branch
// moves.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../pool-history.mjs', import.meta.url));
const IDENTITY = {
  GIT_AUTHOR_NAME: 'Tiny Herb',
  GIT_AUTHOR_EMAIL: 'pool-history@invalid',
  GIT_COMMITTER_NAME: 'Tiny Herb',
  GIT_COMMITTER_EMAIL: 'pool-history@invalid',
};

function git(args, index) {
  return execFileSync('git', ['-c', 'core.autocrlf=false', ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...IDENTITY, ...(index ? { GIT_INDEX_FILE: index } : {}) },
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim();
}

if (!process.env.SITE_URL) throw new Error('SITE_URL is not set: the feed links would not be absolute');
if (existsSync('data') || existsSync('site')) {
  throw new Error('data/ or site/ already exists: run this only in a fresh checkout');
}

const gitDir = git(['rev-parse', '--absolute-git-dir']);
const dataIndex = join(gitDir, 'publish-data.index');
const pagesIndex = join(gitDir, 'publish-pages.index');
rmSync(dataIndex, { force: true });
rmSync(pagesIndex, { force: true });

mkdirSync('data');
let dataTip = null;
if (git(['ls-remote', '--heads', 'origin', 'refs/heads/data'])) {
  git(['fetch', '--quiet', '--depth=1', 'origin', '+refs/heads/data:refs/remotes/origin/data']);
  dataTip = git(['rev-parse', 'refs/remotes/origin/data']);
  git(['--work-tree=data', 'read-tree', '--reset', '-u', dataTip], dataIndex);
}

const line = execFileSync(process.execPath, [CLI, 'check'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
}).trim();
console.log(line);

const refspecs = [];

git(['--work-tree=data', 'add', '-A', '-f', '--', 'snapshots', 'checks.jsonl'], dataIndex);
const dataTree = git(['write-tree'], dataIndex);
if (!dataTip || dataTree !== git(['rev-parse', `${dataTip}^{tree}`])) {
  const at = JSON.parse(readFileSync('data/checks.jsonl', 'utf8').trim().split('\n').at(-1)).at;
  const recorded = line.replace(/^check: /, '').replace(/; rebuilt site\/$/, '');
  const parent = dataTip ? ['-p', dataTip] : [];
  const commit = git(['commit-tree', dataTree, ...parent, '-m', `Check at ${at}: ${recorded}`]);
  refspecs.push(`${commit}:refs/heads/data`);
}

writeFileSync('site/.nojekyll', '');
git(['--work-tree=site', 'add', '-A', '-f', '.'], pagesIndex);
const pagesTree = git(['write-tree'], pagesIndex);
const { takenAt } = JSON.parse(readFileSync('site/data/index.json', 'utf8'));
const pages = git([
  'commit-tree', pagesTree,
  '-m', `Publish the site and feed, built from snapshots up to ${takenAt}`,
]);
refspecs.push(`+${pages}:refs/heads/gh-pages`);

git(['push', '--atomic', 'origin', ...refspecs]);
console.log(`publish: pushed ${refspecs.map(spec => spec.replace(/^.*refs\/heads\//, '')).join(' and ')}`);
