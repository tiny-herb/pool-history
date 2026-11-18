import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MODEL_TYPES,
  NOT_PER_TOKEN,
  modelTypeLabel,
  perTokenPriced,
} from '../src/model-types.mjs';

test('MODEL_TYPES contains the catalogue output modality table', () => {
  assert.deepEqual(MODEL_TYPES, {
    text: ['📝', 'Text'],
    video: ['📺', 'Video'],
    image: ['📷', 'Image'],
    audio: ['🔊', 'Audio'],
    speech: ['🗣️', 'Speech'],
    transcription: ['🎙️', 'Transcription'],
    embeddings: ['🔢', 'Embeddings'],
    rerank: ['↕️', 'Rerank'],
    decisions: ['⚖️', 'Decision'],
  });
});

test('NOT_PER_TOKEN is the exact not-per-token message', () => {
  assert.equal(
    NOT_PER_TOKEN,
    'Price not listed per token (see OpenRouter)',
  );
});

test('modelTypeLabel returns the expected labels', () => {
  const examples = [
    [['text'], '📝 Text model'],
    [['video'], '📺 Video model'],
    [['image'], '📷 Image model'],
    [['text', 'image'], '📝📷 Text and image model'],
    [['audio'], '🔊 Audio model'],
    [['speech'], '🗣️ Speech model'],
    [['transcription'], '🎙️ Transcription model'],
    [['embeddings'], '🔢 Embeddings model'],
    [['embedding'], '🔢 Embeddings model'],
    [['rerank'], '↕️ Rerank model'],
    [['decisions'], '⚖️ Decision model'],
    [['image', 'text', 'audio'], '📝📷🔊 Text, image and audio model'],
    [['text', 'audio', 'image'], '📝📷🔊 Text, image and audio model'],
    [['hologram'], 'Hologram model'],
    [[], null],
    [null, null],
  ];

  for (const [outputs, expected] of examples) {
    assert.equal(modelTypeLabel(outputs), expected, JSON.stringify(outputs));
  }
});

test('modelTypeLabel orders known modalities by the fixed table order', () => {
  assert.equal(
    modelTypeLabel(['decisions', 'rerank', 'transcription', 'speech', 'audio', 'image', 'video', 'text']),
    '📝📺📷🔊🗣️🎙️↕️⚖️ Text, video, image, audio, speech, transcription, rerank and decision model',
  );
});

test('modelTypeLabel names unknown modalities without an emoji', () => {
  assert.equal(modelTypeLabel(['hologram']), 'Hologram model');
  assert.equal(modelTypeLabel(['Hologram']), 'Hologram model');
});

test('perTokenPriced treats unknown or absent outputs as text-priced', () => {
  assert.equal(perTokenPriced(null), true);
  assert.equal(perTokenPriced([]), true);
  assert.equal(perTokenPriced(['hologram']), true);
  assert.equal(perTokenPriced(['text']), true);
});

test('perTokenPriced is false when every known output modality is non-text', () => {
  assert.equal(perTokenPriced(['video']), false);
  assert.equal(perTokenPriced(['image']), false);
  assert.equal(perTokenPriced(['audio']), false);
  assert.equal(perTokenPriced(['speech']), false);
  assert.equal(perTokenPriced(['transcription']), false);
  assert.equal(perTokenPriced(['embeddings']), false);
  assert.equal(perTokenPriced(['embedding']), false);
  assert.equal(perTokenPriced(['rerank']), false);
  assert.equal(perTokenPriced(['decisions']), false);
});

test('perTokenPriced treats text and unknown modalities as per-token priced', () => {
  assert.equal(perTokenPriced(['text', 'image']), true);
  assert.equal(perTokenPriced(['image', 'text', 'audio']), true);
  assert.equal(perTokenPriced(['text', 'hologram']), true);
});

// The full card for a video model that gained a provider, verbatim.
const VIDEO_CARD = {
  "embeds": [
    {
      "color": 13172480,
      "author": {"name":"📺 Video model · New provider"},
      "title": "ByteDance: Seedance 2.5 Flash",
      "url": "https://openrouter.ai/bytedance/seedance-2.5-flash",
      "fields": [
        {"name":"Joined","value":"Fal"},
        {
          "name": "Prices",
          "value": "Price not listed per token ([see OpenRouter](https://openrouter.ai/bytedance/seedance-2.5-flash))"
        }
      ],
      "footer": {"text":"Model id: bytedance/seedance-2.5-flash"},
      "timestamp": "2026-11-17T10:22:00Z"
    }
  ],
  "components": [
    {
      "type": 1,
      "components": [
        {
          "type": 2,
          "style": 5,
          "label": "View on OpenRouter",
          "url": "https://openrouter.ai/bytedance/seedance-2.5-flash"
        }
      ]
    }
  ],
  "allowed_mentions": {"parse":[]}
};

