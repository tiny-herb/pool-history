import test from 'node:test';
import assert from 'node:assert/strict';

import { HistoryBuilder } from '../src/history.mjs';
import { feedItems, renderFeed, renderJsonFeed, renderFeedPage } from '../src/feed.mjs';
import { renderEvents } from '../src/render.mjs';
import { toMessage } from '../src/discord.mjs';
import { eventSentence } from '../src/events.mjs';

const endpoint = (tag, provider, prompt, extra = {}) => ({
  tag, provider, prompt, completion: 0, discount: 0, context: 4096, quantization: 'unknown', status: 0,
  uptime30m: 100, uptime1d: 100, uptimePage: null, latency30m: null, throughput30m: null, ...extra
});
const UNLISTED = { unit: null, value: 0, unlisted: true };
const listed = value => ({ prices: { prompt: { unit: null, value }, completion: UNLISTED } });
const kokoro = endpoints => ({
  name: 'hexgrad: Kokoro 82M',
  listed: { prompt: 0.62, completion: 0 },
  outputModalities: ['speech'],
  inputModalities: ['text'],
  endpoints
});
const snapshot = (takenAt, models) => ({
  takenAt, source: 'openrouter-api', partial: false, note: null, modelCount: Object.keys(models).length, models
});
const SITE = 'https://example.test/ph/';

// A snapshot taken before these prices were recorded holds per-token numbers only.
function history() {
  const builder = new HistoryBuilder();
  builder.add(snapshot('2026-11-17T20:56:00Z', {
    'hexgrad/kokoro-82m': kokoro([endpoint('deepinfra/us', 'DeepInfra', 0.62)])
  }));
  builder.add(snapshot('2026-11-17T23:30:00Z', {
    'hexgrad/kokoro-82m': kokoro([endpoint('deepinfra/us', 'DeepInfra', 0.62, listed(0.00000062))])
  }));
  builder.add(snapshot('2026-11-17T23:45:00Z', {
    'hexgrad/kokoro-82m': kokoro([endpoint('deepinfra/us', 'DeepInfra', 0.7, listed(0.0000007))])
  }));
  return builder.finish();
}

test('the first snapshot with listed prices after one without them reports no price change', () => {
  const builder = new HistoryBuilder();
  builder.add(snapshot('2026-11-17T20:56:00Z', {
    'hexgrad/kokoro-82m': kokoro([endpoint('deepinfra/us', 'DeepInfra', 0.62)])
  }));
  builder.add(snapshot('2026-11-17T23:30:00Z', {
    'hexgrad/kokoro-82m': kokoro([
      endpoint('deepinfra/us', 'DeepInfra', 0.62, listed(0.00000062)),
      endpoint('together', 'Together', 4, listed(0.000004))
    ])
  }));
  const h = builder.finish();
  assert.deepEqual(h.events.map(e => [e.type, eventSentence(e)]), [
    ['joined', 'Together joined at prompt 0.000004 (as listed)']
  ]);
  assert.deepEqual(h.models['hexgrad/kokoro-82m'].latest.endpoints[0].prices, {
    prompt: { unit: null, value: 0.00000062 },
    completion: UNLISTED
  });
});

test('a listed price that moves between two snapshots is reported on every surface', () => {
  const h = history();
  const sentence = 'DeepInfra (deepinfra/us) · prompt 0.00000062 to 0.0000007 (+13%, as listed)';
  const title = '🗣️ Speech model · Price increase: DeepInfra on Kokoro 82M (hexgrad/kokoro-82m) · prompt +13%';

  assert.deepEqual(h.events.map(e => e.type), ['price-changed']);
  assert.deepEqual(h.events[0].moves, [{ key: 'prompt', unit: null, from: 0.00000062, to: 0.0000007, change: 0.0000007 / 0.00000062 - 1 }]);

  const [item] = feedItems(h, { siteUrl: SITE });
  assert.equal(item.title, title);
  assert.ok(renderFeed(h, { siteUrl: SITE }).includes(`<title><![CDATA[${title}]]></title>\n<description><![CDATA[<ul><li>${sentence}</li></ul>`));
  const [jsonItem] = JSON.parse(renderJsonFeed(h, { siteUrl: SITE })).items;
  assert.equal(jsonItem.title, title);
  assert.equal(jsonItem._pool_history.events[0].sentence, sentence);
  assert.ok(renderFeedPage(h).includes(`<span>${sentence}</span>`));
  assert.ok(renderEvents(h).includes(`<span class="what">${sentence}</span>`));

  const [embed] = toMessage(item).embeds;
  assert.equal(embed.author.name, '🗣️ Speech model · Price increase');
  assert.deepEqual(embed.fields, [
    { name: 'Price changes', value: '[DeepInfra](https://openrouter.ai/provider/deepinfra) ↑ · prompt 0.00000062 to 0.0000007 (+13%, as listed)' },
    { name: 'Prices', value: 'prompt 0.0000007 (as listed)' }
  ]);
});

