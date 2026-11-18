import { parseCli } from './src/cli.mjs';
import {
  checkOnce,
  runOnce,
  nextRun,
  stopper,
  scrub,
  postFromHistory,
  parseHistoryFrom,
  syncOnce,
  syncLine,
  SYNC_MINUTE,
} from './src/watch.mjs';
import {
  takeSnapshot,
  writeSnapshot,
  loadSnapshot,
  catalogueLooksWrong,
} from './src/snapshot.mjs';
import { buildSite } from './src/build.mjs';
import { serve } from './src/serve.mjs';
import { diffSnapshots, eventSentence } from './src/events.mjs';
import { createLimits } from './src/route-limits.mjs';
import { connectGateway } from './src/gateway.mjs';
import { handleInteraction } from './src/interactions.mjs';

import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = 'data';
const SNAPSHOTS_DIR = join(DATA_DIR, 'snapshots');
const SITE_DIR = 'site';
const POSTED_PATH = join(DATA_DIR, 'posted.json');
const CHECKS_PATH = join(DATA_DIR, 'checks.jsonl');
const ROUTE_CHECKS_PATH = join(DATA_DIR, 'route-checks.json');

function nowDate() {
  return new Date();
}

function minuteStamp(value = nowDate()) {
  return new Date(value).toISOString().replace(/:\d{2}\.\d{3}Z$/, 'Z');
}

function fullError(error) {
  return error instanceof Error ? error.message : String(error);
}

function printError(command, error) {
  const message = scrub(fullError(error), [
    process.env.DISCORD_BOT_TOKEN,
    process.env.OPENROUTER_API_KEY,
  ]);
  process.stderr.write(`${command} failed: ${message}\n`);
}

function failArgument(parsed) {
  process.stderr.write(`${parsed.error}\n`);
  process.exitCode = 2;
}

