import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import {
  takeSnapshot,
  writeSnapshot,
  readSnapshots,
  catalogueLooksWrong,
} from './snapshot.mjs';
import { HistoryBuilder } from './history.mjs';
import { readChecks, appendCheck, checkRecord } from './checks.mjs';
import { buildSite } from './build.mjs';
import { feedItems } from './feed.mjs';
import {
  postPending,
  readState,
  selectToPost,
  markPosted,
  writeState,
} from './post.mjs';
import { createUsageCache } from './usage.mjs';
import { endpointsUrl, normalizeEndpoints } from './endpoints.mjs';

const processUsageCache = createUsageCache();

function utcDay(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function idsOf(snapshot) {
  if (Array.isArray(snapshot?.catalogue)) return [...snapshot.catalogue];
  return Object.keys(snapshot?.models || {});
}

function observed(entry) {
  return Boolean(entry && Array.isArray(entry.endpoints));
}

function previousFullFromStored(stored) {
  return [...(stored || [])]
    .filter(s => s?.partial === false && s?.source === 'openrouter-api')
    .sort((a, b) => String(a.takenAt).localeCompare(String(b.takenAt)))
    .at(-1) || null;
}

export function changedModels(snapshot, history) {
  if (!history) return [];

  let result;
  if (typeof history.changedModels === 'function') {
    result = history.changedModels(snapshot);
  } else {
    result = Object.keys(snapshot?.models || {}).filter(id => {
      const entry = snapshot.models[id];
      const model = history.models?.[id];
      if (!model || !observed(entry)) return false;

      if (
        model.firstSeen?.takenAt === snapshot.takenAt &&
        Array.isArray(entry.endpoints) &&
        entry.endpoints.length > 0
      ) {
        return true;
      }

      return Array.isArray(model.events) &&
        model.events.some(event => event.at === snapshot.takenAt);
    });
  }

  const ids = [...new Set((result || []).filter(id => snapshot?.models?.[id]))];

  // A HistoryBuilder may provide its own ordered comparison result. Preserve
  // that order; the folded History path below is sorted for deterministic files.
  return typeof history.changedModels === 'function' ? ids : ids.sort();
}

export function keepDecision(snapshot, history, stored = []) {
  // The history may already hold this snapshot; it is not a stored one.
  const heads = (history?.snapshots || []).filter(item => item?.takenAt !== snapshot.takenAt);
  const fullToday = [...(stored || []), ...heads].some(item =>
    item?.source === 'openrouter-api' &&
    item?.partial === false &&
    utcDay(item.takenAt) === utcDay(snapshot.takenAt)
  );

  if (!fullToday) {
    return {
      kind: 'full',
      models: changedModels(snapshot, history),
    };
  }

  const models = new Set(changedModels(snapshot, history));

  // Departures awaiting confirmation before this snapshot (HistoryBuilder.pendingModels()).
  if (typeof history?.pendingModels === 'function') {
    for (const id of history.pendingModels()) {
      if (observed(snapshot?.models?.[id])) models.add(id);
    }
  }

  const hModels = history?.models || {};
  for (const id of Object.keys(snapshot?.models || {})) {
    if (!observed(snapshot.models[id])) continue;
    const events = hModels[id]?.events || [];
    if (events.some(event =>
      event.type === 'left' &&
      event.confirmed === false &&
      !event.returned &&
      !event.replacedBy
    )) {
      models.add(id);
    }
  }

  const previousCatalogue = [...(stored || [])]
    .reverse()
    .find(item => item?.catalogue)?.catalogue;

  const currentCatalogue = idsOf(snapshot).sort();
  const catalogueChanged = previousCatalogue
    ? JSON.stringify([...previousCatalogue].sort()) !== JSON.stringify(currentCatalogue)
    : false;

  if (models.size || catalogueChanged) {
    return {
      kind: 'partial',
      models: [...models].sort(),
    };
  }

  return { kind: null, models: [] };
}

export function partialSnapshot(snapshot, models) {
  const catalogue = idsOf(snapshot).sort();
  // Kept models stay in the snapshot's own (catalogue) order.
  const wanted = new Set(models || []);
  const selected = Object.keys(snapshot.models || {}).filter(id => wanted.has(id));

  const result = {
    takenAt: snapshot.takenAt,
    source: snapshot.source,
    partial: true,
    note: snapshot.note ?? null,
    modelCount: snapshot.modelCount,
    models: {},
  };

  if (
    snapshot.source === 'openrouter-api' ||
    Object.prototype.hasOwnProperty.call(snapshot, 'catalogue')
  ) {
    result.catalogue = catalogue;
  }

  for (const id of selected) {
    result.models[id] = structuredClone(snapshot.models[id]);
  }

  return result;
}

export async function loadHistory(dir, { checksPath = null } = {}) {
  const snapshots = await readSnapshots(dir);
  const checks = await readChecks(
    checksPath || join(dirname(dir), 'checks.jsonl'),
  );

  const builder = new HistoryBuilder({ checks });
  for (const snapshot of snapshots) builder.add(snapshot);
  return builder.finish();
}

async function storedHeads(dir) {
  const snapshots = await readSnapshots(dir);
  return { snapshots, heads: snapshots.map(snapshot => ({
    takenAt: snapshot.takenAt,
    source: snapshot.source,
    partial: snapshot.partial,
    modelCount: snapshot.modelCount,
    ...(Array.isArray(snapshot.catalogue)
      ? { catalogue: snapshot.catalogue }
      : snapshot.partial === false
        ? { catalogue: Object.keys(snapshot.models || {}) }
        : {}),
  })) };
}

export async function checkOnce({
  dir,
  checksPath = null,
  fetch = globalThis.fetch,
  now = () => new Date(),
  sleep,
  concurrency,
} = {}) {
  const started = now();
  const snapshot = await takeSnapshot({
    fetch,
    now: () => started,
    sleep,
    concurrency,
  });

  let stored = [];
  let storedSnapshots = [];
  try {
    const loaded = await storedHeads(dir);
    stored = loaded.heads;
    storedSnapshots = loaded.snapshots;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const previousFull = previousFullFromStored(stored);
  const refusal = catalogueLooksWrong(snapshot, previousFull);
  if (refusal) {
    throw new Error(`check refused: ${refusal}; nothing written`);
  }

  const checks = await readChecks(
    checksPath || join(dirname(dir), 'checks.jsonl'),
  );
  const builder = new HistoryBuilder({ checks });
  for (const storedSnapshot of storedSnapshots) builder.add(storedSnapshot);
  const pending = builder.pendingModels();
  builder.add(snapshot);
  const history = builder.finish();

  const changed = changedModels(snapshot, history);
  const decision = keepDecision(snapshot, { ...history, pendingModels: () => pending }, stored);
  let path = null;

  if (decision.kind === 'full') {
    path = await writeSnapshot(dir, snapshot);
  } else if (decision.kind === 'partial') {
    path = await writeSnapshot(dir, partialSnapshot(snapshot, decision.models));
  }

  await appendCheck(
    checksPath || join(dirname(dir), 'checks.jsonl'),
    checkRecord(snapshot),
  );

  const errors = Object.values(snapshot.models || {})
    .filter(entry => typeof entry?.error === 'string').length;

  return {
    kind: decision.kind,
    changed: changed.length,
    path,
    errors,
    models: snapshot.modelCount,
  };
}

export function nextRun(now, everyMinutes, minute = 7) {
  const original = new Date(now);
  const date = new Date(original);
  const cadence = Math.max(1, Math.trunc(Number(everyMinutes) || 1));

  date.setUTCSeconds(0, 0);
  date.setUTCMinutes(date.getUTCMinutes() + 1);

  while (date.getUTCMinutes() % cadence !== minute % cadence) {
    date.setUTCMinutes(date.getUTCMinutes() + 1);
  }

  return date;
}

export function scrub(text, secrets) {
  let result = String(text);
  for (const secret of secrets || []) {
    if (typeof secret !== 'string' || secret.length === 0) continue;
    result = result.split(secret).join('[redacted]');
  }
  return result;
}

export function stopper({ exit, log }) {
  let requested = false;
  let running = 0;
  let forced = false;
  let stopped = false;
  const tracked = new Set();

  function finishIfReady() {
    if (!requested || forced || stopped || running > 0 || tracked.size > 0) return;
    stopped = true;
    log('watch stopped');
    exit(0);
  }

  function request() {
    if (requested) {
      forced = true;
      exit(130);
      return;
    }

    requested = true;
    if (running === 0 && tracked.size === 0) {
      finishIfReady();
      return;
    }

    // Name only what the stop waits for: the run (if one is under way) and the answers in progress.
    const count = tracked.size;
    const waits = [];
    if (running > 0) waits.push('this run');
    if (count) waits.push(`${count} Test request answer${count === 1 ? '' : 's'} in progress`);
    log(`stopping after ${waits.join(' and ')} (Ctrl+C again to stop now)`);
  }

  async function track(promise) {
    tracked.add(promise);
    try {
      return await promise;
    } finally {
      tracked.delete(promise);
      finishIfReady();
    }
  }

  async function run(fn) {
    running++;
    try {
      const result = await fn();
      if (tracked.size > 0) {
        await Promise.allSettled([...tracked]);
      }
      return result;
    } finally {
      running--;
      finishIfReady();
    }
  }

  return { request, run, track };
}

async function usageFor({ env, fetch, now, log, usageCache }) {
  if (!env?.OPENROUTER_API_KEY) return null;
  return (usageCache || processUsageCache).get({
    fetch,
    apiKey: env.OPENROUTER_API_KEY,
    now: now(),
    log,
  });
}

async function trafficForFactory({ fetch, env }) {
  if (!env?.OPENROUTER_API_KEY) return null;

  return async model => {
    const response = await fetch(endpointsUrl(model), {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      },
    });
    if (!response.ok) throw new Error(`traffic request failed: ${response.status}`);
    return normalizeEndpoints(await response.json()).endpoints;
  };
}

export async function postFromHistory({
  dir,
  checksPath = null,
  statePath,
  env,
  fetch = globalThis.fetch,
  now = () => new Date(),
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  dryRun = false,
  log = () => {},
  onFailure = log,
  usageCache = processUsageCache,
} = {}) {
  if (!statePath || !env) throw new Error('posting inputs are required');

  const history = await loadHistory(dir, { checksPath });
  const items = feedItems(history, { siteUrl: env.SITE_URL || null });
  const usage = await usageFor({ env, fetch, now, log, usageCache });
  const trafficFor = await trafficForFactory({ fetch, env });

  if (!dryRun && (!env.DISCORD_BOT_TOKEN || !env.DISCORD_CHANNEL_ID)) {
    log('post skipped: DISCORD_BOT_TOKEN or DISCORD_CHANNEL_ID not set');
    return { posted: 0, summarized: 0 };
  }

  try {
    return await postPending({
      items,
      statePath,
      token: env.DISCORD_BOT_TOKEN,
      channelId: env.DISCORD_CHANNEL_ID,
      siteUrl: env.SITE_URL || null,
      now: now().toISOString(),
      fetch,
      sleep,
      dryRun,
      log: onFailure,
      routeButton: Boolean(env.OPENROUTER_API_KEY),
      usage,
      trafficFor,
    });
  } catch (error) {
    error.logged = true;
    throw error;
  }
}

// `watch --history-from <remote>/<branch>`: the branch the scheduled job publishes (snapshots/ and
// checks.jsonl at its root, see scripts/publish.mjs) is the one history. The bot makes no check of
// its own: each round copies the branch into data/ and posts from it. The fetch goes into a bare
// repository of the bot's own (data/history.git), so the bot never touches the checkout it runs
// from, and it never pushes.

// The job runs at :07, :22, :37, :52 and takes a minute or two; five minutes later posts a job that
// ran on time in the same quarter hour, and a late one in the next round.
export const SYNC_MINUTE = 12;

const GIT_TIMEOUT_MS = 60_000;
const HANDOVER_FILE = 'history-from.json';

export function parseHistoryFrom(value) {
  const match = /^([\w.-]+)\/([\w./-]+)$/.exec(String(value ?? ''));
  if (!match || match[1].startsWith('-') || match[2].startsWith('-')) {
    throw new Error('--history-from must be <remote>/<branch>, for example origin/data');
  }
  return { remote: match[1], branch: match[2] };
}

function withoutCredentials(text) {
  return String(text).replace(/\/\/[^/@\s]+@/g, '//');
}

export function runGit(args, { cwd, env = {}, timeout = GIT_TIMEOUT_MS } = {}) {
  return new Promise((resolvePromise, reject) => {
    execFile('git', ['-c', 'core.autocrlf=false', ...args], {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env },
      timeout,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      if (!error) {
        resolvePromise(String(stdout).trim());
        return;
      }
      const command = args.find(arg => !arg.startsWith('-'));
      const reason = error.killed
        ? `timed out after ${timeout / 1000} s`
        : String(stderr).trim().split(/\r?\n/)[0] || error.message;
      reject(new Error(withoutCredentials(`git ${command}: ${reason}`)));
    });
  });
}

