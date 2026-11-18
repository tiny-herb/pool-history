import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HistoryBuilder } from '../src/history.mjs';
import { renderIndex, renderEvents } from '../src/render.mjs';
import { renderFeedPage } from '../src/feed.mjs';
import { checkSite } from '../tools/accept.mjs';

const cssPath = fileURLToPath(new URL('../src/assets/style.css', import.meta.url));

const endpoint = (tag, provider, prompt, completion) => ({
  tag, provider, prompt, completion, discount: 0,
  context: 131072, quantization: 'fp8', status: 0, uptime30m: 100, uptime1d: 100,
  uptimePage: null, latency30m: null, throughput30m: null,
});

const snapshot = (takenAt, source, partial, endpoints) => ({
  takenAt, source, partial, note: null, modelCount: 1,
  models: { 'a/b': { name: 'A: B', listed: { prompt: 1, completion: 2 }, endpoints } },
});

// An archived seed, then two API snapshots: a price rise of 50%, a newcomer
// at 12x the cheapest and a departure, so the pages carry pills, window notes
// and the footer's archive label.
const snapshots = [
  snapshot('2026-11-14T11:07:00Z', 'archived-model-page', true, [
    endpoint('x', 'X', 1, 2),
    endpoint('y', 'Y', 1.2, 2.4),
  ]),
  snapshot('2026-11-17T11:07:00Z', 'openrouter-api', false, [
    endpoint('x', 'X', 1.5, 3),
    endpoint('y', 'Y', 1.2, 2.4),
  ]),
  snapshot('2026-11-17T12:07:00Z', 'openrouter-api', false, [
    endpoint('x', 'X', 1.5, 3),
    endpoint('z', 'Z', 14.4, 28.8),
  ]),
];

test('every class index.html, events.html and feed.html use has a rule in style.css', async () => {
  const builder = new HistoryBuilder({ checks: [] });
  for (const s of snapshots) builder.add(s);
  const history = builder.finish();

  const site = await mkdtemp(join(tmpdir(), 'pool-history-style-'));
  await copyFile(cssPath, join(site, 'style.css'));
  const events = renderEvents(history);
  const feed = renderFeedPage(history);
  assert.match(events, /<li class="event [^"]*major/);
  assert.match(events, /<span class="window">/);
  assert.match(feed, /class="feed-item/);
  await writeFile(join(site, 'index.html'), renderIndex(history));
  await writeFile(join(site, 'events.html'), events);
  await writeFile(join(site, 'feed.html'), feed);

  const check = checkSite(site).find(c => c.name === 'CSS classes');
  assert.equal(check.ok, true, check.reason);
});

// Eleven checks 15 minutes apart: provider P reprices a/b and c/d at every check
// after the first, so its moves from the eighth changing check on are folded.
const repricing = ['00:00', '00:15', '00:30', '00:45', '01:00', '01:15', '01:30', '01:45', '02:00', '02:15', '02:30']
  .map((time, s) => {
    const pool = { listed: { prompt: 1, completion: 2 }, endpoints: [endpoint('p', 'P', s % 2 ? 0.11 : 0.1, 1), endpoint('q', 'Q', 0.2, 1)] };
    return {
      takenAt: `2026-11-17T${time}:00Z`, source: 'openrouter-api', partial: false, note: null, modelCount: 2,
      models: { 'a/b': { name: 'A: B', ...pool }, 'c/d': { name: 'C: D', ...pool } },
    };
  });

test('the frequent repricing fold on the two event lists uses only classes style.css styles', async () => {
  const builder = new HistoryBuilder({ checks: [] });
  for (const s of repricing) builder.add(s);
  const history = builder.finish();

  const site = await mkdtemp(join(tmpdir(), 'pool-history-style-fold-'));
  await copyFile(cssPath, join(site, 'style.css'));
  const events = renderEvents(history);
  const index = renderIndex(history);
  for (const html of [events, index]) {
    assert.match(html, /<li class="fold"><details><summary class="event">/);
    assert.match(html, /<span class="pill pill-neutral">frequent repricing<\/span>/);
  }
  await writeFile(join(site, 'index.html'), index);
  await writeFile(join(site, 'events.html'), events);
  await writeFile(join(site, 'feed.html'), renderFeedPage(history));

  const check = checkSite(site).find(c => c.name === 'CSS classes');
  assert.equal(check.ok, true, check.reason);
});
