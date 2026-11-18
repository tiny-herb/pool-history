import test from 'node:test';
import assert from 'node:assert/strict';
import * as render from '../src/render.mjs';
import { HistoryBuilder } from '../src/history.mjs';

const endpoint = (tag, provider, prompt = 1, completion = 2) => ({
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

const baseEvent = {
  model: 'deepseek/deepseek-v4.1-flash-1017',
  at: '2026-11-17T16:37:00Z',
  since: '2026-11-17T16:22:00Z',
  sources: ['openrouter-api', 'openrouter-api'],
};

const history = (events = []) => ({
  takenAt: '2026-11-17T16:37:00Z',
  latestFull: {
    takenAt: '2026-11-17T16:37:00Z',
    source: 'openrouter-api',
  },
  snapshots: [
    {
      takenAt: '2026-11-17T16:22:00Z',
      source: 'openrouter-api',
      partial: false,
      modelCount: 1,
    },
    {
      takenAt: '2026-11-17T16:37:00Z',
      source: 'openrouter-api',
      partial: false,
      modelCount: 1,
    },
  ],
  models: {
    'deepseek/deepseek-v4.1-flash-1017': {
      slug: 'deepseek/deepseek-v4.1-flash-1017',
      name: 'DeepSeek: DeepSeek V4.1 Flash 1017',
      series: [],
      events,
      latest: {
        takenAt: '2026-11-17T16:37:00Z',
        source: 'openrouter-api',
        listed: { prompt: 0.036, completion: 0.5 },
        endpoints: [
          endpoint('wafer/us', 'Wafer', 0.036, 0.5),
          endpoint('sail-research/fp4', 'Sail Research', 0.04, 0.07),
        ],
      },
      everMulti: true,
      firstSeen: {
        takenAt: '2026-11-17T16:22:00Z',
        source: 'openrouter-api',
      },
      lastChange: '2026-11-17T16:37:00Z',
      outputModalities: ['text'],
      inputModalities: ['text'],
      inLatestFull: true,
      latestFull: {
        takenAt: '2026-11-17T16:37:00Z',
        source: 'openrouter-api',
      },
    },
  },
  events,
});

test('exports the expected public surface', () => {
  assert.equal(
    render.ROUTING_DOCS,
    'https://openrouter.ai/docs/guides/routing/provider-selection',
  );
  assert.equal(
    render.ARCHIVE_LABEL,
    'Wayback Machine copy of the model page, transcribed by hand',
  );
  assert.equal(
    render.ARCHIVE_BOTH,
    'both from Wayback Machine copies of the model page, transcribed by hand',
  );

  for (const name of [
    'docLink',
    'escapeHtml',
    'eventPill',
    'termLink',
    'eventRow',
    'page',
    'renderIndex',
    'renderEvents',
  ]) {
    assert.equal(typeof render[name], 'function', `${name} is exported`);
  }
});

test('escapeHtml escapes every character that is unsafe in site HTML', () => {
  assert.equal(render.escapeHtml(null), 'null');
  assert.equal(render.escapeHtml(undefined), 'undefined');
  assert.equal(
    render.escapeHtml(`A & B < C > D "quote" 'apostrophe'`),
    'A &amp; B &lt; C &gt; D &quot;quote&quot; &#39;apostrophe&#39;',
  );
  assert.equal(
    render.escapeHtml('<img src=x onerror="bad()">'),
    '&lt;img src=x onerror=&quot;bad()&quot;&gt;',
  );
});

test('docLink makes quiet external OpenRouter links with trusted inner markup', () => {
  assert.equal(
    render.docLink(
      'https://openrouter.ai/docs/guides/routing/provider-selection',
      '<code>max_price</code>',
    ),
    '<a class="ext" href="https://openrouter.ai/docs/guides/routing/provider-selection" target="_blank" rel="noopener noreferrer"><code>max_price</code><span class="sr-only"> (opens OpenRouter in a new tab)</span></a>',
  );
});

test('eventPill uses words as well as tones for every event direction', () => {
  assert.equal(
    render.eventPill({ type: 'joined', replaces: 'old/tag' }),
    '<span class="pill pill-neutral">endpoint changed</span>',
  );
  assert.equal(
    render.eventPill({
      type: 'joined',
      expensive: true,
      standing: {
        input: { vs: 9.8 },
        output: { vs: 12.4 },
      },
    }),
    '<span class="pill pill-warning">joined · 12x</span>',
  );
  assert.equal(
    render.eventPill({ type: 'joined', expensive: true }),
    '<span class="pill pill-warning">joined</span>',
  );
  assert.equal(
    render.eventPill({ type: 'joined', expensive: false }),
    '<span class="pill pill-neutral">joined</span>',
  );

  assert.equal(
    render.eventPill({ type: 'left', replacedBy: 'new/tag' }),
    '<span class="pill pill-neutral">endpoint changed</span>',
  );
  assert.equal(
    render.eventPill({ type: 'left', returned: true }),
    '<span class="pill pill-neutral">briefly unlisted</span>',
  );
  assert.equal(
    render.eventPill({ type: 'left', confirmed: false }),
    '<span class="pill pill-neutral">not listed · unconfirmed</span>',
  );
  assert.equal(
    render.eventPill({ type: 'left', providerStays: true, confirmed: true }),
    '<span class="pill pill-neutral">endpoint removed</span>',
  );
  assert.equal(
    render.eventPill({ type: 'left', confirmed: true }),
    '<span class="pill pill-neutral">left</span>',
  );

  assert.equal(
    render.eventPill({
      type: 'price-changed',
      direction: 'up',
      prompt: { from: 1, to: 1.25, change: 0.25 },
      completion: null,
    }),
    '<span class="pill pill-negative">price increase · 25%+</span>',
  );
  assert.equal(
    render.eventPill({
      type: 'price-changed',
      direction: 'up',
      prompt: { from: 1, to: 1.1, change: 0.1 },
      completion: null,
    }),
    '<span class="pill pill-warning">price increase</span>',
  );
  assert.equal(
    render.eventPill({
      type: 'price-changed',
      direction: 'down',
      prompt: { from: 1, to: 0.9, change: -0.1 },
      completion: null,
    }),
    '<span class="pill pill-positive">price decrease</span>',
  );
  assert.equal(
    render.eventPill({ type: 'price-changed', direction: 'mixed' }),
    '<span class="pill pill-warning">price change</span>',
  );

  assert.equal(
    render.eventPill({ type: 'cheapest-changed' }),
    '<span class="pill pill-neutral">cheapest</span>',
  );
  assert.equal(
    render.eventPill({
      type: 'spread-crossed',
      up: true,
      cause: 'priciest-rose',
      input: { up: true },
    }),
    '<span class="pill pill-negative">price range widened</span>',
  );
  assert.equal(
    render.eventPill({
      type: 'spread-crossed',
      up: true,
      cause: 'cheapest-fell',
      input: { up: true },
    }),
    '<span class="pill pill-neutral">price range widened</span>',
  );
  assert.equal(
    render.eventPill({
      type: 'spread-crossed',
      up: false,
      cause: 'pool-changed',
      input: { up: false },
    }),
    '<span class="pill pill-positive">price range narrowed</span>',
  );
  assert.equal(
    render.eventPill({
      type: 'spread-crossed',
      up: true,
      cause: 'pool-changed',
      input: { up: true },
      output: { up: false },
    }),
    '<span class="pill pill-negative">price range changed</span>',
  );
  assert.equal(
    render.eventPill({ type: 'quantization-changed' }),
    '<span class="pill pill-neutral">quantization</span>',
  );
  assert.equal(
    render.eventPill({ type: 'pool-empty' }),
    '<span class="pill pill-negative">empty</span>',
  );
  assert.equal(
    render.eventPill({ type: 'model-listed' }),
    '<span class="pill pill-info">listed</span>',
  );
  assert.equal(
    render.eventPill({ type: 'model-delisted' }),
    '<span class="pill pill-warning">delisted</span>',
  );
});

test('termLink adds the expected term links only where they apply', () => {
  assert.equal(
    render.termLink({ type: 'quantization-changed', tag: 'deepinfra/fp8' }),
    ' (<a class="ext" href="https://openrouter.ai/docs/guides/routing/provider-selection#quantization" target="_blank" rel="noopener noreferrer">what quantization means<span class="sr-only"> (opens OpenRouter in a new tab)</span></a>)',
  );
  assert.equal(
    render.termLink({ type: 'price-changed', tag: 'openai/flex' }),
    ' (<a class="ext" href="https://openrouter.ai/docs/guides/features/service-tiers" target="_blank" rel="noopener noreferrer">what the flex tier is<span class="sr-only"> (opens OpenRouter in a new tab)</span></a>)',
  );
  assert.equal(
    render.termLink({ type: 'joined', tag: 'openai/priority' }),
    ' (<a class="ext" href="https://openrouter.ai/docs/guides/features/service-tiers" target="_blank" rel="noopener noreferrer">what the priority tier is<span class="sr-only"> (opens OpenRouter in a new tab)</span></a>)',
  );
  assert.equal(
    render.termLink({ type: 'left', tag: 'openai/ultrafast' }),
    ' (<a class="ext" href="https://openrouter.ai/docs/guides/features/service-tiers" target="_blank" rel="noopener noreferrer">what the ultrafast tier is<span class="sr-only"> (opens OpenRouter in a new tab)</span></a>)',
  );
  assert.equal(render.termLink({ type: 'joined', tag: 'openai/fp8' }), '');
});

test('eventRow renders escaped sentences, model links, times and a long-window note', () => {
  const row = render.eventRow({
    ...baseEvent,
    type: 'price-changed',
    tag: 'wafer/mxfp4',
    provider: 'Wafer',
    prompt: { from: 0.07, to: 0.066, change: -0.05714285714285716 },
    completion: null,
    direction: 'down',
    up: false,
    major: false,
    standing: {
      poolSize: 4,
      input: {
        cheapest: false,
        vs: 1.8333333333333335,
        tags: ['wafer/us'],
        providers: ['Wafer'],
      },
      output: {
        cheapest: false,
        vs: 7.142857142857143,
        tags: ['sail-research/fp4', 'sail-research/fp4/us'],
        providers: ['Sail Research', 'Sail Research'],
      },
    },
  });

  assert.equal(
    row,
    '<li class="event price-changed"><time datetime="2026-11-17T16:37:00Z" data-local="time" title="Nov 17, 16:37 UTC">16:37 UTC</time> <span class="pill pill-positive">price decrease</span><span class="event-body"> <a class="model ext" href="https://openrouter.ai/deepseek/deepseek-v4.1-flash-1017" target="_blank" rel="noopener noreferrer">deepseek/deepseek-v4.1-flash-1017<span class="sr-only"> (opens OpenRouter in a new tab)</span></a> <span class="what">Wafer (wafer/mxfp4) · input $0.07 to $0.066 per M (-6%) · input 1.8x the cheapest (Wafer), output 7.1x the cheapest (2 Sail Research endpoints)</span></span></li>',
  );

  const archived = render.eventRow({
    ...baseEvent,
    type: 'model-delisted',
    model: `z/o'hare`,
    at: '2026-11-17T11:07:00Z',
    since: '2026-11-14T10:07:00Z',
    sources: ['archived-model-page', 'openrouter-api'],
  });

  assert.match(archived, /No longer in OpenRouter&#39;s model list/);
  assert.match(
    archived,
    /between Nov 14 and Nov 17; Nov 14 is from a Wayback Machine copy of the model page, transcribed by hand/,
  );
  assert.match(archived, /href="https:\/\/openrouter\.ai\/z\/o&#39;hare"/);
});

test('page produces the shared shell, navigation, assets, theme controls and footer', () => {
  const html = render.page({
    title: 'OpenRouter pool history',
    prefix: '',
    description: 'A "quoted" description',
    current: 'events',
    body: '<p>trusted body</p>',
  });

  assert.match(html, /^<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">/);
  assert.match(
    html,
    /<meta name="color-scheme" content="dark light">/,
  );
  assert.match(
    html,
    /<script>try\{var t=localStorage\.getItem\('ph\.theme'\);if\(t==='light'\|\|t==='dark'\)document\.documentElement\.setAttribute\('data-theme',t\)\}catch\(e\)\{\}<\/script>/,
  );
  assert.match(html, /<title>OpenRouter pool history<\/title>/);
  assert.match(
    html,
    /<meta name="description" content="A &quot;quoted&quot; description">/,
  );
  assert.match(
    html,
    /<link rel="alternate" type="application\/rss\+xml" title="Pool changes" href="feed\.xml">/,
  );
  assert.match(html, /<link rel="stylesheet" href="style\.css">/);
  assert.match(html, /<script src="theme\.js" defer><\/script>/);
  assert.match(html, /<script src="localtime\.js" type="module"><\/script>/);
  assert.match(
    html,
    /<a class="btn btn-ghost active" href="events\.html" aria-current="page">All changes<\/a>/,
  );
  assert.match(html, /<a class="btn btn-ghost" href="feed\.html">Feed<\/a>/);
  assert.match(html, /<a class="btn btn-ghost" href="data\/index\.json">JSON<\/a>/);
  assert.match(
    html,
    /<div class="theme-switch theme-nav" role="group" aria-label="Colour theme">/,
  );
  assert.match(html, /data-theme-choice="light"/);
  assert.match(html, /data-theme-choice="dark"/);
  assert.match(html, /data-theme-choice="system" aria-pressed="true"/);
  assert.match(html, /<main id="content">\n<p>trusted body<\/p>\n<\/main>/);
  assert.match(
    html,
    /Built from the public OpenRouter API \(no key, no test requests\), reading every model's endpoints listing every 15 minutes/,
  );
  assert.match(
    html,
    /<span class="archive">Wayback Machine copy<\/span> marks points transcribed by hand from Wayback Machine copies of the model page\./,
  );
  assert.match(
    html,
    /<p class="faint">An independent record; not affiliated with OpenRouter\.<\/p>/,
  );
  assert.match(
    html,
    /<div class="theme-switch theme-footer" role="group" aria-label="Colour theme">/,
  );
  assert.match(html, /<\/body>\n<\/html>\n?$/);

  const nested = render.page({
    title: 'Nested',
    prefix: '../',
    description: 'Nested description',
    current: 'feed',
    body: '',
  });
  assert.match(nested, /href="\.\.\/style\.css"/);
  assert.match(nested, /src="\.\.\/theme\.js"/);
  assert.match(nested, /src="\.\.\/localtime\.js"/);
  assert.match(
    nested,
    /<a class="btn btn-ghost active" href="\.\.\/feed\.html" aria-current="page">Feed<\/a>/,
  );
});

test('renderEvents renders the expected all-changes heading and grouped event list', () => {
  const event = {
    ...baseEvent,
    type: 'price-changed',
    tag: 'wafer/mxfp4',
    provider: 'Wafer',
    prompt: { from: 0.07, to: 0.066, change: -0.05714285714285716 },
    completion: null,
    direction: 'down',
    up: false,
    major: false,
    standing: {
      poolSize: 4,
      input: {
        cheapest: false,
        vs: 1.8333333333333335,
        tags: ['wafer/us'],
        providers: ['Wafer'],
      },
      output: {
        cheapest: false,
        vs: 7.142857142857143,
        tags: ['sail-research/fp4', 'sail-research/fp4/us'],
        providers: ['Sail Research', 'Sail Research'],
      },
    },
  };

  const html = render.renderEvents(history([event]));

  assert.match(html, /<title>All changes · OpenRouter pool history<\/title>/);
  assert.match(
    html,
    /<meta name="description" content="Every recorded provider change on OpenRouter models: joins with their price against the cheapest, departures and price moves\.">/,
  );
  assert.match(html, /<h1 class="page-title">All changes<\/h1>/);
  assert.match(
    html,
    /<p class="subtitle">1 events across 1 models, newest first; last snapshot <time datetime="2026-11-17T16:37:00Z" data-local="datetime" title="Nov 17, 16:37 UTC">Nov 17, 16:37 UTC<\/time>\.<\/p>/,
  );
  assert.match(
    html,
    /<a class="arrow-link" href="feed\.xml" type="application\/rss\+xml">RSS feed of these changes <span aria-hidden="true">→<\/span><\/a> One item per model per snapshot, in the same shape as OpenRouter's new-models feed, so an RSS bot can post it to Discord\./,
  );
  assert.match(html, /<div class="card event-card">/);
  assert.match(
    html,
    /<h3 class="day"><time datetime="2026-11-17T16:37:00Z" data-local="day" title="Nov 17, 16:37 UTC">Tue, Nov 17<\/time><\/h3>/,
  );
  assert.match(html, /<ul class="events">/);
  assert.match(
    html,
    /<li class="event price-changed"><time datetime="2026-11-17T16:37:00Z" data-local="time" title="Nov 17, 16:37 UTC">16:37 UTC<\/time> <span class="pill pill-positive">price decrease<\/span>/,
  );

  // The subtitle, day heading and event row, verbatim.
  for (const line of [
    `<p class="subtitle">1 events across 1 models, newest first; last snapshot <time datetime="2026-11-17T16:37:00Z" data-local="datetime" title="Nov 17, 16:37 UTC">Nov 17, 16:37 UTC</time>.</p>`,
    `<h3 class="day"><time datetime="2026-11-17T16:37:00Z" data-local="day" title="Nov 17, 16:37 UTC">Tue, Nov 17</time></h3>`,
    `<li class="event price-changed"><time datetime="2026-11-17T16:37:00Z" data-local="time" title="Nov 17, 16:37 UTC">16:37 UTC</time> <span class="pill pill-positive">price decrease</span><span class="event-body"> <a class="model ext" href="https://openrouter.ai/deepseek/deepseek-v4.1-flash-1017" target="_blank" rel="noopener noreferrer">deepseek/deepseek-v4.1-flash-1017<span class="sr-only"> (opens OpenRouter in a new tab)</span></a> <span class="what">Wafer (wafer/mxfp4) · input $0.07 to $0.066 per M (-6%) · input 1.8x the cheapest (Wafer), output 7.1x the cheapest (2 Sail Research endpoints)</span></span></li>`,
  ]) {
    assert.ok(html.includes(line), `events page: ${line}`);
  }
});

test('renderEvents omits reader-hidden rejoin and replacement departure events', () => {
  const hiddenRejoin = {
    ...baseEvent,
    type: 'joined',
    tag: 'provider/new',
    provider: 'Provider',
    prompt: 1,
    completion: 2,
    expensive: false,
    rejoined: true,
    standing: { poolSize: 1, input: null, output: null },
  };
  const hiddenLeft = {
    ...baseEvent,
    type: 'left',
    tag: 'provider/old',
    provider: 'Provider',
    confirmed: true,
    replacedBy: 'provider/new',
  };

  const html = render.renderEvents(history([hiddenRejoin, hiddenLeft]));
  assert.match(html, /0 events across 0 models/);
  assert.match(html, /<div class="card empty"><p>No changes recorded yet\.<\/p><\/div>/);
  assert.doesNotMatch(html, /provider\/old/);
  assert.doesNotMatch(html, /provider\/new/);
});

test('renderEvents has the expected empty-state output', () => {
  const h = history([]);
  h.models = {};
  h.snapshots = [{
    takenAt: '2026-11-16T09:05:12Z',
    source: 'openrouter-api',
    partial: false,
    modelCount: 4,
  }];
  h.takenAt = '2026-11-16T09:05:12Z';

  const html = render.renderEvents(h);
  assert.match(
    html,
    /<p class="subtitle">0 events across 0 models, newest first; last snapshot <time datetime="2026-11-16T09:05:12Z" data-local="datetime" title="Nov 16, 09:05 UTC">Nov 16, 09:05 UTC<\/time>\.<\/p>/,
  );
  assert.match(html, /<div class="card empty"><p>No changes recorded yet\.<\/p><\/div>/);
});

test('renderIndex renders its page header, protections and empty week, with no stat strip', () => {
  const h = history([]);
  h.models = {
    a: {
      slug: 'a',
      name: 'A',
      series: [],
      events: [],
      latest: {
        takenAt: '2026-11-17T16:37:00Z',
        source: 'openrouter-api',
        listed: null,
        endpoints: [endpoint('a', 'A')],
      },
      everMulti: false,
      firstSeen: {
        takenAt: '2026-11-17T16:37:00Z',
        source: 'openrouter-api',
      },
      lastChange: null,
      outputModalities: ['text'],
      inputModalities: null,
      inLatestFull: true,
      latestFull: {
        takenAt: '2026-11-17T16:37:00Z',
        source: 'openrouter-api',
      },
    },
    b: {
      slug: 'b',
      name: 'B',
      series: [],
      events: [],
      latest: {
        takenAt: '2026-11-17T16:37:00Z',
        source: 'openrouter-api',
        listed: null,
        endpoints: [endpoint('b/one', 'B'), endpoint('b/two', 'B')],
      },
      everMulti: true,
      firstSeen: {
        takenAt: '2026-11-17T16:37:00Z',
        source: 'openrouter-api',
      },
      lastChange: null,
      outputModalities: ['text'],
      inputModalities: null,
      inLatestFull: true,
      latestFull: {
        takenAt: '2026-11-17T16:37:00Z',
        source: 'openrouter-api',
      },
    },
  };
  // The model count is the newest full snapshot's modelCount,
  // not the number of models the history ever observed (2 here).
  h.snapshots = [
    {
      takenAt: '2026-11-16T16:37:00Z',
      source: 'openrouter-api',
      partial: false,
      modelCount: 5,
    },
    {
      takenAt: '2026-11-17T16:37:00Z',
      source: 'openrouter-api',
      partial: false,
      modelCount: 3,
    },
  ];

  const html = render.renderIndex(h);

  assert.match(html, /<title>OpenRouter pool history<\/title>/);
  assert.match(html, /<h1 class="page-title">OpenRouter pool history<\/h1>/);
  assert.match(
    html,
    /Each OpenRouter model is served by one or more providers\. OpenRouter&#39;s model pages show each provider&#39;s current price and its price history\./,
  );
  assert.match(
    html,
    /<p class="meta">Last snapshot <time datetime="2026-11-17T16:37:00Z" data-local="datetime" title="Nov 17, 16:37 UTC">Nov 17, 16:37 UTC<\/time> · 3 models · 1 with more than one endpoint · 2 snapshots<\/p>/,
  );
  assert.match(
    html,
    /<aside class="card fixes" aria-label="OpenRouter's own protections">/,
  );
  assert.match(
    html,
    /<p class="fixes-title">Protect your traffic with OpenRouter's own settings first<\/p>/,
  );
  assert.match(
    html,
    /<code>max_price<\/code><span class="sr-only"> \(opens OpenRouter in a new tab\)<\/span><\/a> on the request \(or in a preset\) is a hard cap: no endpoint above it is used\./,
  );
  assert.match(
    html,
    /<code>:floor<\/code><span class="sr-only"> \(opens OpenRouter in a new tab\)<\/span><\/a> on the model id, or <code>sort: "price"<\/code>, tries the cheapest input price first/,
  );
  // The front page has no strip of stat cards.
  assert.doesNotMatch(html, /class="stat-/);
  assert.match(html, /<\/aside>\n<section id="week">/);
  // The week list is headed `Recent changes`, not `Changes this week`.
  assert.match(
    html,
    /<div class="section-head"><h2 class="section-title">Recent changes<\/h2><a class="arrow-link" href="events\.html">All changes <span aria-hidden="true">→<\/span><\/a><\/div>/,
  );
  assert.doesNotMatch(html, /Changes this week/);
  assert.match(
    html,
    /Each change is labelled in words: "joined · 12x" is a newcomer at 3x the cheapest or more; "price increase · 25%\+" is an input or output price up 25% or more\./,
  );
  assert.match(
    html,
    /<div class="card empty"><p>No changes in the last seven days\.<\/p><\/div>/,
  );
});

test('renderIndex limits the week list to twenty shown events and reports the unformatted total', () => {
  const events = Array.from({ length: 21 }, (_, index) => ({
    ...baseEvent,
    at: `2026-11-17T${String(index).padStart(2, '0')}:00:00Z`,
    type: 'model-listed',
    endpoints: index + 1,
    model: 'deepseek/deepseek-v4.1-flash-1017',
  })).reverse();

  const html = render.renderIndex(history(events));
  assert.equal((html.match(/<li class="event /g) || []).length, 20);
  assert.match(
    html,
    /<p class="more"><a class="arrow-link" href="events\.html">See all 21 changes this week <span aria-hidden="true">→<\/span><\/a><\/p>/,
  );
});

test('eventRow gives archived windows the expected Wayback wording', () => {
  const row = render.eventRow({
    ...baseEvent,
    type: 'model-delisted',
    model: 'xiaomi/mimo-v2.6-pro',
    at: '2026-11-10T17:15:01Z',
    since: '2026-10-27T16:45:15Z',
    sources: ['archived-model-page', 'archived-model-page'],
  });

  assert.equal(
    row,
    '<li class="event model-delisted"><time datetime="2026-11-10T17:15:01Z" data-local="time" title="Nov 10, 17:15 UTC">17:15 UTC</time> <span class="pill pill-warning">delisted</span><span class="event-body"> <a class="model ext" href="https://openrouter.ai/xiaomi/mimo-v2.6-pro" target="_blank" rel="noopener noreferrer">xiaomi/mimo-v2.6-pro<span class="sr-only"> (opens OpenRouter in a new tab)</span></a> <span class="what">No longer in OpenRouter&#39;s model list</span> <span class="window">between Oct 27 and Nov 10, both from Wayback Machine copies of the model page, transcribed by hand</span></span></li>',
  );
});

test('eventRow gives long and single-archived windows the expected wording', () => {
  const long = render.eventRow({
    ...baseEvent,
    type: 'price-changed',
    at: '2026-11-17T11:07:00Z',
    since: '2026-11-14T10:07:00Z',
    tag: 'x',
    provider: 'X',
    prompt: { from: 1, to: 1.5, change: 0.5 },
    completion: null,
    direction: 'up',
    up: true,
    major: true,
    standing: { poolSize: 1, input: null, output: null },
  });

  assert.match(
    long,
    /<span class="window">between Nov 14 and Nov 17<\/span>/,
  );

  const archivedEnd = render.eventRow({
    ...baseEvent,
    type: 'model-delisted',
    at: '2026-11-10T17:15:01Z',
    since: '2026-10-28T21:50:25Z',
    sources: ['openrouter-api', 'archived-model-page'],
  });

  assert.match(
    archivedEnd,
    /<span class="window">between Oct 28 and Nov 10; Nov 10 is from a Wayback Machine copy of the model page, transcribed by hand<\/span>/,
  );
});

test('renderIndex holds the protections card, the footer and the header lines verbatim', () => {
  // The figures: newest snapshot Nov 17 06:17, 4 models, 3 with more
  // than one endpoint, 12 changes this week, 5 snapshots. The front page has
  // no strip of stat cards.
  const at = '2026-11-17T06:17:00Z';
  const h = history(Array.from({ length: 12 }, (_, index) => ({
    ...baseEvent,
    at: `2026-11-16T${String(index).padStart(2, '0')}:00:00Z`,
    type: 'model-listed',
    endpoints: 1,
  })).reverse());
  // The history of snapshots A to E observed 5 models (one only in the archived seeds),
  // while snapshots D and E, the full ones, each list 4: the page says 4.
  const template = h.models['deepseek/deepseek-v4.1-flash-1017'];
  h.models = Object.fromEntries(['a/one', 'b/two', 'c/three', 'd/four', 'e/five']
    .map((slug, index) => [slug, { ...template, slug, everMulti: index < 3 }]));
  h.takenAt = at;
  const seed = { source: 'archived-model-page', partial: true, modelCount: 1 };
  const full = { source: 'openrouter-api', partial: false, modelCount: 4 };
  h.snapshots = [
    { takenAt: '2026-10-27T16:45:15Z', ...seed },
    { takenAt: '2026-10-28T21:50:25Z', ...seed },
    { takenAt: '2026-11-10T17:15:01Z', ...seed },
    { takenAt: '2026-11-16T09:05:12Z', ...full },
    { takenAt: at, ...full },
  ];

  const html = render.renderIndex(h);

  const protections = `<aside class="card fixes" aria-label="OpenRouter's own protections">
<p class="fixes-title">Protect your traffic with OpenRouter's own settings first</p>
<ul>
<li><a class="ext" href="https://openrouter.ai/docs/guides/routing/provider-selection#max-price" target="_blank" rel="noopener noreferrer"><code>max_price</code><span class="sr-only"> (opens OpenRouter in a new tab)</span></a> on the request (or in a preset) is a hard cap: no endpoint above it is used.</li>
<li><a class="ext" href="https://openrouter.ai/docs/guides/routing/provider-selection#floor-price-shortcut" target="_blank" rel="noopener noreferrer"><code>:floor</code><span class="sr-only"> (opens OpenRouter in a new tab)</span></a> on the model id, or <code>sort: "price"</code>, tries the cheapest input price first (seen on real requests; it can cost more when a request has much output). A throughput or latency preference only moves slower endpoints to the back, so with a price sort a fast, expensive newcomer can still come first.</li>
<li>The served provider of every request is on the Logs page, in the response, or in full with the router metadata header.</li>
</ul>
<p class="faint">This record tells you when to look at those settings again. <a class="ext" href="https://openrouter.ai/docs/guides/routing/provider-selection" target="_blank" rel="noopener noreferrer">OpenRouter's provider routing docs</a></p>
</aside>`;
  assert.ok(html.includes(protections), 'protections card');

  // The expected footer shortens its theme buttons to "…three buttons…".
  const footer = `<footer class="site-footer"><div class="footer-inner"><p>Built from the public OpenRouter API (no key, no test requests), reading every model's endpoints listing every 15 minutes, keeping a snapshot when something changed and one full snapshot a day; changes are also published as an <a href="feed.xml">RSS feed</a>. For live prices, latency and each provider's full price history, use the model's page on OpenRouter. Prices are USD per million tokens as the listing quotes them, after any provider discount. <span class="archive">Wayback Machine copy</span> marks points transcribed by hand from Wayback Machine copies of the model page.</p><p class="faint">An independent record; not affiliated with OpenRouter.</p><div class="theme-switch theme-footer" role="group" aria-label="Colour theme">…three buttons…</div></div></footer>
</body>
</html>`;
  const shortened = html.replace(
    /(<div class="theme-switch theme-footer" role="group" aria-label="Colour theme">).*?(<\/div><\/div><\/footer>)/,
    '$1…three buttons…$2',
  );
  assert.ok(shortened.endsWith(footer), 'footer');

  for (const line of [
    `<p class="subtitle">Each OpenRouter model is served by one or more providers. OpenRouter&#39;s model pages show each provider&#39;s current price and its price history. What they do not do is tell you when the providers change: a provider joining at many times the cheapest price, a price going up, a provider leaving. This site checks every model&#39;s providers every 15 minutes and keeps those changes as a dated record anyone can link to, including providers that have left, which OpenRouter&#39;s own history no longer shows. <a href="feed.xml">RSS feed</a>.</p>`,
    `<p class="meta">Last snapshot <time datetime="2026-11-17T06:17:00Z" data-local="datetime" title="Nov 17, 06:17 UTC">Nov 17, 06:17 UTC</time> · 4 models · 3 with more than one endpoint · 5 snapshots</p>`,
  ]) {
    assert.ok(html.includes(line), `header: ${line}`);
  }
  assert.doesNotMatch(html, /class="stat-/);
  assert.ok(html.includes(`</header>\n${protections}\n<section id="week">`), 'protections sit between the header and the week list');
  assert.equal((html.match(/<li class="event /g) || []).length, 12);
  assert.doesNotMatch(html, /<p class="more">/);
});

test('renderIndex keeps the newest full snapshot\'s model count when a newer partial lists another', () => {
  // After a full snapshot, a newer partial whose catalogue lists more or fewer
  // models does not change the count until the next full snapshot.
  const h = history([]);
  h.takenAt = '2026-11-17T16:52:00Z';
  h.snapshots = [
    { takenAt: '2026-11-17T16:37:00Z', source: 'openrouter-api', partial: false, modelCount: 4 },
    { takenAt: '2026-11-17T16:52:00Z', source: 'openrouter-api', partial: true, modelCount: 6 },
  ];

  assert.ok(render.renderIndex(h).includes('</time> · 4 models · '));
});

test('renderEvents and renderIndex hold the empty states verbatim for snapshot D alone', () => {
  const h = history([]);
  h.models = {};
  h.takenAt = '2026-11-16T09:05:12Z';
  h.latestFull = { takenAt: h.takenAt, source: 'openrouter-api' };
  h.snapshots = [{
    takenAt: h.takenAt,
    source: 'openrouter-api',
    partial: false,
    modelCount: 4,
  }];

  const eventsBody = `<main id="content">
<header class="page-header">
<h1 class="page-title">All changes</h1>
<p class="subtitle">0 events across 0 models, newest first; last snapshot <time datetime="2026-11-16T09:05:12Z" data-local="datetime" title="Nov 16, 09:05 UTC">Nov 16, 09:05 UTC</time>.</p>
<p class="meta"><a class="arrow-link" href="feed.xml" type="application/rss+xml">RSS feed of these changes <span aria-hidden="true">→</span></a> One item per model per snapshot, in the same shape as OpenRouter's new-models feed, so an RSS bot can post it to Discord.</p>
</header>
<div class="card empty"><p>No changes recorded yet.</p></div>
</main>`;
  assert.ok(render.renderEvents(h).includes(eventsBody), 'events page');

  // The week section's list is headed `Recent changes`.
  const week = `<section id="week">
<div class="section-head"><h2 class="section-title">Recent changes</h2><a class="arrow-link" href="events.html">All changes <span aria-hidden="true">→</span></a></div>
<p class="section-intro key">Each change is labelled in words: "joined · 12x" is a newcomer at 3x the cheapest or more; "price increase · 25%+" is an input or output price up 25% or more. Input and output prices are each compared with the cheapest on that side, per million tokens.</p>
<div class="card empty"><p>No changes in the last seven days.</p></div>

</section>`;
  assert.ok(render.renderIndex(h).includes(week), 'week section');
});

test('renderIndex of a built history with providers added and removed this week has no stat strip', () => {
  // The front page has no strip of stat cards: a week with providers added and
  // removed shows them only in the week list.
  const builder = new HistoryBuilder();
  const observe = (takenAt, endpoints) => builder.add({
    takenAt,
    source: 'openrouter-api',
    partial: false,
    note: null,
    modelCount: 1,
    models: { 'm/a': { name: 'A', listed: { prompt: 1, completion: 2 }, endpoints } },
  });
  const x = endpoint('a/x', 'X', 1, 2);
  const y = endpoint('a/y', 'Y', 2, 3);
  const w = endpoint('a/w', 'W', 4, 5);

  observe('2026-11-10T00:00:00Z', [x, y]);
  // W joins; Y goes missing, and is still missing 45 minutes on: a confirmed departure.
  observe('2026-11-17T10:00:00Z', [x, w]);
  observe('2026-11-17T10:15:00Z', [x, w]);
  observe('2026-11-17T10:45:00Z', [x, w]);

  const html = render.renderIndex(builder.finish());

  assert.doesNotMatch(html, /class="stat-/);
  assert.match(html, /<p class="meta">Last snapshot <time datetime="2026-11-17T10:45:00Z"[^>]*>[^<]*<\/time> · 1 models · 1 with more than one endpoint · 4 snapshots<\/p>/);
  assert.match(html, /<\/header>\n<aside class="card fixes" aria-label="OpenRouter's own protections">/);
  assert.match(html, /<\/aside>\n<section id="week">/);
  assert.match(html, /<li class="event joined[^"]*">/);
  assert.match(html, /<li class="event left[^"]*">/);
  assert.match(html, /<footer class="site-footer">/);
});
