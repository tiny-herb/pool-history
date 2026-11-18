import test from 'node:test';
import assert from 'node:assert/strict';
import * as render from '../src/render.mjs';
import { renderFeed, renderJsonFeed, renderFeedPage } from '../src/feed.mjs';
import { HistoryBuilder } from '../src/history.mjs';

// The site lists a confirmed departure at the time it was confirmed (when the
// Discord card is posted), with the time it was first missed kept in the row.
// An unconfirmed departure stays at the time it was first missed. The feeds keep
// the item at the time it was first missed.

const endpoint = (tag, provider, prompt, completion) => ({
  tag,
  provider,
  prompt,
  completion,
  discount: 0,
  context: null,
  quantization: null,
  status: null,
  uptime30m: null,
  uptime1d: null,
  uptimePage: null,
  latency30m: null,
  throughput30m: null,
});

const xiaomi = endpoint('xiaomi/fp8', 'Xiaomi', 0.1, 0.3);
const chutes = endpoint('chutes/fp8', 'Chutes', 0.12, 0.35);
const tenstorrent = endpoint('tenstorrent/fp8', 'Tenstorrent', 0.2, 0.6);

const OTHERS = [
  'other/m01', 'other/m02', 'other/m03', 'other/m04', 'other/m05', 'other/m06',
  'other/m07', 'other/m08', 'other/m09', 'other/m10', 'other/m11', 'other/m12',
  'other/m13', 'other/m14', 'other/m15', 'other/m16', 'other/m17', 'other/m18',
  'other/m19', 'other/m20', 'other/m21', 'other/m22', 'other/m23', 'other/m24',
];

// Tenstorrent is missed at 21:36, still missing at 21:51 and confirmed gone at
// 22:06. At 21:51 24 other models change price (48 rows); at 22:21 Xiaomi's
// price falls. `until` stops the history early.
function built(until = '2026-11-17T22:21:00Z', others = OTHERS) {
  const builder = new HistoryBuilder();
  const observe = (takenAt, pool, otherPrice) => {
    if (takenAt > until) return;
    const models = {
      'xiaomi/mimo-v2.6-flash': { name: 'Xiaomi: MiMo V2.6 Flash', listed: null, endpoints: pool },
    };
    for (const id of others) {
      models[id] = {
        name: id,
        listed: null,
        endpoints: [endpoint('a/x', 'A', otherPrice, 2), endpoint('b/y', 'B', 3, 4)],
      };
    }
    builder.add({
      takenAt,
      source: 'openrouter-api',
      partial: false,
      note: null,
      modelCount: 1 + others.length,
      models,
    });
  };
  observe('2026-11-17T21:21:00Z', [xiaomi, chutes, tenstorrent], 1);
  observe('2026-11-17T21:36:00Z', [xiaomi, chutes], 1);
  observe('2026-11-17T21:51:00Z', [xiaomi, chutes], 1.1);
  observe('2026-11-17T22:06:00Z', [xiaomi, chutes], 1.1);
  observe('2026-11-17T22:21:00Z', [{ ...xiaomi, prompt: 0.09 }, chutes], 1.1);
  return builder.finish();
}

