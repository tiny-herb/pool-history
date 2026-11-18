import test from "node:test";
import assert from "node:assert/strict";

import { cardWorthy } from "../src/discord.mjs";

import {
  DYNAMIC_MIN_CHECKS,
  DYNAMIC_SHARE,
  DYNAMIC_WINDOW_MS,
  dynamicCheapest,
  feedItems,
  renderJsonFeed,
  renderFeedPage,
  renderFeed,
} from "../src/feed.mjs";

const DESCRIPTION =
  "Providers joining and leaving OpenRouter models, and their price changes, checked every 15 minutes in the public endpoints API. Independent; not affiliated with OpenRouter.";

function emptyHistory(overrides = {}) {
  return {
    takenAt: null,
    latestFull: null,
    snapshots: [],
    models: {},
    events: [],
    ...overrides,
  };
}

function priceEvent(overrides = {}) {
  return {
    type: "price-changed",
    model: "deepseek/deepseek-v4.1-flash-1017",
    at: "2026-11-17T16:37:00Z",
    since: "2026-11-17T16:22:00Z",
    sources: ["openrouter-api", "openrouter-api"],
    tag: "wafer/mxfp4",
    provider: "Wafer",
    prompt: {
      from: 0.07,
      to: 0.066,
      change: -0.05714285714285716,
    },
    completion: null,
    change: -0.016901408450704203,
    direction: "down",
    up: false,
    major: false,
    standing: {
      poolSize: 4,
      input: {
        cheapest: false,
        vs: 1.8333333333333335,
        tags: ["wafer/us"],
        providers: ["Wafer"],
      },
      output: {
        cheapest: false,
        vs: 7.142857142857143,
        tags: ["sail-research/fp4", "sail-research/fp4/us"],
        providers: ["Sail Research", "Sail Research"],
      },
    },
    ...overrides,
  };
}

function exampleHistory(events = [priceEvent()]) {
  const model = "deepseek/deepseek-v4.1-flash-1017";
  const latestEndpoints = [
    {
      tag: "wafer/us",
      provider: "Wafer",
      prompt: 0.036,
      completion: 0.5,
      discount: 0,
      context: null,
      quantization: null,
      status: null,
      uptime30m: null,
      uptime1d: null,
      uptimePage: null,
      latency30m: null,
      throughput30m: null,
    },
    {
      tag: "sail-research/fp4/us",
      provider: "Sail Research",
      prompt: 0.04,
      completion: 0.07,
      discount: 0,
      context: null,
      quantization: null,
      status: null,
      uptime30m: null,
      uptime1d: null,
      uptimePage: null,
      latency30m: null,
      throughput30m: null,
    },
    {
      tag: "sail-research/fp4",
      provider: "Sail Research",
      prompt: 0.04,
      completion: 0.07,
      discount: 0,
      context: null,
      quantization: null,
      status: null,
      uptime30m: null,
      uptime1d: null,
      uptimePage: null,
      latency30m: null,
      throughput30m: null,
    },
    {
      tag: "wafer/mxfp4",
      provider: "Wafer",
      prompt: 0.066,
      completion: 0.5,
      discount: 0,
      context: null,
      quantization: null,
      status: null,
      uptime30m: null,
      uptime1d: null,
      uptimePage: null,
      latency30m: null,
      throughput30m: null,
    },
  ];

  return {
    takenAt: "2026-11-17T16:37:00Z",
    latestFull: {
      takenAt: "2026-11-17T16:37:00Z",
      source: "openrouter-api",
    },
    snapshots: [
      {
        takenAt: "2026-11-17T16:22:00Z",
        source: "openrouter-api",
        partial: false,
        modelCount: 1,
      },
      {
        takenAt: "2026-11-17T16:37:00Z",
        source: "openrouter-api",
        partial: false,
        modelCount: 1,
      },
    ],
    models: {
      [model]: {
        slug: model,
        name: "DeepSeek: DeepSeek V4.1 Flash 1017",
        series: [
          {
            takenAt: "2026-11-17T16:22:00Z",
            source: "openrouter-api",
            endpoints: 4,
            providers: 2,
            cheapest: 0.608,
            cheapestPrompt: 0.036,
            cheapestCompletion: 0.07,
            cheapestTags: ["wafer/us"],
            priciestTag: "wafer/mxfp4",
            spread: 1,
            mixedFree: false,
            ranges: {
              input: { low: 0.036, high: 0.07, range: 1.9444444444444446, mixedFree: false },
              output: { low: 0.07, high: 0.5, range: 7.142857142857143, mixedFree: false },
            },
            minUptime: null,
            uptime: {},
            prices: {
              "wafer/us": {
                provider: "Wafer",
                prompt: 0.036,
                completion: 0.5,
                discount: 0,
                quantization: null,
              },
              "sail-research/fp4/us": {
                provider: "Sail Research",
                prompt: 0.04,
                completion: 0.07,
                discount: 0,
                quantization: null,
              },
              "sail-research/fp4": {
                provider: "Sail Research",
                prompt: 0.04,
                completion: 0.07,
                discount: 0,
                quantization: null,
              },
              "wafer/mxfp4": {
                provider: "Wafer",
                prompt: 0.07,
                completion: 0.5,
                discount: 0,
                quantization: null,
              },
            },
            tags: [
              "wafer/us",
              "sail-research/fp4/us",
              "sail-research/fp4",
              "wafer/mxfp4",
            ],
          },
          {
            takenAt: "2026-11-17T16:37:00Z",
            source: "openrouter-api",
            endpoints: 4,
            providers: 2,
            cheapest: 0.608,
            cheapestPrompt: 0.036,
            cheapestCompletion: 0.07,
            cheapestTags: ["wafer/us"],
            priciestTag: "wafer/mxfp4",
            spread: 1,
            mixedFree: false,
            ranges: {
              input: { low: 0.036, high: 0.066, range: 1.8333333333333335, mixedFree: false },
              output: { low: 0.07, high: 0.5, range: 7.142857142857143, mixedFree: false },
            },
            minUptime: null,
            uptime: {},
            prices: {
              "wafer/us": {
                provider: "Wafer",
                prompt: 0.036,
                completion: 0.5,
                discount: 0,
                quantization: null,
              },
              "sail-research/fp4/us": {
                provider: "Sail Research",
                prompt: 0.04,
                completion: 0.07,
                discount: 0,
                quantization: null,
              },
              "sail-research/fp4": {
                provider: "Sail Research",
                prompt: 0.04,
                completion: 0.07,
                discount: 0,
                quantization: null,
              },
              "wafer/mxfp4": {
                provider: "Wafer",
                prompt: 0.066,
                completion: 0.5,
                discount: 0,
                quantization: null,
              },
            },
            tags: [
              "wafer/us",
              "sail-research/fp4/us",
              "sail-research/fp4",
              "wafer/mxfp4",
            ],
          },
        ],
        events,
        latest: {
          takenAt: "2026-11-17T16:37:00Z",
          source: "openrouter-api",
          listed: { prompt: 0.036, completion: 0.5 },
          endpoints: latestEndpoints,
        },
        everMulti: true,
        firstSeen: {
          takenAt: "2026-11-17T16:22:00Z",
          source: "openrouter-api",
        },
        lastChange: "2026-11-17T16:37:00Z",
        outputModalities: ["text"],
        inputModalities: ["text"],
        inLatestFull: true,
        latestFull: {
          takenAt: "2026-11-17T16:37:00Z",
          source: "openrouter-api",
        },
      },
    },
    events,
  };
}