// Replaces <dataDir>/snapshots and <dataDir>/checks.jsonl with the branch's. The branch is read
// into a new folder first, so a failed fetch or read leaves the previous copy as it was.
export async function syncHistory({ dataDir, from, cwd = process.cwd(), git = runGit }) {
  const { remote, branch } = parseHistoryFrom(from);
  const data = resolve(cwd, dataDir);
  const cache = join(data, 'history.git');
  const ref = `refs/heads/${branch}`;

  await mkdir(data, { recursive: true });
  if (!existsSync(join(cache, 'HEAD'))) await git(['init', '--quiet', '--bare', cache], { cwd });
  const url = await git(['remote', 'get-url', remote], { cwd });
  await git([`--git-dir=${cache}`, 'fetch', '--quiet', '--depth=1', '--no-tags', url, `+${ref}:${ref}`], { cwd });

  const fresh = await mkdtemp(join(data, '.sync-'));
  const index = `${fresh}.index`;
  const previous = `${fresh}.previous`;
  try {
    await git([`--git-dir=${cache}`, `--work-tree=${fresh}`, 'read-tree', '--reset', '-u', ref], {
      cwd,
      env: { GIT_INDEX_FILE: index },
    });
    if (!existsSync(join(fresh, 'snapshots'))) throw new Error(`${from} has no snapshots/ folder`);

    const checks = join(data, 'checks.jsonl');
    if (existsSync(join(fresh, 'checks.jsonl'))) await rename(join(fresh, 'checks.jsonl'), checks);
    else await rm(checks, { force: true });

    const snapshots = join(data, 'snapshots');
    if (existsSync(snapshots)) await rename(snapshots, previous);
    try {
      await rename(join(fresh, 'snapshots'), snapshots);
    } catch (error) {
      if (existsSync(previous)) await rename(previous, snapshots);
      throw error;
    }
  } finally {
    await Promise.all([fresh, index, previous].map(path => rm(path, { recursive: true, force: true })));
  }
}