const rows = html => [...html.matchAll(/<li class="event[^"]*">.*?<\/li>/g)].map(m => m[0]);

const LEFT_ROW = '<li class="event left"><time datetime="2026-11-17T22:06:00Z" data-local="time" title="Nov 17, 22:06 UTC">22:06 UTC</time> <span class="pill pill-neutral">left</span><span class="event-body"> <a class="model ext" href="https://openrouter.ai/xiaomi/mimo-v2.6-flash" target="_blank" rel="noopener noreferrer">xiaomi/mimo-v2.6-flash<span class="sr-only"> (opens OpenRouter in a new tab)</span></a> <span class="what">Tenstorrent (tenstorrent/fp8) left</span> <span class="window">· first missed <time datetime="2026-11-17T21:36:00Z" data-local="time" title="Nov 17, 21:36 UTC">21:36 UTC</time></span></span></li>';
const ROW_BEFORE = '<li class="event price-changed"><time datetime="2026-11-17T22:21:00Z" data-local="time" title="Nov 17, 22:21 UTC">22:21 UTC</time> <span class="pill pill-positive">price decrease</span><span class="event-body"> <a class="model ext" href="https://openrouter.ai/xiaomi/mimo-v2.6-flash" target="_blank" rel="noopener noreferrer">xiaomi/mimo-v2.6-flash<span class="sr-only"> (opens OpenRouter in a new tab)</span></a> <span class="what">Xiaomi (xiaomi/fp8) · input $0.10 to $0.09 per M (-10%) · cheapest on input and output</span></span></li>';
const ROW_AFTER = '<li class="event price-changed"><time datetime="2026-11-17T21:51:00Z" data-local="time" title="Nov 17, 21:51 UTC">21:51 UTC</time> <span class="pill pill-warning">price increase</span><span class="event-body"> <a class="model ext" href="https://openrouter.ai/other/m01" target="_blank" rel="noopener noreferrer">other/m01<span class="sr-only"> (opens OpenRouter in a new tab)</span></a> <span class="what">A (a/x) · input $1.00 to $1.10 per M (+10%) · cheapest on input and output</span></span></li>';

test('events.html lists a confirmed departure at its confirmation time, first-missed time in the row', () => {
  const list = rows(render.renderEvents(built()));
  assert.equal(list.length, 50);
  assert.equal(list[0], ROW_BEFORE);
  assert.equal(list[1], LEFT_ROW);
  assert.equal(list[2], ROW_AFTER);
  assert.equal(list.filter(row => row.includes('tenstorrent')).length, 1);
});

test('index.html shows a confirmed departure within its first rows', () => {
  const html = render.renderIndex(built());
  const list = rows(html);
  assert.equal(list.length, 20);
  assert.equal(list[1], LEFT_ROW);
  assert.ok(html.includes('See all 50 changes this week'));
});

test('a confirmed departure confirmed on the next UTC day files under that day and dates its first miss', () => {
  const builder = new HistoryBuilder();
  const observe = (takenAt, pool) => builder.add({
    takenAt,
    source: 'openrouter-api',
    partial: false,
    note: null,
    modelCount: 1,
    models: { 'xiaomi/mimo-v2.6-flash': { name: 'Xiaomi: MiMo V2.6 Flash', listed: null, endpoints: pool } },
  });
  observe('2026-11-17T23:35:00Z', [xiaomi, chutes, tenstorrent]);
  observe('2026-11-17T23:50:00Z', [xiaomi, chutes]);
  observe('2026-11-18T00:05:00Z', [xiaomi, chutes]);
  observe('2026-11-18T00:20:00Z', [xiaomi, chutes]);
  const html = render.renderEvents(builder.finish());
  assert.ok(html.includes('<h3 class="day"><time datetime="2026-11-18T00:20:00Z" data-local="day" title="Nov 18, 00:20 UTC">Wed, Nov 18</time></h3>'));
  assert.ok(!html.includes('Tue, Nov 17'));
  assert.ok(html.includes('<span class="what">Tenstorrent (tenstorrent/fp8) left</span> <span class="window">· first missed <time datetime="2026-11-17T23:50:00Z" data-local="datetime" title="Nov 17, 23:50 UTC">Nov 17, 23:50 UTC</time></span>'));
});

test('an unconfirmed departure stays at the time it was first missed', () => {
  const list = rows(render.renderEvents(built('2026-11-17T21:51:00Z')));
  assert.equal(list.length, 49);
  assert.equal(
    list[48],
    '<li class="event left"><time datetime="2026-11-17T21:36:00Z" data-local="time" title="Nov 17, 21:36 UTC">21:36 UTC</time> <span class="pill pill-neutral">not listed · unconfirmed</span><span class="event-body"> <a class="model ext" href="https://openrouter.ai/xiaomi/mimo-v2.6-flash" target="_blank" rel="noopener noreferrer">xiaomi/mimo-v2.6-flash<span class="sr-only"> (opens OpenRouter in a new tab)</span></a> <span class="what">Tenstorrent (tenstorrent/fp8) missing at the last check; may come back</span></span></li>',
  );
});

test('the feeds keep a confirmed departure at the time it was first missed', () => {
  const h = built('2026-11-17T22:06:00Z', []);

  const xml = renderFeed(h, {});
  for (const line of [
    '<title><![CDATA[Provider removed: Tenstorrent on MiMo V2.6 Flash (xiaomi/mimo-v2.6-flash)]]></title>',
    '<guid isPermaLink="false">xiaomi/mimo-v2.6-flash-2026-11-17T21:36:00Z</guid>',
    '<pubDate>Tue, 17 Nov 2026 21:36:00 GMT</pubDate>',
  ]) {
    assert.ok(xml.includes(line), line);
  }
  assert.equal(xml.split('<item>').length, 2);
  assert.ok(!xml.includes('<pubDate>Tue, 17 Nov 2026 22:06:00 GMT</pubDate>'));

  const [item] = JSON.parse(renderJsonFeed(h, {})).items;
  assert.equal(item.id, 'xiaomi/mimo-v2.6-flash-2026-11-17T21:36:00Z');
  assert.equal(item.title, 'Provider removed: Tenstorrent on MiMo V2.6 Flash (xiaomi/mimo-v2.6-flash)');
  assert.equal(item.date_published, '2026-11-17T21:36:00Z');
  assert.deepEqual(item._pool_history.events, [{
    type: 'left',
    tag: 'tenstorrent/fp8',
    provider: 'Tenstorrent',
    confirmed: true,
    sentence: 'Tenstorrent (tenstorrent/fp8) left',
  }]);

  const page = renderFeedPage(h);
  assert.ok(page.includes('<header class="feed-head"><h2 class="feed-title">Provider removed: Tenstorrent on MiMo V2.6 Flash (xiaomi/mimo-v2.6-flash)</h2><time datetime="2026-11-17T21:36:00Z" data-local="datetime" title="Nov 17, 21:36 UTC">Nov 17, 21:36 UTC</time></header>'));
  assert.ok(!page.includes('first missed'));
  assert.ok(!page.includes('title="Nov 17, 22:06 UTC">Nov 17, 22:06 UTC</time></header>'));
});