test("exports the dynamic-provider thresholds", () => {
  assert.equal(DYNAMIC_MIN_CHECKS, 8);
  assert.equal(DYNAMIC_SHARE, 0.5);
  assert.equal(DYNAMIC_WINDOW_MS, 86_400_000);
});

test("renders the empty RSS document byte for byte", () => {
  assert.equal(
    renderFeed(emptyHistory()),
    `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>OpenRouter pool history - Pool changes</title>
<description>${DESCRIPTION}</description>
<link>https://openrouter.ai</link>
<lastBuildDate>Thu, 01 Jan 1970 00:00:00 GMT</lastBuildDate>
<language>en-us</language>
<generator>openrouter-pool-history</generator>

</channel>
</rss>
`,
  );
});

test("normalises the site URL and emits the RSS self link byte for byte", () => {
  assert.equal(
    renderFeed(emptyHistory(), { siteUrl: "https://pool.example.test///" }),
    `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>OpenRouter pool history - Pool changes</title>
<description>${DESCRIPTION}</description>
<link>https://pool.example.test/</link>
<atom:link href="https://pool.example.test/feed.xml" rel="self" type="application/rss+xml"/>
<lastBuildDate>Thu, 01 Jan 1970 00:00:00 GMT</lastBuildDate>
<language>en-us</language>
<generator>openrouter-pool-history</generator>

</channel>
</rss>
`,
  );
});

test("renders the empty JSON Feed byte for byte", () => {
  assert.equal(
    renderJsonFeed(emptyHistory()),
    `{
 "version": "https://jsonfeed.org/version/1.1",
 "title": "OpenRouter pool history - Pool changes",
 "description": "${DESCRIPTION}",
 "home_page_url": "https://openrouter.ai",
 "language": "en-US",
 "items": []
}
`,
  );
});

test("renders JSON Feed URLs only when a site URL is supplied", () => {
  assert.equal(
    renderJsonFeed(emptyHistory(), { siteUrl: "https://example.test/ph" }),
    `{
 "version": "https://jsonfeed.org/version/1.1",
 "title": "OpenRouter pool history - Pool changes",
 "description": "${DESCRIPTION}",
 "home_page_url": "https://example.test/ph/",
 "feed_url": "https://example.test/ph/feed.json",
 "language": "en-US",
 "items": []
}
`,
  );
});

test("builds the RSS feed of one price-decrease item byte for byte", () => {
  assert.equal(
    renderFeed(exampleHistory()),
    `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>OpenRouter pool history - Pool changes</title>
<description>Providers joining and leaving OpenRouter models, and their price changes, checked every 15 minutes in the public endpoints API. Independent; not affiliated with OpenRouter.</description>
<link>https://openrouter.ai</link>
<lastBuildDate>Tue, 17 Nov 2026 16:37:00 GMT</lastBuildDate>
<language>en-us</language>
<generator>openrouter-pool-history</generator>
<item>
<title><![CDATA[📝 Text model · Price decrease: Wafer (wafer/mxfp4) on DeepSeek V4.1 Flash 1017 (deepseek/deepseek-v4.1-flash-1017) · input -6%]]></title>
<description><![CDATA[<ul><li>Wafer (wafer/mxfp4) · input $0.07 to $0.066 per M (-6%) · input 1.8x the cheapest (Wafer), output 7.1x the cheapest (2 Sail Research endpoints)</li></ul><p>Between the snapshots of Nov 17, 16:22 UTC and Nov 17, 16:37 UTC.</p><p><a href="https://openrouter.ai/deepseek/deepseek-v4.1-flash-1017">DeepSeek: DeepSeek V4.1 Flash 1017 on OpenRouter</a></p>]]></description>
<link>https://openrouter.ai/deepseek/deepseek-v4.1-flash-1017</link>
<guid isPermaLink="false">deepseek/deepseek-v4.1-flash-1017-2026-11-17T16:37:00Z</guid>
<pubDate>Tue, 17 Nov 2026 16:37:00 GMT</pubDate>
</item>
</channel>
</rss>
`,
  );
});

test("adds, but never substitutes, the Pool history link for a site URL", () => {
  const xml = renderFeed(exampleHistory(), {
    siteUrl: "https://pool.example.test/",
  });

  assert.match(
    xml,
    /<atom:link href="https:\/\/pool\.example\.test\/feed\.xml" rel="self" type="application\/rss\+xml"\/>/,
  );
  assert.match(
    xml,
    /<link>https:\/\/openrouter\.ai\/deepseek\/deepseek-v4\.1-flash-1017<\/link>/,
  );
  assert.match(
    xml,
    /<a href="https:\/\/pool\.example\.test\/events\.html">Pool history<\/a>/,
  );

  const siteLines = `<link>https://pool.example.test/</link>
<atom:link href="https://pool.example.test/feed.xml" rel="self" type="application/rss+xml"/>
…<p><a href="https://openrouter.ai/deepseek/deepseek-v4.1-flash-1017">DeepSeek: DeepSeek V4.1 Flash 1017 on OpenRouter</a> · <a href="https://pool.example.test/events.html">Pool history</a></p>`;
  const [link, selfLink, descriptionEnd] = siteLines.split("\n");
  assert.ok(xml.includes(`\n${link}\n${selfLink}\n`));
  assert.ok(xml.includes(`${descriptionEnd.slice(1)}]]></description>`));
});

test("an item's when text follows its event's window", () => {
  const windows = `-- no check log: since 2026-11-17T10:07:00Z sources ["openrouter-api","openrouter-api"] watcherOff false
   when: Between the snapshots of Nov 17, 10:07 UTC and Nov 17, 11:07 UTC.
-- checks every 15 minutes: since 2026-11-17T10:52:00Z sources ["openrouter-api","openrouter-api"] watcherOff false
   when: Between the snapshots of Nov 17, 10:52 UTC and Nov 17, 11:07 UTC.
-- last check 10:22 then nothing (watcher off): since 2026-11-17T10:22:00Z sources ["openrouter-api","openrouter-api"] watcherOff true
   when: Between the snapshots of Nov 17, 10:22 UTC and Nov 17, 11:07 UTC.
-- 10:52 check failed for a/b: since 2026-11-17T10:37:00Z sources ["openrouter-api","openrouter-api"] watcherOff false
   when: Between the snapshots of Nov 17, 10:37 UTC and Nov 17, 11:07 UTC.
-- two days apart: Between Nov 14 and Nov 17 (no snapshot in between).`;

  const lines = windows.split("\n");
  const cases = [];
  for (let i = 0; i < 8; i += 2) {
    const [, since, sources, watcherOff] = lines[i].match(
      /since (\S+) sources (\[.*\]) watcherOff (true|false)$/,
    );
    cases.push({
      event: { since, sources: JSON.parse(sources), watcherOff: watcherOff === "true" },
      when: lines[i + 1].replace(/^\s*when: /, ""),
    });
  }
  cases.push({
    event: { since: "2026-11-14T10:07:00Z" },
    when: lines[8].replace(/^-- two days apart: /, ""),
  });

  for (const { event, when } of cases) {
    const history = exampleHistory([
      priceEvent({ at: "2026-11-17T11:07:00Z", ...event }),
    ]);
    const [item] = feedItems(history);
    assert.ok(item.description.includes(`<p>${when}</p>`), when);
  }
});

