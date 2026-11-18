import test from 'node:test';
import assert from 'node:assert/strict';
import { renderEvents, renderIndex } from '../src/render.mjs';

// Provider P changes price at ten checks across three models (dynamic from its
// eighth changing check); Q once, at the last check, where P also becomes the
// cheapest input on m/3.
const API = ['openrouter-api', 'openrouter-api'];
const checks = [
  '2026-11-17T00:15:00Z', '2026-11-17T00:30:00Z', '2026-11-17T00:45:00Z',
  '2026-11-17T01:00:00Z', '2026-11-17T01:15:00Z', '2026-11-17T01:30:00Z',
  '2026-11-17T01:45:00Z', '2026-11-17T02:00:00Z', '2026-11-17T02:15:00Z',
  '2026-11-17T02:30:00Z',
];

const priceMove = (model, at, provider, tag, from, to) => ({
  type: 'price-changed',
  model,
  at,
  since: new Date(Date.parse(at) - 900_000).toISOString().replace('.000Z', 'Z'),
  sources: API,
  tag,
  provider,
  prompt: { from, to, change: to / from - 1 },
  completion: null,
  change: to / from - 1,
  direction: to > from ? 'up' : 'down',
  up: to > from,
  major: false,
  standing: { poolSize: 2, input: null, output: null },
});

const pMove = (model, at, i) => priceMove(model, at, 'P', 'p/fp8', i % 2 ? 0.11 : 0.1, i % 2 ? 0.1 : 0.11);

function history(upTo = checks.length) {
  const events = checks.slice(0, upTo).map((at, i) => [
    pMove('m/1', at, i),
    pMove('m/2', at, i),
    ...(i === 9 ? [priceMove('m/2', at, 'Q', 'q', 0.2, 0.3)] : []),
    pMove('m/3', at, i),
    ...(i === 9 ? [{
      type: 'cheapest-changed',
      model: 'm/3',
      at,
      since: '2026-11-17T02:15:00Z',
      sources: API,
      input: { from: ['q'], to: ['p/fp8'], fromProviders: ['Q'], toProviders: ['P'], toPrice: 0.1, fromNow: 0.105, fromLeft: false },
      output: null,
    }] : []),
  ]).reverse().flat();
  const model = id => ({
    slug: id,
    name: id,
    series: [],
    events: events.filter(e => e.model === id),
    latest: { takenAt: checks[upTo - 1], source: 'openrouter-api', listed: { prompt: 0.1, completion: 1 }, endpoints: [] },
    everMulti: true,
    firstSeen: { takenAt: '2026-11-17T00:00:00Z', source: 'openrouter-api' },
    lastChange: checks[upTo - 1],
    outputModalities: ['text'],
    inputModalities: ['text'],
    inLatestFull: true,
    latestFull: { takenAt: checks[upTo - 1], source: 'openrouter-api' },
  });
  return {
    takenAt: checks[upTo - 1],
    latestFull: { takenAt: checks[upTo - 1], source: 'openrouter-api' },
    snapshots: [{ takenAt: checks[upTo - 1], source: 'openrouter-api', partial: false, modelCount: 3 }],
    models: { 'm/1': model('m/1'), 'm/2': model('m/2'), 'm/3': model('m/3') },
    events,
  };
}

const row = (model, time, pill, what) =>
  `<li class="event price-changed"><time datetime="2026-11-17T${time}:00Z" data-local="time" title="Nov 17, ${time} UTC">${time} UTC</time> ${pill}<span class="event-body"> <a class="model ext" href="https://openrouter.ai/${model}" target="_blank" rel="noopener noreferrer">${model}<span class="sr-only"> (opens OpenRouter in a new tab)</span></a> <span class="what">${what}</span></span></li>`;
const rise = '<span class="pill pill-warning">price increase</span>';
const fall = '<span class="pill pill-positive">price decrease</span>';
const pUp = 'P (p/fp8) · input $0.10 to $0.11 per M (+10%)';
const pDown = 'P (p/fp8) · input $0.11 to $0.10 per M (-9%)';

const summary = '<li class="fold"><details><summary class="event"><time datetime="2026-11-17T02:30:00Z" data-local="time" title="Nov 17, 02:30 UTC">02:30 UTC</time> <span class="pill pill-neutral">frequent repricing</span><span class="event-body"> <span class="what">P changed prices 8 times across 3 models</span></span></summary>';