async function describeCopy(dir) {
  let names = [];
  try {
    names = (await readdir(dir)).filter(name => name.endsWith('.json')).sort();
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  // Snapshot files are named by their check time to the minute (2026-11-17T2207Z.json).
  const newest = names.at(-1)?.replace(/^(.*T\d{2})(\d{2})Z\.json$/, '$1:$2Z') ?? null;
  return { snapshots: names.length, newest };
}

// The first synced round after the bot posted from a history of its own: the branch's items carry
// other check times, so other ids, than the ones in posted.json. Everything the branch holds at the
// switch is marked handled, as a first run marks what it does not post, and nothing is posted.
// Departures still awaiting confirmation stay unmarked, so they post when confirmed.
async function handOver({ dir, checksPath, statePath, state, env, now, dryRun }) {
  const history = await loadHistory(dir, { checksPath });
  const items = feedItems(history, { siteUrl: env.SITE_URL || null });
  const { cards, summary, quiet } = selectToPost(items, state, { now });
  const handled = new Set([...quiet, ...[...summary, ...cards].map(item => item.guid)]);
  const oldestFirst = items
    .filter(item => handled.has(item.guid))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .map(item => item.guid);
  if (!dryRun) await writeState(statePath, markPosted(state, oldestFirst, { now }));
  return handled.size;
}

export async function syncOnce({
  dataDir,
  from,
  env,
  cwd = process.cwd(),
  git = runGit,
  fetch = globalThis.fetch,
  now = () => new Date(),
  sleep = ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms)),
  dryRun = false,
  log = console.log,
  usageCache = processUsageCache,
} = {}) {
  const data = resolve(cwd, dataDir);
  const dir = join(data, 'snapshots');
  const checksPath = join(data, 'checks.jsonl');
  const statePath = join(data, 'posted.json');
  const handoverPath = join(data, HANDOVER_FILE);

  let failure = null;
  try {
    await syncHistory({ dataDir: data, from, cwd, git });
  } catch (error) {
    failure = withoutCredentials(error instanceof Error ? error.message : String(error));
  }

  const copy = await describeCopy(dir);
  const result = { from, ...copy, error: failure, handled: null, posted: 0, summarized: 0 };
  const firstSync = !failure && !existsSync(handoverPath);
  const state = firstSync ? await readState(statePath) : null;

  // With no copy at all (the first fetch failed) there is nothing to post from.
  if (copy.snapshots && firstSync && state != null) {
    result.handled = await handOver({
      dir, checksPath, statePath, state, env, now: now().toISOString(), dryRun,
    });
  } else if (copy.snapshots) {
    Object.assign(result, await postFromHistory({
      dir, checksPath, statePath, env, fetch, now, sleep, dryRun, log, usageCache,
    }));
  }

  if (firstSync && !dryRun) {
    await writeFile(handoverPath, `${JSON.stringify({ from, since: now().toISOString() }, null, 2)}\n`);
  }
  return result;
}