test("feedItems keeps one item per model and observation, newest first", () => {
  const later = priceEvent({
    model: "a/model",
    at: "2026-11-17T17:00:00Z",
    since: "2026-11-17T16:45:00Z",
    tag: "a",
    provider: "A",
  });

  const history = exampleHistory([priceEvent(), later]);
  history.events = [later, history.models["deepseek/deepseek-v4.1-flash-1017"].events[0]];

  const items = feedItems(history, { limit: Infinity });

  assert.equal(items.length, 2);
  assert.equal(items[0].at, "2026-11-17T17:00:00Z");
  assert.equal(items[0].model, "a/model");
  assert.equal(items[1].at, "2026-11-17T16:37:00Z");
  assert.equal(
    items[1].guid,
    "deepseek/deepseek-v4.1-flash-1017-2026-11-17T16:37:00Z",
  );
});

test("shownEvents hides rejoined joins and same-item replacement departures", () => {
  const join = {
    type: "joined",
    model: "deepseek/deepseek-v4.1-flash-1017",
    at: "2026-11-17T16:37:00Z",
    since: "2026-11-17T16:22:00Z",
    sources: ["openrouter-api", "openrouter-api"],
    tag: "sail-research/fp4/us",
    provider: "Sail Research",
    prompt: 0.04,
    completion: 0.07,
    ratio: null,
    expensive: false,
    cheapestProvider: "Wafer",
    cheapestTag: "wafer/us",
    standing: { poolSize: 4, input: null, output: null },
  };

  const rejoined = { ...join, rejoined: true };
  assert.equal(feedItems(exampleHistory([rejoined])).length, 0);

  const replacing = { ...join, replaces: "sail-research/fp4" };
  const left = {
    type: "left",
    model: "deepseek/deepseek-v4.1-flash-1017",
    at: "2026-11-17T16:37:00Z",
    since: "2026-11-17T16:22:00Z",
    sources: ["openrouter-api", "openrouter-api"],
    tag: "sail-research/fp4",
    provider: "Sail Research",
    confirmed: false,
    replacedBy: "sail-research/fp4/us",
  };

  const items = feedItems(exampleHistory([left, replacing]));
  assert.equal(items.length, 1);
  assert.match(
    items[0].description,
    /Sail Research endpoint changed: sail-research\/fp4 to sail-research\/fp4\/us/,
  );
  assert.doesNotMatch(items[0].description, /replaced by/);
});

test("dynamicCheapest recognises a cheapest event naming a dynamic provider", () => {
  const item = {
    dynamic: [
      {
        provider: "X",
        checks: 8,
        of: 8,
        range: {
          input: { low: 0.1, high: 0.18 },
          output: { low: 1, high: 1 },
        },
      },
    ],
    events: [
      {
        type: "cheapest-changed",
        input: {
          from: ["y"],
          to: ["x"],
          fromProviders: ["Y"],
          toProviders: ["X"],
          toPrice: 0.18,
          fromNow: 1,
          fromLeft: false,
        },
        output: null,
      },
    ],
  };

  assert.equal(dynamicCheapest(item), true);
});

test("dynamicCheapest does not treat an unrelated dynamic repricing as a cheapest change", () => {
  const item = {
    dynamic: [
      {
        provider: "X",
        checks: 8,
        of: 8,
        range: {
          input: { low: 0.1, high: 0.18 },
          output: { low: 1, high: 1 },
        },
      },
    ],
    events: [
      {
        type: "cheapest-changed",
        input: {
          from: ["z"],
          to: ["y"],
          fromProviders: ["Z"],
          toProviders: ["Y"],
          toPrice: 0.2,
          fromNow: 0.3,
          fromLeft: false,
        },
        output: null,
      },
    ],
  };

  assert.equal(dynamicCheapest(item), false);
});

test("renderFeedPage includes the empty-state feed body", () => {
  const page = renderFeedPage(emptyHistory());

  assert.match(page, /<title>Pool-change feed · OpenRouter pool history<\/title>/);
  assert.match(page, /<h1 class="page-title">Pool-change feed<\/h1>/);
  assert.match(page, /RSS 2\.0 \(feed\.xml\)/);
  assert.match(page, /JSON Feed \(feed\.json\)/);
  assert.match(
    page,
    /<div class="card empty"><p>No changes recorded yet\.<\/p><\/div>/,
  );
});

test("renderFeedPage renders a feed article and its item fields", () => {
  const page = renderFeedPage(exampleHistory());

  const article = `<article class="feed-item" data-guid="deepseek/deepseek-v4.1-flash-1017-2026-11-17T16:37:00Z">
<header class="feed-head"><h2 class="feed-title">📝 Text model · Price decrease: Wafer (wafer/mxfp4) on DeepSeek V4.1 Flash 1017 (deepseek/deepseek-v4.1-flash-1017) · input -6%</h2><time datetime="2026-11-17T16:37:00Z" data-local="datetime" title="Nov 17, 16:37 UTC">Nov 17, 16:37 UTC</time></header>
<ul class="feed-events"><li><span class="pill pill-positive">price decrease</span><span>Wafer (wafer/mxfp4) · input $0.07 to $0.066 per M (-6%) · input 1.8x the cheapest (Wafer), output 7.1x the cheapest (2 Sail Research endpoints)</span></li></ul>
<p class="feed-when">Between the snapshots of <time datetime="2026-11-17T16:22:00Z" data-local="datetime" title="Nov 17, 16:22 UTC">Nov 17, 16:22 UTC</time> and <time datetime="2026-11-17T16:37:00Z" data-local="datetime" title="Nov 17, 16:37 UTC">Nov 17, 16:37 UTC</time>.</p>
<p class="feed-links"><a class="ext" href="https://openrouter.ai/deepseek/deepseek-v4.1-flash-1017" target="_blank" rel="noopener noreferrer">DeepSeek: DeepSeek V4.1 Flash 1017 on OpenRouter<span class="sr-only"> (opens OpenRouter in a new tab)</span></a></p>
<details class="feed-fields"><summary>Item fields</summary><dl>
<dt>title</dt><dd>📝 Text model · Price decrease: Wafer (wafer/mxfp4) on DeepSeek V4.1 Flash 1017 (deepseek/deepseek-v4.1-flash-1017) · input -6%</dd>
<dt>link</dt><dd><code>https://openrouter.ai/deepseek/deepseek-v4.1-flash-1017</code></dd>
<dt>guid</dt><dd><code>deepseek/deepseek-v4.1-flash-1017-2026-11-17T16:37:00Z</code></dd>
<dt>pubDate</dt><dd><code>Tue, 17 Nov 2026 16:37:00 GMT</code></dd>
<dt>event types</dt><dd><code>price-changed</code></dd>
</dl></details>
</article>`;

  assert.ok(page.includes(article), "page holds the article");
});