const folded = [
  row('m/1', '02:30', fall, pDown),
  row('m/2', '02:30', fall, pDown),
  row('m/1', '02:15', rise, pUp),
  row('m/2', '02:15', rise, pUp),
  row('m/3', '02:15', rise, pUp),
  row('m/1', '02:00', fall, pDown),
  row('m/2', '02:00', fall, pDown),
  row('m/3', '02:00', fall, pDown),
];

// Rows outside a fold, in order: each row's model and time, or "fold".
const listed = html => html
  .replace(/<details>[\s\S]*?<\/details>/g, '')
  .match(/<li class="(?:fold|event[^"]*)">(?:<time datetime="[^"]*T(\d\d:\d\d)[^>]*>[^<]*<\/time>[^]*?openrouter\.ai\/(m\/\d))?/g)
  .map(li => li.startsWith('<li class="fold"') ? 'fold' : li.replace(/[^]*T(\d\d:\d\d)[^]*openrouter\.ai\/(m\/\d)$/, '$2 $1'));

test('all changes folds P\'s routine moves of the day into one frequent repricing row at the newest of them', () => {
  const html = renderEvents(history());

  assert.ok(html.includes('<p class="subtitle">32 events across 3 models, newest first;'));
  assert.equal(html.split('frequent repricing').length, 2);
  assert.ok(html.includes(`${summary}\n<ul class="events">\n${folded.join('\n')}\n</ul></details></li>`));

  assert.deepEqual(listed(html), [
    'fold', 'm/2 02:30', 'm/3 02:30', 'm/3 02:30',
    'm/1 01:45', 'm/2 01:45', 'm/3 01:45',
    'm/1 01:30', 'm/2 01:30', 'm/3 01:30',
    'm/1 01:15', 'm/2 01:15', 'm/3 01:15',
    'm/1 01:00', 'm/2 01:00', 'm/3 01:00',
    'm/1 00:45', 'm/2 00:45', 'm/3 00:45',
    'm/1 00:30', 'm/2 00:30', 'm/3 00:30',
    'm/1 00:15', 'm/2 00:15', 'm/3 00:15',
  ]);

  // Q's move, P's move that made it the cheapest, and the cheapest change stay rows.
  const qRise = row('m/2', '02:30', '<span class="pill pill-negative">price increase · 25%+</span>', 'Q · input $0.20 to $0.30 per M (+50%)');
  assert.ok(html.includes(`</details></li>\n${qRise}\n${row('m/3', '02:30', fall, pDown)}\n<li class="event cheapest-changed">`));
  assert.ok(html.includes(`\n${row('m/1', '01:45', rise, pUp)}\n`));
});

test('the rows inside a fold are byte for byte the rows the page lists without folding', () => {
  // Unfolded, P's rows before its eighth check; and the 02:15 and 02:00 rows, which
  // follow one another in the same order whether folded or not.
  assert.ok(renderEvents(history(7)).includes(`\n${row('m/1', '01:45', rise, pUp)}\n${row('m/2', '01:45', rise, pUp)}\n`));
  assert.ok(renderEvents(history()).includes(`\n${folded.slice(2).join('\n')}\n`));
});

test('before P\'s eighth changing check nothing is folded', () => {
  for (const html of [renderEvents(history(7)), renderIndex(history(7))]) {
    assert.equal(html.includes('frequent repricing'), false);
    assert.equal(html.includes('<details>'), false);
  }
  assert.equal(listed(renderEvents(history(7))).length, 21);
  assert.equal(listed(renderEvents(history(8))).length, 22);
  assert.ok(renderEvents(history(8)).includes('P changed prices 3 times across 3 models'));
});

test('the front page\'s 20-row cut counts a fold as one row and "See all" counts every change', () => {
  const html = renderIndex(history());
  assert.deepEqual(listed(html), [
    'fold', 'm/2 02:30', 'm/3 02:30', 'm/3 02:30',
    'm/1 01:45', 'm/2 01:45', 'm/3 01:45',
    'm/1 01:30', 'm/2 01:30', 'm/3 01:30',
    'm/1 01:15', 'm/2 01:15', 'm/3 01:15',
    'm/1 01:00', 'm/2 01:00', 'm/3 01:00',
    'm/1 00:45', 'm/2 00:45', 'm/3 00:45',
    'm/1 00:30',
  ]);
  assert.ok(html.includes(`${summary}\n<ul class="events">\n${folded.join('\n')}\n</ul></details></li>`));
  assert.ok(html.includes('<p class="more"><a class="arrow-link" href="events.html">See all 32 changes this week <span aria-hidden="true">→</span></a></p>'));
});
