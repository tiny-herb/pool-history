import test from 'node:test';
import assert from 'node:assert/strict';

import { HistoryBuilder } from '../src/history.mjs';
import { feedItems, renderFeed, renderJsonFeed, renderFeedPage } from '../src/feed.mjs';
import { eventRow } from '../src/render.mjs';
import { toMessage } from '../src/discord.mjs';

const endpoint = (tag, provider, prompt, completion, extra = {}) => ({
  tag, provider, prompt, completion, discount: 0, context: 0, quantization: 'unknown', status: 0,
  uptime30m: null, uptime1d: 100, uptimePage: null, latency30m: null, throughput30m: null, ...extra
});

const VEO_PRICES = {
  duration_seconds_with_audio: { unit: 'second-with-audio', usd: 0.4 },
  duration_seconds_with_audio_4k: { unit: 'second-with-audio', usd: 0.6, detail: '4K' },
  duration_seconds_without_audio: { unit: 'second-without-audio', usd: 0.2 },
  duration_seconds_without_audio_4k: { unit: 'second-without-audio', usd: 0.4, detail: '4K' }
};

const GPT_IMAGE_PRICES = {
  'input_image:token': { unit: 'input-image-tokens', usd: 8 },
  'input_text:token': { unit: 'input-text-tokens', usd: 5 },
  'output_image:token': { unit: 'output-image-tokens', usd: 30 }
};

const veo = prices => ({
  name: 'Google: Veo 3.1',
  listed: { prompt: 0, completion: 0 },
  outputModalities: ['video'],
  inputModalities: ['text', 'image'],
  prices,
  endpoints: [endpoint('google-vertex', 'Google', 0, 0)]
});
const gptImage = prices => ({
  name: 'OpenAI: GPT Image 2',
  listed: { prompt: 8, completion: 8 },
  outputModalities: ['image'],
  inputModalities: ['text', 'image'],
  endpoints: [endpoint('openai', 'OpenAI', 8, 8, { prices })]
});
const snapshot = (takenAt, models) => ({
  takenAt, source: 'openrouter-api', partial: false, note: null, modelCount: Object.keys(models).length, models
});

function history() {
  const builder = new HistoryBuilder();
  builder.add(snapshot('2026-11-17T23:00:00Z', {
    'google/veo-3.1': veo(VEO_PRICES),
    'openai/gpt-image-2': gptImage(GPT_IMAGE_PRICES)
  }));
  builder.add(snapshot('2026-11-17T23:15:00Z', {
    'google/veo-3.1': veo({ ...VEO_PRICES, duration_seconds_with_audio: { unit: 'second-with-audio', usd: 0.5 } }),
    'openai/gpt-image-2': gptImage({ ...GPT_IMAGE_PRICES, 'output_image:token': { unit: 'output-image-tokens', usd: 40 } })
  }));
  return builder.finish();
}

const VIDEO_SENTENCE = 'Model price · $0.40 to $0.50 per second with audio (+25%)';
const IMAGE_SENTENCE = 'OpenAI · $30.00 to $40.00 per million output image tokens (+33%)';
const VIDEO_TITLE = '📺 Video model · Price increase: Veo 3.1 (google/veo-3.1) · per second with audio +25%';
const IMAGE_TITLE = '📷 Image model · Price increase: OpenAI on GPT Image 2 (openai/gpt-image-2) · per million output image tokens +33%';

test('a video SKU change and an image price change read with their units in feed.xml', () => {
  const xml = renderFeed(history(), { siteUrl: 'https://example.test/ph/' });
  assert.ok(xml.includes(`<title><![CDATA[${VIDEO_TITLE}]]></title>`));
  assert.ok(xml.includes(`<title><![CDATA[${IMAGE_TITLE}]]></title>`));
  assert.ok(xml.includes(`<ul><li>${VIDEO_SENTENCE}</li></ul>`));
  assert.ok(xml.includes(`<ul><li>${IMAGE_SENTENCE}</li></ul>`));
});

test('feed.json carries the moves and the sentence', () => {
  const items = JSON.parse(renderJsonFeed(history(), { siteUrl: 'https://example.test/ph/' })).items;
  const video = items.find(item => item.id === 'google/veo-3.1-2026-11-17T23:15:00Z');
  const image = items.find(item => item.id === 'openai/gpt-image-2-2026-11-17T23:15:00Z');
  assert.equal(video.title, VIDEO_TITLE);
  assert.equal(image.title, IMAGE_TITLE);
  assert.deepEqual(video._pool_history.events, [{
    type: 'price-changed',
    moves: [{ key: 'duration_seconds_with_audio', unit: 'second-with-audio', from: 0.4, to: 0.5, change: 0.25 }],
    change: null,
    direction: 'up',
    up: true,
    major: true,
    sentence: VIDEO_SENTENCE
  }]);
  assert.equal(image._pool_history.events[0].sentence, IMAGE_SENTENCE);
  assert.deepEqual(image._pool_history.events[0].moves, [{
    key: 'output_image:token', unit: 'output-image-tokens', from: 30, to: 40, change: 0.33333333333333326
  }]);
});

test('feed.html and the site rows show the same sentences', () => {
  const h = history();
  const page = renderFeedPage(h);
  assert.ok(page.includes(`<li><span class="pill pill-negative">price increase · 25%+</span><span>${VIDEO_SENTENCE}</span></li>`));
  assert.ok(page.includes(`<li><span class="pill pill-negative">price increase · 25%+</span><span>${IMAGE_SENTENCE}</span></li>`));

  const rows = h.events.map(e => eventRow(e));
  assert.ok(rows.some(row => row.includes(`<span class="what">${VIDEO_SENTENCE}</span>`)));
  assert.ok(rows.some(row => row.includes(`<span class="what">${IMAGE_SENTENCE}</span>`)));
});

test('Discord lists the move and the prices after it', () => {
  const items = feedItems(history());
  const video = toMessage(items.find(item => item.model === 'google/veo-3.1')).embeds[0];
  const image = toMessage(items.find(item => item.model === 'openai/gpt-image-2')).embeds[0];

  assert.equal(video.author.name, '📺 Video model · Price increase');
  assert.deepEqual(video.fields, [
    { name: 'Price changes', value: 'Model price ↑ · $0.40 to $0.50 per second with audio (+25%)' },
    {
      name: 'Prices',
      value: '$0.50 per second with audio\n$0.60 per second with audio (4K)\n$0.20 per second without audio\n$0.40 per second without audio (4K)'
    }
  ]);
  assert.deepEqual(image.fields, [
    { name: 'Price changes', value: '[OpenAI](https://openrouter.ai/provider/openai) ↑ · $30.00 to $40.00 per million output image tokens (+33%)' },
    {
      name: 'Prices',
      value: '$8.00 per million input image tokens\n$5.00 per million input text tokens\n$40.00 per million output image tokens'
    }
  ]);
});

test('a model with no per-token price has no cheapest and no range event', () => {
  assert.deepEqual(
    history().events.map(e => e.type),
    ['price-changed', 'price-changed']
  );
  for (const item of feedItems(history())) assert.equal(item.cheapest, null);
});