test("departure, return and replacement items read as expected", () => {
  const departures = `-- gone 17 minutes (00:03 -> 00:06, 00:08, 00:23)
  2026-11-17T00:06:00Z left {"confirmed":false} | Sail Research (sail-research/fp4) missing at the last check; may come back | <span class="pill pill-neutral">not listed · unconfirmed</span>
  item 2026-11-17T00:06:00Z: Provider missing: Sail Research on Kimi K3 (moonshotai/kimi-k3) · may come back
-- gone 30 minutes (plus 00:36)
  2026-11-17T00:06:00Z left {"confirmed":true} | Sail Research (sail-research/fp4) left | <span class="pill pill-neutral">left</span>
  item 2026-11-17T00:06:00Z: Provider removed: Sail Research on Kimi K3 (moonshotai/kimi-k3)
-- back at the next check
  2026-11-17T00:09:00Z joined {"rejoined":true} | Sail Research (sail-research/fp4) joined at $0.20 / $12.00 per M, input and output 1.1x the cheapest (Relace) | <span class="pill pill-neutral">joined</span>
  2026-11-17T00:06:00Z left {"confirmed":false,"returned":true} | Sail Research (sail-research/fp4) was briefly unlisted and came back | <span class="pill pill-neutral">briefly unlisted</span>
  item 2026-11-17T00:06:00Z: Provider briefly unlisted: Sail Research on Kimi K3 (moonshotai/kimi-k3) · came back
-- back under a new endpoint id
  2026-11-17T00:18:00Z left {"confirmed":false,"replacedBy":"sail-research/fp4/us"} | Sail Research endpoint sail-research/fp4 replaced by sail-research/fp4/us | <span class="pill pill-neutral">endpoint changed</span>
  2026-11-17T00:18:00Z joined {"replaces":"sail-research/fp4"} | Sail Research endpoint changed: sail-research/fp4 to sail-research/fp4/us, at $0.20 / $12.00 per M | <span class="pill pill-neutral">endpoint changed</span>
  2026-11-17T00:18:00Z cheapest-changed {} | Cheapest output: now sail-research/fp4/us at $12.00 per M · was sail-research/fp4 (left) | <span class="pill pill-neutral">cheapest</span>
  item 2026-11-17T00:18:00Z: Endpoint changed: Sail Research (sail-research/fp4/us) on Kimi K3 (moonshotai/kimi-k3) · sail-research/fp4 to sail-research/fp4/us`;

  const model = "moonshotai/kimi-k3";
  const poolA = {
    wafer: { provider: "Wafer", prompt: 0.192, completion: 16 },
    "relace/fp4": { provider: "Relace", prompt: 0.1824, completion: 11 },
    "sail-research/fp4": { provider: "Sail Research", prompt: 0.2, completion: 12 },
  };
  const { "sail-research/fp4": sail, ...withoutSail } = poolA;
  const base = { model, sources: ["openrouter-api", "openrouter-api"] };

  function eventFrom(at, type, flags) {
    const since = "2026-11-17T00:03:00Z";
    if (type === "left") {
      return { ...base, type, at, since, tag: "sail-research/fp4", provider: "Sail Research", ...flags };
    }
    if (type === "joined") {
      return {
        ...base,
        type,
        at,
        since,
        tag: flags.replaces ? "sail-research/fp4/us" : "sail-research/fp4",
        provider: "Sail Research",
        prompt: 0.2,
        completion: 12,
        ratio: null,
        expensive: false,
        cheapestProvider: "Relace",
        cheapestTag: "relace/fp4",
        standing: { poolSize: 3, input: null, output: null },
        ...flags,
      };
    }
    return {
      ...base,
      type,
      at,
      since,
      input: null,
      output: {
        from: ["sail-research/fp4"],
        to: ["sail-research/fp4/us"],
        fromProviders: ["Sail Research"],
        toProviders: ["Sail Research"],
        toPrice: 12,
        fromNow: null,
        fromLeft: true,
      },
    };
  }

  const scenarios = departures.split(/^-- .*$/m).slice(1);
  assert.equal(scenarios.length, 4);
  for (const scenario of scenarios) {
    const events = [];
    const sentences = [];
    let expected;
    for (const line of scenario.trim().split("\n").map((l) => l.trim())) {
      const item = line.match(/^item (\S+): (.*)$/);
      if (item) {
        expected = { at: item[1], title: item[2] };
        continue;
      }
      const [, at, type, flags, sentence] = line.match(/^(\S+) (\S+) (\{.*?\}) \| (.*?) \| <span/);
      const event = eventFrom(at, type, JSON.parse(flags));
      events.push(event);
      if (type !== "cheapest-changed") sentences.push({ event, sentence });
    }

    const replaced = events.some((e) => e.replaces);
    const after = replaced
      ? { ...withoutSail, "sail-research/fp4/us": sail }
      : withoutSail;
    const history = emptyHistory({
      takenAt: expected.at,
      events,
      models: {
        [model]: {
          slug: model,
          name: "MoonshotAI: Kimi K3",
          series: [
            { takenAt: "2026-11-17T00:03:00Z", source: "openrouter-api", prices: poolA },
            { takenAt: expected.at, source: "openrouter-api", prices: after },
          ],
          events,
        },
      },
    });

    const item = feedItems(history).find((it) => it.at === expected.at);
    assert.equal(item.title, expected.title);
    for (const { event, sentence } of sentences) {
      const shown = event.at === expected.at && !event.rejoined && !event.replacedBy;
      assert.equal(item.description.includes(`<li>${sentence}</li>`), shown, sentence);
    }
  }
});

test("a departure replaced in a later observation keeps the Provider missing title", () => {
  const model = "moonshotai/kimi-k3";
  const sources = ["openrouter-api", "openrouter-api"];
  const sail = { provider: "Sail Research", prompt: 0.2, completion: 12 };
  const rest = {
    wafer: { provider: "Wafer", prompt: 0.192, completion: 16 },
    "relace/fp4": { provider: "Relace", prompt: 0.1824, completion: 11 },
  };
  const events = [
    {
      type: "joined",
      model,
      at: "2026-11-17T00:09:00Z",
      since: "2026-11-17T00:06:00Z",
      sources,
      tag: "sail-research/fp4/us",
      provider: "Sail Research",
      prompt: 0.2,
      completion: 12,
      ratio: null,
      expensive: false,
      cheapestProvider: "Relace",
      cheapestTag: "relace/fp4",
      standing: { poolSize: 3, input: null, output: null },
      replaces: "sail-research/fp4",
    },
    {
      type: "left",
      model,
      at: "2026-11-17T00:06:00Z",
      since: "2026-11-17T00:03:00Z",
      sources,
      tag: "sail-research/fp4",
      provider: "Sail Research",
      confirmed: false,
      replacedBy: "sail-research/fp4/us",
    },
  ];
  const history = emptyHistory({
    takenAt: "2026-11-17T00:09:00Z",
    events,
    models: {
      [model]: {
        slug: model,
        name: "MoonshotAI: Kimi K3",
        outputModalities: ["text"],
        series: [
          { takenAt: "2026-11-17T00:03:00Z", source: "openrouter-api", prices: { ...rest, "sail-research/fp4": sail } },
          { takenAt: "2026-11-17T00:06:00Z", source: "openrouter-api", prices: rest },
          { takenAt: "2026-11-17T00:09:00Z", source: "openrouter-api", prices: { ...rest, "sail-research/fp4/us": sail } },
        ],
        events,
      },
    },
  });

  const item = feedItems(history).find((it) => it.at === "2026-11-17T00:06:00Z");
  assert.equal(
    item.title,
    "📝 Text model · Provider missing: Sail Research on Kimi K3 (moonshotai/kimi-k3) · may come back",
  );
});