async function commandSnapshot(options) {
  const started = performance.now();
  const snapshot = await takeSnapshot({
    concurrency: options.concurrency,
  });

  const previous = await (async () => {
    try {
      const names = (await readdir(options.dir))
        .filter(name => name.endsWith('.json'))
        .sort();
      if (!names.length) return null;
      const values = await Promise.all(
        names.map(name => loadSnapshot(join(options.dir, name))),
      );
      return values
        .filter(value => value?.partial === false &&
          value?.source === 'openrouter-api')
        .sort((a, b) => String(a.takenAt).localeCompare(String(b.takenAt)))
        .at(-1) || null;
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  })();

  const refusal = catalogueLooksWrong(snapshot, previous);
  if (refusal) {
    throw new Error(`snapshot refused: ${refusal}; nothing written`);
  }

  const path = await writeSnapshot(options.dir, snapshot);
  const endpoints = Object.values(snapshot.models)
    .reduce((sum, model) => sum + (Array.isArray(model.endpoints)
      ? model.endpoints.length
      : 0), 0);
  const errors = Object.values(snapshot.models)
    .filter(model => typeof model.error === 'string').length;

  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  process.stdout.write(
    `snapshot: ${snapshot.modelCount} models, ${endpoints} endpoints, ` +
    `${errors} error(s), ${seconds} s, wrote ${path}\n`,
  );
}

async function commandBuild(options) {
  const result = await buildSite({
    snapshotsDir: options.snapshots,
    siteDir: options.site,
    siteUrl: options['site-url'] ?? process.env.SITE_URL ?? null,
  });

  process.stdout.write(
    `build: ${result.snapshots} snapshots, ${result.models} models, ` +
    `${result.events} events, latest ${result.takenAt}, wrote ${options.site}/\n`,
  );
}

async function commandDiff(options) {
  const a = await loadSnapshot(resolve(options.a));
  const b = await loadSnapshot(resolve(options.b));
  const events = diffSnapshots(a, b);

  if (!events.length) {
    process.stdout.write(`${a.takenAt} to ${b.takenAt}: no changes\n`);
    return;
  }

  process.stdout.write(
    `${a.takenAt} to ${b.takenAt}: ${events.length} event` +
    `${events.length === 1 ? '' : 's'}\n`,
  );
  for (const event of events) {
    process.stdout.write(
      `${event.model}  ${eventSentence(event)}\n`,
    );
  }
}

async function commandServe(options) {
  const server = await serve({
    dir: options.site,
    port: options.port,
  });
  process.stdout.write(
    `serving ${options.site}/ at http://127.0.0.1:${options.port}/ ` +
    `(Ctrl+C to stop)\n`,
  );

  await new Promise(resolvePromise => {
    const stop = () => {
      process.removeListener('SIGINT', stop);
      server.close(() => resolvePromise());
    };
    process.once('SIGINT', stop);
  });
}

async function commandCheck() {
  const result = await checkOnce({
    dir: SNAPSHOTS_DIR,
    checksPath: CHECKS_PATH,
  });

  await buildSite({
    snapshotsDir: SNAPSHOTS_DIR,
    siteDir: SITE_DIR,
    siteUrl: process.env.SITE_URL || null,
    checksPath: CHECKS_PATH,
  });

  const kept = result.kind || 'nothing';
  process.stdout.write(
    `check: ${result.models} models, ${result.errors} error(s), ` +
    `${result.changed} changed, kept ${kept}` +
    `${result.path ? ` (${result.path})` : ''}; rebuilt site/\n`,
  );
}

async function commandPost(options) {
  // Only `watch` skips posting without Discord settings; `post` fails (exit 2) before reading or writing anything.
  if (!options['dry-run'] &&
      (!process.env.DISCORD_BOT_TOKEN || !process.env.DISCORD_CHANNEL_ID)) {
    throw new Error('DISCORD_BOT_TOKEN or DISCORD_CHANNEL_ID not set');
  }

  const result = await postFromHistory({
    dir: SNAPSHOTS_DIR,
    checksPath: CHECKS_PATH,
    statePath: POSTED_PATH,
    env: process.env,
    dryRun: options['dry-run'],
    log: line => process.stdout.write(`${line}\n`),
  });

  if (options['dry-run']) {
    process.stdout.write(
      `post: would post ${result.posted}, summarized ${result.summarized} ` +
      `(dry run: nothing sent, posted.json unchanged)\n`,
    );
  } else {
    process.stdout.write(
      `post: posted ${result.posted}, summarized ${result.summarized}\n`,
    );
  }
}

async function commandWatch(options) {
  const env = process.env;
  const log = line => process.stdout.write(`${scrub(line, [
    env.DISCORD_BOT_TOKEN,
    env.OPENROUTER_API_KEY,
  ])}\n`);
  // With --history-from the rounds post from the scheduled job's branch and make no check of their own.
  const historyFrom = options['history-from'];
  if (historyFrom !== undefined) parseHistoryFrom(historyFrom);

  if (!env.OPENROUTER_API_KEY) {
    log('OPENROUTER_API_KEY not set: cards post without the Test request button');
  }

  const limits = createLimits(ROUTE_CHECKS_PATH);
  let gateway = null;
  let currentRun = null;

  const stop = stopper({
    log,
    exit: code => {
      if (gateway) gateway.close();
      process.exit(code);
    },
  });

  const onSignal = () => stop.request();
  process.on('SIGINT', onSignal);

  if (env.DISCORD_BOT_TOKEN && env.OPENROUTER_API_KEY &&
      !options.once && !options['dry-run']) {
    gateway = connectGateway({
      token: env.DISCORD_BOT_TOKEN,
      onInteraction: interaction => stop.track(handleInteraction(interaction, {
        apiKey: env.OPENROUTER_API_KEY,
        limits,
        log,
      })),
      log,
    });
  }

  // Each round's line ends with the gateway's state when the bot holds one.
  const gatewayState = () => gateway
    ? `; gateway ${gateway.isReady() ? 'ready' : 'down'}`
    : '';

  async function round() {
    const stamp = minuteStamp();
    if (historyFrom !== undefined) {
      log(syncLine(stamp, await syncOnce({
        dataDir: DATA_DIR,
        from: historyFrom,
        env,
        dryRun: options['dry-run'],
        log,
      })) + gatewayState());
      return;
    }

    const result = await runOnce({
      dir: SNAPSHOTS_DIR,
      checksPath: CHECKS_PATH,
      siteDir: SITE_DIR,
      statePath: POSTED_PATH,
      env,
      dryRun: options['dry-run'],
      log,
    });

    const check = await (async () => {
      try {
        const names = (await readdir(SNAPSHOTS_DIR))
          .filter(name => name.endsWith('.json'));
        if (!names.length) return { models: 0, errors: 0 };
        const values = await Promise.all(
          names.map(name => loadSnapshot(join(SNAPSHOTS_DIR, name))),
        );
        const latest = values.sort((a, b) =>
          String(b.takenAt).localeCompare(String(a.takenAt)))[0];
        return {
          models: latest.modelCount,
          errors: Object.values(latest.models || {})
            .filter(model => typeof model.error === 'string').length,
        };
      } catch {
        return { models: 0, errors: 0 };
      }
    })();

    log(
      `${stamp} check: ${check.models} models, ${check.errors} error` +
      `${check.errors === 1 ? '' : 's'}, ${result.changed} changed, ` +
      `kept ${result.kind || 'nothing'}; posted ${result.posted}, ` +
      `summarized ${result.summarized}${gatewayState()}`,
    );
  }

  async function execute() {
    try {
      currentRun = stop.run(round);
      await currentRun;
    } catch (error) {
      log(`${minuteStamp()} ${historyFrom === undefined ? 'check' : 'post'} failed: ${fullError(error)}${gatewayState()}`);
      if (options.once) process.exitCode = 2;
    } finally {
      currentRun = null;
    }
  }

  await execute();

  if (options.once || process.exitCode === 2) {
    if (gateway) gateway.close();
    process.removeListener('SIGINT', onSignal);
    return;
  }

  while (true) {
    const target = nextRun(new Date(), options.every,
      historyFrom === undefined ? undefined : SYNC_MINUTE);
    const delay = Math.max(0, target.getTime() - Date.now());
    await new Promise(resolvePromise => setTimeout(resolvePromise, delay));
    if (stop.requested) break;
    await execute();
  }

  if (gateway) gateway.close();
  process.removeListener('SIGINT', onSignal);
}

async function main() {
  const parsed = parseCli(process.argv.slice(2));
  if (parsed.error) {
    failArgument(parsed);
    return;
  }

  const { command, options } = parsed;

  if (command === 'snapshot') await commandSnapshot(options);
  else if (command === 'build') await commandBuild(options);
  else if (command === 'diff') await commandDiff(options);
  else if (command === 'serve') await commandServe(options);
  else if (command === 'check') await commandCheck();
  else if (command === 'post') await commandPost(options);
  else if (command === 'watch') await commandWatch(options);
}

const entry = process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (entry) {
  main().catch(error => {
    const command = process.argv[2] || 'command';
    printError(command, error);
    process.exitCode = 2;
  });
}