function counted(n, noun) {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

export function syncLine(stamp, result) {
  const copy = result.snapshots
    ? `${counted(result.snapshots, 'snapshot')}, newest ${result.newest}`
    : 'no snapshots';
  const head = result.error
    ? `sync failed: ${result.error}; kept the previous copy, ${copy}`
    : `sync: ${copy}`;
  const switched = result.handled == null
    ? ''
    : `; switched to ${result.from}, ${counted(result.handled, 'item')} marked as already posted`;
  return `${stamp} ${head}${switched}; posted ${result.posted}, summarized ${result.summarized}`;
}

export async function runOnce({
  dir,
  checksPath = null,
  siteDir,
  statePath,
  env = process.env,
  fetch = globalThis.fetch,
  now = () => new Date(),
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  dryRun = false,
  log = console.log,
} = {}) {
  try {
    const result = await checkOnce({
      dir,
      checksPath,
      fetch,
      now,
      sleep,
    });

    await buildSite({
      snapshotsDir: dir,
      siteDir,
      siteUrl: env.SITE_URL || null,
      checksPath,
    });

    const posted = await postFromHistory({
      dir,
      checksPath,
      statePath,
      env,
      fetch,
      now,
      sleep,
      dryRun,
      log,
    });

    return {
      kind: result.kind,
      changed: result.changed,
      posted: posted.posted,
      summarized: posted.summarized,
    };
  } catch (error) {
    error.logged = true;
    throw error;
  }
}