// A full card naming a dynamic provider, verbatim.
const DYNAMIC_CARD = {
  "embeds": [
    {
      "color": 13172480,
      "author": {"name":"📝 Text model · New provider · Price increase · New cheapest provider"},
      "title": "Google: Gemma 4 31B",
      "url": "https://openrouter.ai/google/gemma-4-31b-it",
      "fields": [
        {
          "name": "Joined",
          "value": "[ModelRun](https://openrouter.ai/provider/modelrun) · $0.75 in / $1.00 out per M · input 7.5x, output 10x the cheapest"
        },
        {
          "name": "Prices",
          "value": "[PrimeIntellect](https://openrouter.ai/provider/primeintellect) ↑ · input $0.096 to $0.109 per M (+14%) · output $0.161 to $0.182 (+13%) · input 1.1x, output 1.8x the cheapest"
        },
        {
          "name": "Cheapest",
          "value": "Input: [CoreWeave](https://openrouter.ai/provider/coreweave) and [KT](https://openrouter.ai/provider/kt), tied, at $0.10 per M\nInput before: [PrimeIntellect](https://openrouter.ai/provider/primeintellect) (now $0.109 per M)\nOutput: [Modal](https://openrouter.ai/provider/modal) at $0.10 per M\nLowest input + output: [PrimeIntellect](https://openrouter.ai/provider/primeintellect) at $0.291 per M ($0.109 + $0.182)"
        },
        {
          "name": "Frequent repricing",
          "value": "PrimeIntellect changed its price at 26 of the last 28 checks (one check every 15 minutes). Its range on this model over the last 24 hours: input $0.073 to $0.20, output $0.122 to $0.335 per M"
        },
        {
          "name": "Cap your spend",
          "value": "Set [`max_price`](https://openrouter.ai/docs/guides/routing/provider-selection#max-price) to keep requests off endpoints above your limit · [See how routing works →](https://openrouter.ai/docs/guides/routing/provider-selection)"
        }
      ],
      "footer": {"text":"Model id: google/gemma-4-31b-it · Prices in USD per million tokens (/M)"},
      "timestamp": "2026-11-17T01:17:10Z"
    }
  ],
  "components": [
    {
      "type": 1,
      "components": [
        {"type":2,"style":1,"custom_id":"route","label":"Test request"},
        {
          "type": 2,
          "style": 5,
          "label": "View on OpenRouter",
          "url": "https://openrouter.ai/google/gemma-4-31b-it"
        }
      ]
    }
  ],
  "allowed_mentions": {"parse":[]}
};

test('video card example: model type label opens the author line and the price line is NOT_PER_TOKEN with the link', () => {
  const [embed] = VIDEO_CARD.embeds;
  assert.equal(embed.author.name.split(' · ')[0], modelTypeLabel(['video']));
  assert.equal(perTokenPriced(['video']), false);
  const prices = embed.fields.find((field) => field.name === 'Prices').value;
  assert.equal(
    prices,
    NOT_PER_TOKEN.replace('(see OpenRouter)', `([see OpenRouter](${embed.url}))`),
  );
});

test('dynamic provider card example: text model label opens the author line and prices are per token', () => {
  const [embed] = DYNAMIC_CARD.embeds;
  assert.equal(embed.author.name.split(' · ')[0], modelTypeLabel(['text']));
  assert.equal(perTokenPriced(['text']), true);
  const prices = embed.fields.find((field) => field.name === 'Prices').value;
  assert.ok(!prices.startsWith(NOT_PER_TOKEN.split(' (')[0]));
});

test('model type labels build the expected card author lines', () => {
  assert.equal(
    `${modelTypeLabel(['video'])} · New provider`,
    '📺 Video model · New provider',
  );
  assert.equal(
    `${modelTypeLabel(['text'])} · New provider · Price increase · New cheapest provider`,
    '📝 Text model · New provider · Price increase · New cheapest provider',
  );
});