const move = (from, to) => ({ from, to, change: to / from - 1 });

function priceChanged(where, tag, provider, prompt, completion, extra = {}) {
  const sides = [prompt, completion].filter(Boolean);
  const rose = sides.some((s) => s.change > 0);
  const fell = sides.some((s) => s.change < 0);
  const direction = rose && !fell ? "up" : fell && !rose ? "down" : "mixed";
  const change = prompt && completion
    ? (3 * prompt.to + completion.to) / (3 * prompt.from + completion.from) - 1
    : sides[0].change;
  return {
    type: "price-changed",
    ...where,
    tag,
    provider,
    prompt,
    completion,
    change,
    direction,
    up: direction === "up",
    major: sides.some((s) => Math.abs(s.change) >= 0.25),
    standing: { poolSize: 1, input: null, output: null },
    ...extra,
  };
}

function pricesOf(rows) {
  return Object.fromEntries(
    rows.map(([tag, provider, prompt, completion]) => [
      tag,
      { provider, prompt, completion, discount: 0, quantization: null },
    ]),
  );
}

function historyOf(models, events) {
  for (const [id, entry] of Object.entries(models)) {
    entry.slug = id;
    entry.series ??= [];
    entry.events = events.filter((e) => e.model === id);
  }
  return emptyHistory({ takenAt: events.map((e) => e.at).sort().at(-1), models, events });
}

function mimoHistory() {
  const where = {
    model: "xiaomi/mimo-v2.6-pro",
    at: "2026-11-10T17:15:01Z",
    since: "2026-10-27T16:45:15Z",
    sources: ["archived-model-page", "archived-model-page"],
  };
  const cheapestOf = (tag, provider) => ({ tags: [tag], providers: [provider] });
  const events = [
    {
      type: "joined",
      ...where,
      tag: "primalabs/fp8",
      provider: "PrimaLabs",
      prompt: 4,
      completion: 8,
      ratio: 12.259409096481551,
      expensive: true,
      cheapestProvider: "GMICloud",
      cheapestTag: "gmicloud/bf16",
      standing: {
        poolSize: 5,
        input: { cheapest: false, vs: 4 / 0.3263, ...cheapestOf("gmicloud/bf16", "GMICloud") },
        output: { cheapest: false, vs: 8 / 0.6525, ...cheapestOf("gmicloud/bf16", "GMICloud") },
      },
    },
    { type: "left", ...where, tag: "novitaai", provider: "NovitaAI", confirmed: true },
    {
      type: "spread-crossed",
      ...where,
      input: { from: 0.522 / 0.3698, to: 4 / 0.3263, low: 0.3263, high: 4, up: true, cause: "priciest-rose" },
      output: { from: 1.044 / 0.7395, to: 8 / 0.6525, low: 0.6525, high: 8, up: true, cause: "priciest-rose" },
      up: true,
      cause: "priciest-rose",
    },
    priceChanged(where, "gmicloud/bf16", "GMICloud", move(0.3698, 0.3263), move(0.7395, 0.6525), {
      discountFrom: 0.15,
      discountTo: 0.25,
      standing: {
        poolSize: 5,
        input: { cheapest: true, vs: null, ...cheapestOf("deepinfra/fp8", "DeepInfra") },
        output: { cheapest: true, vs: null, ...cheapestOf("deepinfra/fp8", "DeepInfra") },
      },
    }),
  ];
  return { models: { [where.model]: { name: "Xiaomi: MiMo-V2.6-Pro" } }, events };
}