test('a price the list starts giving reads now listed, never as a rise from $0.00', () => {
  const builder = new HistoryBuilder();
  const rerank = prices => ({
    name: 'Cohere: Rerank v3.5',
    listed: null,
    outputModalities: ['rerank'],
    inputModalities: ['text'],
    endpoints: [endpoint('cohere', 'Cohere', 0, { prices })]
  });
  builder.add(snapshot('2026-11-17T23:30:00Z', { 'cohere/rerank-v3.5': rerank({ prompt: UNLISTED, completion: UNLISTED }) }));
  builder.add(snapshot('2026-11-17T23:45:00Z', {
    'cohere/rerank-v3.5': rerank({ prompt: { unit: null, value: 0.00000002 }, completion: UNLISTED })
  }));
  const [item] = feedItems(builder.finish());
  assert.equal(item.title, '↕️ Rerank model · Price change: Cohere on Rerank v3.5 (cohere/rerank-v3.5) · prompt now listed');
  assert.equal(eventSentence(item.events[0]), 'Cohere · prompt 0.00000002 (as listed), now listed');
});

// Two embeddings snapshots: Cohere's prices listed, then 0 for both (or the other way round).
function embedHistory(first, second) {
  const embed = prices => ({
    name: 'Cohere: Embed 5 Fast',
    listed: null,
    outputModalities: ['embeddings'],
    inputModalities: ['text', 'image'],
    endpoints: [endpoint('cohere', 'Cohere', 0.08, { prices })]
  });
  const builder = new HistoryBuilder();
  builder.add(snapshot('2026-11-17T23:30:00Z', { 'cohere/embed-5-fast': embed(first) }));
  builder.add(snapshot('2026-11-17T23:45:00Z', { 'cohere/embed-5-fast': embed(second) }));
  return builder.finish();
}
const EMBED_LISTED = {
  prompt: { unit: 'input-tokens', usd: 0.08 },
  completion: UNLISTED,
  image_token: { unit: 'input-image-tokens', usd: 0.4 }
};
const EMBED_ZERO = {
  prompt: { unit: 'input-tokens', usd: 0, unlisted: true },
  completion: UNLISTED,
  image_token: { unit: 'input-image-tokens', usd: 0, unlisted: true }
};

test('an embeddings price the list stops giving reads no longer listed on every surface', () => {
  const h = embedHistory(EMBED_LISTED, EMBED_ZERO);
  const sentence = 'Cohere · $0.08 per million input tokens, no longer listed · $0.40 per million input image tokens, no longer listed';
  const title = '🔢 Embeddings model · Price change: Cohere on Embed 5 Fast (cohere/embed-5-fast) · per million input tokens no longer listed, per million input image tokens no longer listed';
  const [item] = feedItems(h, { siteUrl: SITE });
  assert.equal(item.title, title);
  assert.ok(renderFeed(h, { siteUrl: SITE }).includes(`<li>${sentence}</li>`));
  assert.equal(JSON.parse(renderJsonFeed(h, { siteUrl: SITE })).items[0]._pool_history.events[0].sentence, sentence);
  assert.ok(renderFeedPage(h).includes(`<span>${sentence}</span>`));
  assert.ok(renderEvents(h).includes(`<span class="what">${sentence}</span>`));
  assert.deepEqual(toMessage(item).embeds[0].fields, [
    { name: 'Price changes', value: '[Cohere](https://openrouter.ai/provider/cohere) · $0.08 per million input tokens, no longer listed · $0.40 per million input image tokens, no longer listed' },
    { name: 'Prices', value: 'Price not listed ([see OpenRouter](https://openrouter.ai/cohere/embed-5-fast))' }
  ]);
});

test('an embeddings price the list starts giving reads now listed on the card', () => {
  const [item] = feedItems(embedHistory(EMBED_ZERO, EMBED_LISTED));
  assert.equal(item.title, '🔢 Embeddings model · Price change: Cohere on Embed 5 Fast (cohere/embed-5-fast) · per million input tokens now listed, per million input image tokens now listed');
  assert.deepEqual(toMessage(item).embeds[0].fields, [
    { name: 'Price changes', value: '[Cohere](https://openrouter.ai/provider/cohere) · $0.08 per million input tokens, now listed · $0.40 per million input image tokens, now listed' },
    { name: 'Prices', value: '$0.08 per million input tokens\n$0.40 per million input image tokens' }
  ]);
});
