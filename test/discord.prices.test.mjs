import test from 'node:test';
import assert from 'node:assert/strict';

import { HistoryBuilder } from '../src/history.mjs';
import { feedItems } from '../src/feed.mjs';
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

const veo = endpoints => ({
  name: 'Google: Veo 3.1',
  listed: { prompt: 0, completion: 0 },
  outputModalities: ['video'],
  inputModalities: ['text', 'image'],
  prices: VEO_PRICES,
  endpoints
});
const gptImage = endpoints => ({
  name: 'OpenAI: GPT Image 2',
  listed: { prompt: 8, completion: 8 },
  outputModalities: ['image'],
  inputModalities: ['text', 'image'],
  endpoints
});
const nanoBanana = endpoints => ({
  name: 'Google: Nano Banana 2 (Gemini 3.1 Flash Image)',
  listed: { prompt: 0.5, completion: 3 },
  outputModalities: ['image', 'text'],
  inputModalities: ['image', 'text'],
  endpoints
});
const snapshot = (takenAt, models) => ({
  takenAt, source: 'openrouter-api', partial: false, note: null, modelCount: Object.keys(models).length, models
});

function cards() {
  const builder = new HistoryBuilder();
  builder.add(snapshot('2026-11-17T23:00:00Z', {
    'google/veo-3.1': veo([endpoint('google-vertex', 'Google', 0, 0)]),
    'openai/gpt-image-2': gptImage([endpoint('openai', 'OpenAI', 8, 8, { prices: GPT_IMAGE_PRICES })]),
    'google/gemini-3.1-flash-image': nanoBanana([endpoint('google-ai-studio', 'Google AI Studio', 0.5, 3)])
  }));
  builder.add(snapshot('2026-11-17T23:15:00Z', {
    'google/veo-3.1': veo([
      endpoint('google-vertex', 'Google', 0, 0),
      endpoint('atlas-cloud', 'AtlasCloud', 0, 0)
    ]),
    'openai/gpt-image-2': gptImage([
      endpoint('openai', 'OpenAI', 8, 8, { prices: GPT_IMAGE_PRICES }),
      endpoint('azure', 'Azure', 8, 8, {
        prices: { ...GPT_IMAGE_PRICES, 'output_image:token': { unit: 'output-image-tokens', usd: 32 } }
      })
    ]),
    'google/gemini-3.1-flash-image': nanoBanana([
      endpoint('google-ai-studio', 'Google AI Studio', 0.5, 3),
      endpoint('google-vertex/global', 'Google', 1, 6)
    ])
  }));
  const items = feedItems(builder.finish(), { siteUrl: 'https://example.test/ph/' });
  return Object.fromEntries(items.map(item => [item.model, toMessage(item, { routeButton: true })]));
}

const links = model => [{
  type: 1,
  components: [
    { type: 2, style: 5, label: 'View on OpenRouter', url: `https://openrouter.ai/${model}` },
    { type: 2, style: 5, label: 'Pool history', url: 'https://example.test/ph/events.html' }
  ]
}];

test('a video model that gained a provider lists its prices per second, one line each', () => {
  assert.deepEqual(cards()['google/veo-3.1'], {
    embeds: [{
      color: 13172480,
      author: { name: '📺 Video model · New provider' },
      title: 'Google: Veo 3.1',
      url: 'https://openrouter.ai/google/veo-3.1',
      fields: [
        { name: 'Joined', value: '[AtlasCloud](https://openrouter.ai/provider/atlas-cloud)' },
        {
          name: 'Prices',
          value: '$0.40 per second with audio\n$0.60 per second with audio (4K)\n$0.20 per second without audio\n$0.40 per second without audio (4K)'
        }
      ],
      footer: { text: 'Model id: google/veo-3.1 · Prices in USD, per the unit on each line' },
      timestamp: '2026-11-17T23:15:00Z'
    }],
    components: links('google/veo-3.1'),
    allowed_mentions: { parse: [] }
  });
});

