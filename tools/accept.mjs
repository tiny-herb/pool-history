import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';

// The main checkout's folder, also from a linked worktree, where `.env` lives.
function mainCheckout() {
  const common = execFileSync(
    'git',
    ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    { encoding: 'utf8' }
  ).trim();
  return path.dirname(common);
}

export function snapshotName(takenAt) {
  const d = new Date(takenAt);
  const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}Z.json`;
}

export function stagePriceRaise(input) {
  const snapshot = structuredClone(input);
  const model = Object.keys(snapshot.models).find(id => {
    const endpoints = snapshot.models[id].endpoints || [];
    return endpoints.filter(e =>
      typeof e.prompt === 'number' && typeof e.completion === 'number'
    ).length >= 2 && endpoints.some(e => e.prompt > 0);
  });
  if (!model) throw new Error('no model has two priced endpoints');

  const endpoint = snapshot.models[model].endpoints.find(e =>
    e.prompt > 0 && typeof e.completion === 'number'
  );
  endpoint.prompt = Number((endpoint.prompt * 1.5).toPrecision(6));
  endpoint.completion = Number((endpoint.completion * 1.5).toPrecision(6));
  snapshot.takenAt = new Date(new Date(snapshot.takenAt).getTime() + 60000)
    .toISOString().replace('.000Z', 'Z');

  return {
    snapshot,
    model,
    provider: endpoint.provider,
    tag: endpoint.tag
  };
}

function defaultRun(repo, scratch, args, { env }) {
  return spawnSync(process.execPath, [path.join(repo, 'pool-history.mjs'), ...args], {
    cwd: scratch,
    env,
    encoding: 'utf8',
    timeout: 600000
  });
}

function status(repo) {
  return execFileSync('git', ['status', '--porcelain', '--ignored'], {
    cwd: repo,
    encoding: 'utf8'
  });
}

export function checkSite(site) {
  const checks = [];
  const xmlPath = path.join(site, 'feed.xml');
  const xml = fs.existsSync(xmlPath) ? fs.readFileSync(xmlPath, 'utf8') : '';
  checks.push({
    name: 'RSS feed',
    ok: /<rss\b[^>]*version="2\.0"/.test(xml) && /<item\b/.test(xml),
    reason: 'feed.xml is not RSS 2.0 with items'
  });

  let json;
  try {
    json = JSON.parse(fs.readFileSync(path.join(site, 'feed.json'), 'utf8'));
  } catch {
    json = null;
  }
  checks.push({
    name: 'JSON feed',
    ok: !!json && Array.isArray(json.items) && json.items.length > 0,
    reason: 'feed.json has no items'
  });

  for (const file of ['index.html', 'events.html']) {
    checks.push({
      name: `${file} exists`,
      ok: fs.existsSync(path.join(site, file)),
      reason: `${file} is missing`
    });
  }

  const cssPath = path.join(site, 'style.css');
  const css = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf8') : '';
  const files = ['index.html', 'events.html', 'feed.html']
    .filter(file => fs.existsSync(path.join(site, file)));
  const classes = new Set();

  for (const file of files) {
    const html = fs.readFileSync(path.join(site, file), 'utf8');
    for (const match of html.matchAll(/\bclass="([^"]*)"/g)) {
      for (const className of match[1].split(/\s+/).filter(Boolean)) {
        classes.add(className);
      }
    }
  }

  const missing = [...classes].filter(className => {
    const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return !new RegExp(`\\.${escaped}(?![A-Za-z0-9_-])`).test(css);
  });
  checks.push({
    name: 'CSS classes',
    ok: missing.length === 0,
    reason: missing.length ? `missing rules: ${missing.join(', ')}` : 'class rule missing'
  });

  return checks;
}

export function checkPostOutput(stdout, key) {
  const checks = [];
  const bodies = [];
  const lines = stdout.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    if (lines[i] !== '{') continue;
    let text = lines[i++];
    while (i < lines.length && lines[i] !== '}') text += `\n${lines[i++]}`;
    if (lines[i] === '}') {
      try {
        bodies.push(JSON.parse(`${text}\n}`));
      } catch {}
    }
  }

  checks.push({
    name: 'post bodies',
    ok: bodies.length > 0,
    reason: 'no JSON bodies'
  });

  const valid = bodies.length > 0 && bodies.every(body => {
    const embed = body.embeds?.[0];
    return !body.embeds || (
      embed?.color === 13172480 &&
      typeof embed.author?.name === 'string' &&
      embed.author.name.length > 0 &&
      body.components?.some(row =>
        row.components?.some(button =>
          button.type === 2 && button.label === 'Test request'
        )
      )
    );
  });
  checks.push({
    name: 'post message format',
    ok: valid,
    reason: 'missing Volt stripe, top line, or Test request button'
  });
  checks.push({
    name: 'post summary',
    ok: /post: would post\b/.test(stdout.trim().split(/\r?\n/).at(-1) || ''),
    reason: 'missing dry-run summary'
  });
  if (key) {
    checks.push({
      name: 'secret absent',
      ok: !stdout.includes(key),
      reason: 'key appeared in output'
    });
  }

  return checks;
}

export async function accept({ repo, scratch, gapSeconds, key }, deps = {}) {
  const run = deps.run || ((args, options) => defaultRun(repo, scratch, args, options));
  const sleep = deps.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const checks = [];
  const before = status(repo);
  const env = { ...process.env };
  delete env.DISCORD_BOT_TOKEN;
  delete env.DISCORD_CHANNEL_ID;
  delete env.OPENROUTER_API_KEY;

  const invoke = args => run(args, { env });
  const snapDir = path.join(scratch, 'data', 'snapshots');
  fs.mkdirSync(snapDir, { recursive: true });

  for (let i = 0; i < 2; i++) {
    const result = invoke(['snapshot', '--dir', snapDir]);
    checks.push({
      name: `snapshot ${i + 1}`,
      ok: result.status === 0,
      reason: result.stderr.trim() || 'command failed'
    });
    if (i === 0) await sleep(gapSeconds * 1000);
  }

  const names = fs.readdirSync(snapDir).filter(name => name.endsWith('.json')).sort();
  try {
    const latest = JSON.parse(fs.readFileSync(path.join(snapDir, names.at(-1)), 'utf8'));
    const raised = stagePriceRaise(latest);
    fs.writeFileSync(
      path.join(snapDir, snapshotName(raised.snapshot.takenAt)),
      JSON.stringify(raised.snapshot, null, 1) + '\n'
    );
    checks.push({ name: 'price raise', ok: true, reason: '' });
  } catch (error) {
    checks.push({ name: 'price raise', ok: false, reason: error.message });
  }

  const site = path.join(scratch, 'site');
  const build = invoke(['build', '--snapshots', snapDir, '--site', site]);
  checks.push({
    name: 'build',
    ok: build.status === 0,
    reason: build.stderr.trim() || 'command failed'
  });
  checks.push(...checkSite(site));

  const postEnv = { ...env };
  if (key) postEnv.OPENROUTER_API_KEY = key;
  const post = run(['post', '--dry-run'], { env: postEnv });
  checks.push({
    name: 'post',
    ok: post.status === 0,
    reason: post.stderr.trim() || 'command failed'
  });
  checks.push(...checkPostOutput(`${post.stdout}\n${post.stderr}`, key));

  let after;
  try {
    after = status(repo);
  } catch {
    after = 'status failed';
  }
  checks.push({
    name: 'clean repository',
    ok: before === after,
    reason: 'repository changed'
  });

  return { checks, scratch };
}

export async function main(argv = process.argv.slice(2)) {
  let repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  let scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'pool-accept-'));
  let gapSeconds = 180;

  for (let i = 0; i < argv.length; i++) {
    if (!['--repo', '--scratch', '--gap'].includes(argv[i]) || argv[i + 1] === undefined) {
      console.error('usage: node tools/accept.mjs [--scratch <dir>] [--gap <seconds>] [--repo <dir>]');
      process.exitCode = 2;
      return;
    }
    if (argv[i] === '--repo') repo = path.resolve(argv[++i]);
    else if (argv[i] === '--scratch') scratch = path.resolve(argv[++i]);
    else gapSeconds = Number(argv[++i]);
  }

  const relative = path.relative(repo, scratch);
  if (!Number.isFinite(gapSeconds) || gapSeconds < 0 || (relative && !relative.startsWith(`..${path.sep}`) && relative !== '..')) {
    console.error('usage: node tools/accept.mjs [--scratch <dir>] [--gap <seconds>] [--repo <dir>]');
    process.exitCode = 2;
    return;
  }

  let key;
  try {
    const env = parseEnv(fs.readFileSync(path.join(mainCheckout(), '.env'), 'utf8'));
    key = env.OPENROUTER_API_KEY;
  } catch {}

  const result = await accept({ repo, scratch, gapSeconds, key });
  for (const check of result.checks) {
    console.log(`${check.ok ? 'ok' : 'FAIL'} ${check.name}${check.ok ? '' : `: ${check.reason}`}`);
  }
  console.log(`accept: ${result.checks.filter(check => check.ok).length}/${result.checks.length} checks, scratch ${scratch}`);
  process.exitCode = result.checks.every(check => check.ok) ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