test("item titles", () => {
  const expectedTitles = `Price increase: Novita on B (a/b) · input +30% · Baidu input -64% · Relace input -1%
Price range widened: B (a/b) · input price range above 3x as the cheapest fell · +2 more changes
New provider: PrimaLabs on MiMo-V2.6-Pro (xiaomi/mimo-v2.6-pro) · input and output 12x the cheapest (GMICloud) · +3 more changes
📺 Video model · New provider: Fal on Seedance X (bytedance/seedance-x)
📝 Text model · Price decrease: PrimeIntellect on Gemma 4 31B (google/gemma-4-31b-it) · input -23%, output -22%
📝 Text model · New provider: Baidu on GLM 5.3 Flash (z-ai/glm-5.3-flash) · input 3.8x, output 6.4x the cheapest (Relace)
📝 Text model · Endpoint removed: Mistral (mistral/zdr) on Mistral Medium 3 (mistralai/mistral-medium-3)
📝 Text model · Provider removed: Io Net on Qwen3.8 27B (qwen/qwen3.8-27b) · PrimeIntellect input +27%, output +26%
📝 Text model · Price change: Makora on GLM 5.3 (z-ai/glm-5.3) · input +50%, output -44% · Morph input -6%, output -6%
📝 Text model · New cheapest provider: DeepSeek V4 Pro 0423 (deepseek/deepseek-v4-pro) · cheapest input now StreamLake
📝 Text model · Quantization changed: Mistral (mistral/zdr) on GLM 5.2 (z-ai/glm-5.2) · quantization nvfp4 to unknown
📺 Video model · Model listed: HappyHorse 1.0 (alibaba/happyhorse-1.0) · 1 endpoint
Endpoint removed: OpenAI (openai/flex) on GPT-5.4 Pro (openai/gpt-5.4-pro) · +1 more change`;

  const ab = { model: "a/b", at: "2026-11-16T19:06:42Z", since: "2026-11-16T06:56:26Z", sources: ["openrouter-api", "openrouter-api"] };
  const abModel = () => ({ "a/b": { name: "A: B" } });
  const twoChecks = (model, since, at) => ({ model, since, at, sources: ["openrouter-api", "openrouter-api"] });
  const text = ["text"];
  const video = ["video"];

  const gemma = twoChecks("google/gemma-4-31b-it", "2026-11-17T12:00:00Z", "2026-11-17T12:15:00Z");
  const flash = twoChecks("z-ai/glm-5.3-flash", "2026-11-17T10:37:00Z", "2026-11-17T10:52:00Z");
  const medium = twoChecks("mistralai/mistral-medium-3", "2026-11-17T10:00:00Z", "2026-11-17T10:15:00Z");
  const qwen = twoChecks("qwen/qwen3.8-27b", "2026-11-17T14:37:00Z", "2026-11-17T14:52:00Z");
  const glm53 = twoChecks("z-ai/glm-5.3", "2026-11-17T12:00:00Z", "2026-11-17T12:15:00Z");
  const v4pro = twoChecks("deepseek/deepseek-v4-pro", "2026-11-17T12:00:00Z", "2026-11-17T12:15:00Z");
  const glm52 = twoChecks("z-ai/glm-5.2", "2026-11-17T12:00:00Z", "2026-11-17T12:15:00Z");
  const horse = twoChecks("alibaba/happyhorse-1.0", "2026-11-17T12:00:00Z", "2026-11-17T12:15:00Z");
  const gpt = twoChecks("openai/gpt-5.4-pro", "2026-11-17T10:00:00Z", "2026-11-17T10:15:00Z");
  const seedance = twoChecks("bytedance/seedance-x", "2026-11-17T10:07:00Z", "2026-11-17T10:22:00Z");

  const relaceStanding = (input, output) => ({
    poolSize: 3,
    input: { cheapest: false, vs: input, tags: ["relace/fp4"], providers: ["Relace"] },
    output: { cheapest: false, vs: output, tags: ["relace/fp4"], providers: ["Relace"] },
  });
  const series = (where, before, after) => [
    { takenAt: where.since, source: "openrouter-api", prices: pricesOf(before) },
    { takenAt: where.at, source: "openrouter-api", prices: pricesOf(after) },
  ];

  const cases = [
    [ab, abModel(), [
      priceChanged(ab, "relace", "Relace", move(1, 0.99), null),
      priceChanged(ab, "baidu", "Baidu", move(1, 0.36), null),
      priceChanged(ab, "novita", "Novita", move(1, 1.3), null),
    ]],
    [ab, abModel(), [
      {
        type: "spread-crossed",
        ...ab,
        input: { from: 2.5, to: 5, low: 0.5, high: 2.5, up: true, cause: "cheapest-fell" },
        output: null,
        up: true,
        cause: "cheapest-fell",
      },
      priceChanged(ab, "alibaba", "Alibaba", move(1, 0.5), null),
      priceChanged(ab, "alibaba/us-east-1", "Alibaba", move(1, 0.5), null),
    ]],
    [{ model: "xiaomi/mimo-v2.6-pro", at: "2026-11-10T17:15:01Z" }, mimoHistory().models, mimoHistory().events],
    [seedance, { [seedance.model]: { name: "ByteDance: Seedance X", outputModalities: video } }, [
      {
        type: "joined",
        ...seedance,
        tag: "fal/video",
        provider: "Fal",
        prompt: null,
        completion: null,
        ratio: null,
        expensive: false,
        cheapestProvider: null,
        cheapestTag: null,
        standing: { poolSize: 1, input: null, output: null },
        priceNotPerToken: true,
      },
    ]],
    [gemma, { [gemma.model]: { name: "Google: Gemma 4 31B", outputModalities: text } }, [
      priceChanged(gemma, "primeintellect/fp8", "PrimeIntellect", move(0.2, 0.155), move(0.335, 0.26)),
    ]],
    [flash, { [flash.model]: { name: "Z.ai: GLM 5.3 Flash", outputModalities: text } }, [
      {
        type: "joined",
        ...flash,
        tag: "baidu/fp8",
        provider: "Baidu",
        prompt: 0.15,
        completion: 0.5,
        ratio: null,
        expensive: false,
        cheapestProvider: "Relace",
        cheapestTag: "relace/fp4",
        standing: relaceStanding(0.15 / 0.0399, 0.5 / 0.0784),
      },
    ]],
    [medium, {
      [medium.model]: {
        name: "Mistral: Mistral Medium 3",
        outputModalities: text,
        series: series(
          medium,
          [["mistral/zdr", "Mistral", 0.4, 2], ["mistral/eu", "Mistral", 0.44, 2.2]],
          [["mistral/eu", "Mistral", 0.44, 2.2]],
        ),
      },
    }, [
      {
        type: "left",
        ...medium,
        tag: "mistral/zdr",
        provider: "Mistral",
        providerStays: true,
        remains: { tag: "mistral/eu", provider: "Mistral" },
        confirmed: true,
      },
    ]],
    [qwen, { [qwen.model]: { name: "Qwen: Qwen3.8 27B", outputModalities: text } }, [
      { type: "left", ...qwen, tag: "io-net/fp8", provider: "Io Net", confirmed: true },
      priceChanged(qwen, "primeintellect/fp8", "PrimeIntellect", move(0.082, 0.104), move(0.586, 0.74)),
    ]],
    [glm53, { [glm53.model]: { name: "Z.ai: GLM 5.3", outputModalities: text } }, [
      priceChanged(glm53, "makora/fp4", "Makora", move(1, 1.5), move(3.6, 2)),
      priceChanged(glm53, "morph/fp8", "Morph", move(1.092, 1.03), move(5.095, 4.804)),
    ]],
    [v4pro, { [v4pro.model]: { name: "DeepSeek: DeepSeek V4 Pro 0423", outputModalities: text } }, [
      {
        type: "cheapest-changed",
        ...v4pro,
        input: {
          from: ["baidu/fp8"],
          to: ["streamlake/fp8"],
          fromProviders: ["Baidu"],
          toProviders: ["StreamLake"],
          toPrice: 0.868608,
          fromNow: 0.87035,
          fromLeft: false,
        },
        output: null,
      },
    ]],
    [glm52, {
      [glm52.model]: {
        name: "Z.ai: GLM 5.2",
        outputModalities: text,
        series: series(
          glm52,
          [["mistral/zdr", "Mistral", 1.4, 4.4], ["mistral/eu", "Mistral", 1.54, 4.84]],
          [["mistral/zdr", "Mistral", 1.4, 4.4], ["mistral/eu", "Mistral", 1.54, 4.84]],
        ),
      },
    }, [
      { type: "quantization-changed", ...glm52, tag: "mistral/zdr", provider: "Mistral", from: "nvfp4", to: "unknown" },
    ]],
    [horse, {
      [horse.model]: { name: "Alibaba: HappyHorse 1.0", outputModalities: video },
      "x/m": { name: "M" },
    }, [
      { type: "model-delisted", ...horse, model: "x/m" },
      { type: "model-listed", ...horse, endpoints: 1 },
    ]],
    [gpt, {
      [gpt.model]: {
        name: "OpenAI: GPT-5.4 Pro",
        series: series(
          gpt,
          [["openai/flex", "OpenAI", 15, 90], ["azure", "Azure", 30, 180], ["openai", "OpenAI", 30, 180]],
          [["azure", "Azure", 30, 180], ["openai", "OpenAI", 30, 180]],
        ),
      },
    }, [
      { type: "left", ...gpt, tag: "openai/flex", provider: "OpenAI", providerStays: true, confirmed: true },
      {
        type: "cheapest-changed",
        ...gpt,
        input: {
          from: ["openai/flex"],
          to: ["azure", "openai"],
          fromProviders: ["OpenAI"],
          toProviders: ["Azure", "OpenAI"],
          toPrice: 30,
          fromNow: null,
          fromLeft: true,
        },
        output: {
          from: ["openai/flex"],
          to: ["azure", "openai"],
          fromProviders: ["OpenAI"],
          toProviders: ["Azure", "OpenAI"],
          toPrice: 180,
          fromNow: null,
          fromLeft: true,
        },
      },
    ]],
  ];

  const titles = expectedTitles.split("\n");
  assert.equal(titles.length, cases.length);
  cases.forEach(([where, models, events], i) => {
    const item = feedItems(historyOf(models, events)).find(
      (it) => it.model === where.model && it.at === where.at,
    );
    assert.equal(item?.title, titles[i], `line ${i + 1}`);
  });
});