test('an image model that gained a provider names the newcomer\'s own prices and every provider\'s', () => {
  assert.deepEqual(cards()['openai/gpt-image-2'], {
    embeds: [{
      color: 13172480,
      author: { name: '📷 Image model · New provider' },
      title: 'OpenAI: GPT Image 2',
      url: 'https://openrouter.ai/openai/gpt-image-2',
      fields: [
        {
          name: 'Joined',
          value: '[Azure](https://openrouter.ai/provider/azure) · $8.00 per million input image tokens, $5.00 per million input text tokens, $32.00 per million output image tokens'
        },
        {
          name: 'Prices',
          value: '[OpenAI](https://openrouter.ai/provider/openai) · $8.00 per million input image tokens, $5.00 per million input text tokens, $30.00 per million output image tokens\n[Azure](https://openrouter.ai/provider/azure) · $8.00 per million input image tokens, $5.00 per million input text tokens, $32.00 per million output image tokens'
        }
      ],
      footer: { text: 'Model id: openai/gpt-image-2 · Prices in USD, per the unit on each line' },
      timestamp: '2026-11-17T23:15:00Z'
    }],
    components: links('openai/gpt-image-2'),
    allowed_mentions: { parse: [] }
  });
});

test('a text-and-image model keeps the per-token card with its Test request button', () => {
  assert.deepEqual(cards()['google/gemini-3.1-flash-image'], {
    embeds: [{
      color: 13172480,
      author: { name: '📝📷 Text and image model · New provider' },
      title: 'Google: Nano Banana 2 (Gemini 3.1 Flash Image)',
      url: 'https://openrouter.ai/google/gemini-3.1-flash-image',
      description: '[Google](https://openrouter.ai/provider/google-vertex) joined at $1.00 in / $6.00 out',
      fields: [
        { name: 'Input /M', value: '**$1.00**\n2x the cheapest', inline: true },
        { name: 'Output /M', value: '**$6.00**\n2x the cheapest', inline: true },
        { name: '​', value: '​', inline: true },
        { name: 'Cheapest input', value: '[Google AI Studio](https://openrouter.ai/provider/google-ai-studio) · $0.50', inline: true },
        { name: 'Cheapest output', value: '[Google AI Studio](https://openrouter.ai/provider/google-ai-studio) · $3.00', inline: true },
        { name: 'Lowest in + out', value: '[Google AI Studio](https://openrouter.ai/provider/google-ai-studio) · $3.50\n$0.50 + $3.00', inline: true }
      ],
      footer: { text: 'Model id: google/gemini-3.1-flash-image · Prices in USD per million tokens (/M)' },
      timestamp: '2026-11-17T23:15:00Z'
    }],
    components: [{
      type: 1,
      components: [
        { type: 2, style: 1, custom_id: 'route', label: 'Test request' },
        ...links('google/gemini-3.1-flash-image')[0].components
      ]
    }],
    allowed_mentions: { parse: [] }
  });
});

test('an image or video model with nothing listed keeps the plain not-listed line', () => {
  const builder = new HistoryBuilder();
  const bare = { ...veo([endpoint('google-vertex', 'Google', 0, 0)]), prices: {} };
  builder.add(snapshot('2026-11-17T23:00:00Z', { 'google/veo-3.1': bare }));
  builder.add(snapshot('2026-11-17T23:15:00Z', {
    'google/veo-3.1': { ...bare, endpoints: [...bare.endpoints, endpoint('fal', 'Fal', 0, 0)] }
  }));
  const [item] = feedItems(builder.finish());
  const [embed] = toMessage(item, { routeButton: true }).embeds;
  assert.deepEqual(embed.fields, [
    { name: 'Joined', value: 'Fal' },
    { name: 'Prices', value: 'Price not listed ([see OpenRouter](https://openrouter.ai/google/veo-3.1))' }
  ]);
  assert.equal(embed.footer.text, 'Model id: google/veo-3.1');
});