test("the delisting and MiMo RSS items", () => {
  const expectedItems = `<item>
<title><![CDATA[Model delisted: Solo (z/solo)]]></title>
<description><![CDATA[<ul><li>No longer in OpenRouter's model list</li></ul><p>Between the snapshots of Nov 16, 09:05 UTC and Nov 17, 06:17 UTC.</p><p><a href="https://openrouter.ai/z/solo">Solo on OpenRouter</a> · <a href="https://example.test/ph/events.html">Pool history</a></p>]]></description>
<link>https://openrouter.ai/z/solo</link>
<guid isPermaLink="false">z/solo-2026-11-17T06:17:00Z</guid>
<pubDate>Tue, 17 Nov 2026 06:17:00 GMT</pubDate>
</item>
<item>
<title><![CDATA[New provider: PrimaLabs on MiMo-V2.6-Pro (xiaomi/mimo-v2.6-pro) · input and output 12x the cheapest (GMICloud) · +3 more changes]]></title>
<description><![CDATA[<ul><li>PrimaLabs (primalabs/fp8) joined at $4.00 / $8.00 per M, input and output 12x the cheapest (GMICloud)</li><li>NovitaAI left</li><li>Price range widened · input $0.326 to $4.00 per M (12x, above 3x) · output $0.652 to $8.00 (12x, above 3x)</li><li>GMICloud (gmicloud/bf16) · input $0.37 to $0.326 per M (-12%) · output $0.74 to $0.652 (-12%) · listed discount 15% to 25% · cheapest on input and output</li></ul><p>Between Oct 27 and Nov 10, both from Wayback Machine copies of the model page, transcribed by hand.</p><p><a href="https://openrouter.ai/xiaomi/mimo-v2.6-pro">Xiaomi: MiMo-V2.6-Pro on OpenRouter</a> · <a href="https://example.test/ph/events.html">Pool history</a></p>]]></description>
<link>https://openrouter.ai/xiaomi/mimo-v2.6-pro</link>
<guid isPermaLink="false">xiaomi/mimo-v2.6-pro-2026-11-10T17:15:01Z</guid>
<pubDate>Tue, 10 Nov 2026 17:15:01 GMT</pubDate>
</item>`;

  const mimo = mimoHistory();
  const solo = {
    type: "model-delisted",
    model: "z/solo",
    at: "2026-11-17T06:17:00Z",
    since: "2026-11-16T09:05:12Z",
    sources: ["openrouter-api", "openrouter-api"],
  };
  const history = historyOf({ ...mimo.models, "z/solo": { name: "Solo" } }, [...mimo.events, solo]);
  const xml = renderFeed(history, { siteUrl: "https://example.test/ph/" });

  for (const item of expectedItems.split(/\n(?=<item>)/)) {
    assert.ok(xml.includes(`${item}\n`), item.split("\n")[1]);
  }
});

test("repeatDynamicRange caps a dynamic provider's 3x-range crossing at one per model in 24 hours", () => {
  const model = "a/b";
  const at = (iso) => ({
    model,
    at: iso,
    since: new Date(Date.parse(iso) - 900_000).toISOString().replace(".000Z", "Z"),
    sources: ["openrouter-api", "openrouter-api"],
  });
  const xMove = (iso, from, to) => priceChanged(at(iso), "x", "X", move(from, to), null);
  const range = (iso, low, up) => ({
    type: "spread-crossed",
    ...at(iso),
    input: { from: up ? 2.94 : 1 / 0.31, to: up ? 1 / low : 2.94, low, high: 1, up, cause: up ? "cheapest-fell" : "pool-changed" },
    output: null,
    up,
    cause: up ? "cheapest-fell" : "pool-changed",
  });
  const events = [
    xMove("2026-11-17T00:00:00Z", 0.41, 0.4),
    xMove("2026-11-17T00:15:00Z", 0.4, 0.39),
    xMove("2026-11-17T00:30:00Z", 0.39, 0.38),
    xMove("2026-11-17T00:45:00Z", 0.38, 0.37),
    xMove("2026-11-17T01:00:00Z", 0.37, 0.36),
    xMove("2026-11-17T01:15:00Z", 0.36, 0.35),
    xMove("2026-11-17T01:30:00Z", 0.35, 0.345),
    xMove("2026-11-17T01:45:00Z", 0.345, 0.34),
    xMove("2026-11-17T02:00:00Z", 0.34, 0.32),
    range("2026-11-17T02:00:00Z", 0.32, true),
    xMove("2026-11-17T02:15:00Z", 0.32, 0.34),
    range("2026-11-17T02:15:00Z", 0.34, false),
    xMove("2026-11-17T03:00:00Z", 0.34, 0.31),
    range("2026-11-17T03:00:00Z", 0.31, true),
    xMove("2026-11-17T03:15:00Z", 0.31, 0.34),
    range("2026-11-17T03:15:00Z", 0.34, false),
    priceChanged(at("2026-11-17T03:30:00Z"), "z", "Z", move(0.5, 0.3), null),
    range("2026-11-17T03:30:00Z", 0.3, true),
    priceChanged(at("2026-11-17T04:00:00Z"), "z", "Z", move(0.3, 0.5), null),
    range("2026-11-17T04:00:00Z", 0.34, false),
    xMove("2026-11-17T22:00:00Z", 0.34, 0.31),
    range("2026-11-17T22:00:00Z", 0.31, true),
    xMove("2026-11-18T01:30:00Z", 0.31, 0.35),
    range("2026-11-18T01:30:00Z", 0.35, false),
    xMove("2026-11-18T01:45:00Z", 0.35, 0.34),
    xMove("2026-11-18T02:00:00Z", 0.34, 0.35),
    xMove("2026-11-18T02:15:00Z", 0.35, 0.34),
    xMove("2026-11-18T02:30:00Z", 0.34, 0.35),
    xMove("2026-11-18T02:45:00Z", 0.35, 0.34),
    xMove("2026-11-18T03:00:00Z", 0.34, 0.35),
    xMove("2026-11-18T03:15:00Z", 0.35, 0.3),
    range("2026-11-18T03:15:00Z", 0.3, true),
  ];
  const history = historyOf({ [model]: { name: "A: B" } }, events);
  const flag = (iso) => feedItems(history).find((it) => it.at === iso).repeatDynamicRange;

  assert.equal(flag("2026-11-17T02:00:00Z"), false, "first crossing by dynamic X");
  assert.equal(flag("2026-11-17T02:15:00Z"), undefined, "narrowing");
  assert.equal(flag("2026-11-17T03:00:00Z"), true, "second crossing by X within 24 hours");
  assert.equal(flag("2026-11-17T03:30:00Z"), undefined, "crossing by non-dynamic Z");
  assert.equal(flag("2026-11-17T22:00:00Z"), true, "crossing by X 20 hours after the first");
  assert.equal(flag("2026-11-18T03:15:00Z"), false, "crossing by X 25 hours after the first, 5 hours after a repeat");

  for (const out of [renderFeed(history), renderJsonFeed(history), renderFeedPage(history)]) {
    assert.equal(out.includes("repeatDynamic"), false);
  }
});

// Provider P changes price at ten checks across three models (dynamic from its
// eighth); Q once, at the last check, where P also becomes the cheapest on m/3.
const pqChecks = [
  "2026-11-17T00:15:00Z", "2026-11-17T00:30:00Z", "2026-11-17T00:45:00Z",
  "2026-11-17T01:00:00Z", "2026-11-17T01:15:00Z", "2026-11-17T01:30:00Z",
  "2026-11-17T01:45:00Z", "2026-11-17T02:00:00Z", "2026-11-17T02:15:00Z",
  "2026-11-17T02:30:00Z",
];

function pqHistory(checks = pqChecks) {
  const where = (model, at) => ({
    model,
    at,
    since: new Date(Date.parse(at) - 900_000).toISOString().replace(".000Z", "Z"),
    sources: ["openrouter-api", "openrouter-api"],
  });
  const pMove = (model, at, i) =>
    priceChanged(where(model, at), "p/fp8", "P", i % 2 ? move(0.11, 0.1) : move(0.1, 0.11), null);
  const events = checks.map((at, i) => [
    pMove("m/1", at, i),
    pMove("m/2", at, i),
    ...(i === 9 ? [priceChanged(where("m/2", at), "q", "Q", move(0.2, 0.3), null)] : []),
    pMove("m/3", at, i),
    ...(i === 9
      ? [{
          type: "cheapest-changed",
          ...where("m/3", at),
          input: { from: ["q"], to: ["p/fp8"], fromProviders: ["Q"], toProviders: ["P"], toPrice: 0.1, fromNow: 0.105, fromLeft: false },
          output: null,
        }]
      : []),
  ]).reverse().flat();
  return historyOf({ "m/1": { name: "M: One" }, "m/2": { name: "M: Two" }, "m/3": { name: "M: Three" } }, events);
}

const pqDropped = [
  "m/1-2026-11-17T02:30:00Z",
  "m/1-2026-11-17T02:15:00Z", "m/2-2026-11-17T02:15:00Z", "m/3-2026-11-17T02:15:00Z",
  "m/1-2026-11-17T02:00:00Z", "m/2-2026-11-17T02:00:00Z", "m/3-2026-11-17T02:00:00Z",
];

test("the feeds leave out items whose only events are a dynamic provider's routine price moves", () => {
  const history = pqHistory();
  assert.equal(history.events.length, 32);
  assert.equal(feedItems(history).length, 30);

  const xml = renderFeed(history);
  const json = JSON.parse(renderJsonFeed(history));
  const html = renderFeedPage(history);

  assert.equal(xml.match(/<item>/g).length, 23);
  assert.equal(json.items.length, 23);
  assert.equal(html.match(/<article class="feed-item"/g).length, 23);
  for (const guid of pqDropped) {
    assert.equal(xml.includes(`>${guid}</guid>`), false, guid);
    assert.equal(json.items.some((it) => it.id === guid), false, guid);
    assert.equal(html.includes(`data-guid="${guid}"`), false, guid);
  }

  // P becoming the cheapest keeps its item; Q's item keeps P's move beside it.
  assert.deepEqual(
    json.items.slice(0, 2).map((it) => [it.id, it._pool_history.events.map((e) => `${e.type} ${e.provider ?? ""}`.trim())]),
    [
      ["m/2-2026-11-17T02:30:00Z", ["price-changed Q", "price-changed P"]],
      ["m/3-2026-11-17T02:30:00Z", ["price-changed P", "cheapest-changed"]],
    ],
  );
  assert.equal(json.items[2].id, "m/1-2026-11-17T01:45:00Z");
  assert.equal(json.items.at(-1).id, "m/3-2026-11-17T00:15:00Z");
});

test("before a provider's eighth changing check the feeds leave nothing out", () => {
  const history = pqHistory(pqChecks.slice(0, 7));
  assert.equal(JSON.parse(renderJsonFeed(history)).items.length, 21);
  assert.equal(renderFeed(history).match(/<item>/g).length, 21);
});

test("the feed page says once, near its top, that routine moves of frequent repricers are left out", () => {
  const html = renderFeedPage(pqHistory());
  const note = '<p class="meta">Routine price moves by providers that reprice many times a day are left out; a move that makes or ends one the cheapest, or pushes a price range past 3x, stays in. <a href="events.html">All changes</a> keeps every move.</p>';
  assert.ok(html.includes(`lists provider changes on existing models.</p>\n${note}\n<div class="hero-actions">`));
  assert.equal(html.split(note).length, 2);
  assert.ok(html.includes('<p class="subtitle">23 items, one per model per snapshot'));
});

test("feedItems keeps every item and Discord's cardWorthy gives the same answers for it", () => {
  const items = feedItems(pqHistory(), { limit: Infinity });
  assert.deepEqual(
    items.filter(cardWorthy).map((it) => it.guid),
    [
      "m/2-2026-11-17T02:30:00Z", "m/3-2026-11-17T02:30:00Z",
      "m/1-2026-11-17T01:45:00Z", "m/2-2026-11-17T01:45:00Z", "m/3-2026-11-17T01:45:00Z",
      "m/1-2026-11-17T01:15:00Z", "m/2-2026-11-17T01:15:00Z", "m/3-2026-11-17T01:15:00Z",
      "m/1-2026-11-17T00:45:00Z", "m/2-2026-11-17T00:45:00Z", "m/3-2026-11-17T00:45:00Z",
      "m/1-2026-11-17T00:15:00Z", "m/2-2026-11-17T00:15:00Z", "m/3-2026-11-17T00:15:00Z",
    ],
  );
  assert.deepEqual(
    items.filter((it) => it.dynamic.length).map((it) => [it.guid, it.dynamic.map((d) => `${d.provider} ${d.checks}/${d.of}`)]),
    [
      ["m/1-2026-11-17T02:30:00Z", ["P 10/10"]],
      ["m/2-2026-11-17T02:30:00Z", ["P 10/10"]],
      ["m/3-2026-11-17T02:30:00Z", ["P 10/10"]],
      ["m/1-2026-11-17T02:15:00Z", ["P 9/9"]],
      ["m/2-2026-11-17T02:15:00Z", ["P 9/9"]],
      ["m/3-2026-11-17T02:15:00Z", ["P 9/9"]],
      ["m/1-2026-11-17T02:00:00Z", ["P 8/8"]],
      ["m/2-2026-11-17T02:00:00Z", ["P 8/8"]],
      ["m/3-2026-11-17T02:00:00Z", ["P 8/8"]],
    ],
  );
  assert.equal(items.find((it) => it.guid === "m/3-2026-11-17T02:30:00Z").repeatDynamicCheapest, false);
});
