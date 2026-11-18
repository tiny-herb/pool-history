import test from 'node:test';
import assert from 'node:assert/strict';
import { eventSentence, priceParts, rangeSides, rangeText, standingText, tiedText } from '../src/events.mjs';

// Full Discord cards. discord.mjs frames each line (links, arrows,
// tier notes, "in / out" prices); these tests hold the card's field values verbatim and assert
// only the phrase this file returns for the card's own input event.

// A Prices line: the price parts, then the standing without names (the Cheapest field names it).
const pricePhrase = (e) => [...priceParts({ ...e, standing: null }), standingText(e.standing, null)]
  .filter(Boolean)
  .join(' · ');

const link = (provider, slug) => `[${provider}](https://openrouter.ai/provider/${slug})`;

const cards = [
  {
    card: 'a price cut and a mixed move on one model',
    events: [
      { type: 'price-changed', tag: 'makora/fp4', provider: 'Makora', prompt: { from: 1, to: 1.5, change: 0.5 }, completion: { from: 3.6, to: 2, change: -0.4444444444 }, standing: { poolSize: 49, input: { cheapest: false, vs: 21.45922747, tags: ['wafer/us'], providers: ['Wafer'] }, output: { cheapest: false, vs: 1.428571429, tags: ['wafer/fp4', 'wafer/us'], providers: ['Wafer', 'Wafer'] } } },
      { type: 'price-changed', tag: 'morph/fp8', provider: 'Morph', prompt: { from: 1.092, to: 1.03, change: -0.05677655678 }, completion: { from: 5.095, to: 4.804, change: -0.05711481845 }, standing: { poolSize: 49, input: { cheapest: false, vs: 14.73533619, tags: ['wafer/us'], providers: ['Wafer'] }, output: { cheapest: false, vs: 3.431428571, tags: ['wafer/fp4', 'wafer/us'], providers: ['Wafer', 'Wafer'] } } },
    ],
    fields: {
      Prices: "[Makora](https://openrouter.ai/provider/makora) · input $1.00 to $1.50 per M (+50%) · output $3.60 to $2.00 (-44%) · input 21x, output 1.4x the cheapest\n[Morph](https://openrouter.ai/provider/morph) ↓ · input $1.09 to $1.03 per M (-6%) · output $5.09 to $4.80 (-6%) · input 15x, output 3.4x the cheapest",
      Cheapest: "Input: [Wafer](https://openrouter.ai/provider/wafer) (wafer/us) at $0.0699 per M\nOutput: [Wafer](https://openrouter.ai/provider/wafer), 2 endpoints (wafer/fp4, wafer/us), at $1.40 per M\nLowest input + output: [Wafer](https://openrouter.ai/provider/wafer) (wafer/us) at $1.47 per M ($0.0699 + $1.40)",
    },
    ties: [[1, [{ label: link('Wafer', 'wafer'), provider: 'Wafer', tag: 'wafer/fp4' }, { label: link('Wafer', 'wafer'), provider: 'Wafer', tag: 'wafer/us' }], '$1.40 per M']],
  },
  {
    card: 'a join and a price cut, with a "Changed between" line',
    events: [
      { type: 'joined', tag: 'io-net/fp8', provider: 'Io Net', prompt: 0.1, completion: 1.8, standing: { poolSize: 24, input: { cheapest: false, vs: 2.857142857, tags: ['darkbloom/fp4'], providers: ['Darkbloom'] }, output: { cheapest: false, vs: 4.285714286, tags: ['primeintellect/fp8'], providers: ['PrimeIntellect'] } } },
      { type: 'price-changed', tag: 'primeintellect/fp8', provider: 'PrimeIntellect', prompt: { from: 0.073, to: 0.059, change: -0.1917808219 }, completion: { from: 0.522, to: 0.42, change: -0.1954022989 }, standing: { poolSize: 24, input: { cheapest: false, vs: 1.685714286, tags: ['darkbloom/fp4'], providers: ['Darkbloom'] }, output: { cheapest: true, vs: null, tags: ['streamlake'], providers: ['StreamLake'] } } },
    ],
    fields: {
      Joined: "[Io Net](https://openrouter.ai/provider/io-net) · $0.10 in / $1.80 out per M · input 2.9x, output 4.3x the cheapest",
      Prices: "[PrimeIntellect](https://openrouter.ai/provider/primeintellect) ↓ · input $0.073 to $0.059 per M (-19%) · output $0.522 to $0.42 (-20%) · cheapest output; input 1.7x the cheapest",
    },
  },
  {
    card: 'four kinds of change dated by archived OpenRouter pages',
    events: [
      { type: 'joined', tag: 'primalabs/fp8', provider: 'PrimaLabs', prompt: 4, completion: 8, standing: { poolSize: 5, input: { cheapest: false, vs: 12.25865768, tags: ['gmicloud/bf16'], providers: ['GMICloud'] }, output: { cheapest: false, vs: 12.2605364, tags: ['gmicloud/bf16'], providers: ['GMICloud'] } } },
      { type: 'left', tag: 'novitaai', provider: 'NovitaAI' },
      { type: 'spread-crossed', input: { from: 1.411573824, to: 12.25865768, low: 0.3263, high: 4, up: true, cause: 'priciest-rose' }, output: { from: 1.411764706, to: 12.2605364, low: 0.6525, high: 8, up: true, cause: 'priciest-rose' } },
      { type: 'price-changed', tag: 'gmicloud/bf16', provider: 'GMICloud', prompt: { from: 0.3698, to: 0.3263, change: -0.117631152 }, completion: { from: 0.7395, to: 0.6525, change: -0.1176470588 }, discountFrom: 0.15, discountTo: 0.25, standing: { poolSize: 5, input: { cheapest: true, vs: null, tags: ['deepinfra/fp8'], providers: ['DeepInfra'] }, output: { cheapest: true, vs: null, tags: ['deepinfra/fp8'], providers: ['DeepInfra'] } } },
    ],
    fields: {
      Joined: "[PrimaLabs](https://openrouter.ai/provider/primalabs) · $4.00 in / $8.00 out per M · input and output 12x the cheapest",
      Prices: "[GMICloud](https://openrouter.ai/provider/gmicloud) ↓ · input $0.37 to $0.326 per M (-12%) · output $0.74 to $0.652 (-12%) · listed discount 15% to 25% · cheapest on input and output",
      'Price range': "Input: $0.326 to $4.00 per M (12x, above 3x)\nOutput: $0.652 to $8.00 per M (12x, above 3x)",
    },
  },
  {
    card: 'a flex endpoint removed and the cheapest changed',
    events: [{ type: 'left', tag: 'openai/flex', provider: 'OpenAI' }],
    fields: {
      Cheapest: "[Azure](https://openrouter.ai/provider/azure) and [OpenAI](https://openrouter.ai/provider/openai) (openai), tied, at $30.00 in / $180.00 out per M\nBefore: [OpenAI](https://openrouter.ai/provider/openai) (openai/flex) (left)",
    },
    ties: [[0, [{ label: link('Azure', 'azure'), provider: 'Azure', tag: 'azure' }, { label: `${link('OpenAI', 'openai')} (openai)`, provider: 'OpenAI', tag: 'openai' }], '$30.00 in / $180.00 out per M']],
  },
  {
    card: 'two price increases, with request share and usage',
    events: [
      { type: 'price-changed', tag: 'morph', provider: 'Morph', prompt: { from: 0.684, to: 0.91, change: 0.3304093567 }, completion: { from: 10.26, to: 13.65, change: 0.3304093567 }, standing: { poolSize: 4, input: { cheapest: false, vs: 3.033333333, tags: ['relace'], providers: ['Relace'] }, output: { cheapest: false, vs: 2.237704918, tags: ['decart'], providers: ['Decart'] } } },
      { type: 'price-changed', tag: 'relace', provider: 'Relace', prompt: { from: 0.24, to: 0.3, change: 0.25 }, completion: null, standing: { poolSize: 4, input: { cheapest: true, vs: null, tags: ['morph'], providers: ['Morph'] }, output: { cheapest: false, vs: 1.475409836, tags: ['decart'], providers: ['Decart'] } } },
    ],
    fields: {
      Prices: "[Morph](https://openrouter.ai/provider/morph) ↑ · input $0.684 to $0.91 per M (+33%) · output $10.26 to $13.65 (+33%) · input 3x, output 2.2x the cheapest\n[Relace](https://openrouter.ai/provider/relace) ↑ · input $0.24 to $0.30 per M (+25%) · cheapest input; output 1.5x the cheapest",
    },
  },
  {
    card: 'five kinds of change',
    events: [
      { type: 'joined', tag: 'ambient/fp4', provider: 'Ambient', prompt: 0.098, completion: 0.294, standing: { poolSize: 49, input: { cheapest: false, vs: 2.722222222, tags: ['wafer/us'], providers: ['Wafer'] }, output: { cheapest: false, vs: 2.94, tags: ['sail-research/fp4', 'sail-research/fp4/us'], providers: ['Sail Research', 'Sail Research'] } } },
      { type: 'price-changed', tag: 'particle-ai/us/flex', provider: 'Particle AI', prompt: { from: 0.03, to: 0.04, change: 0.3333333333 }, completion: { from: 0.25, to: 0.3, change: 0.2 }, standing: { poolSize: 49, input: { cheapest: false, vs: 1.111111111, tags: ['wafer/us'], providers: ['Wafer'] }, output: { cheapest: false, vs: 3, tags: ['sail-research/fp4', 'sail-research/fp4/us'], providers: ['Sail Research', 'Sail Research'] } } },
      { type: 'price-changed', tag: 'particle-ai/us', provider: 'Particle AI', prompt: { from: 0.06, to: 0.08, change: 0.3333333333 }, completion: { from: 0.5, to: 0.6, change: 0.2 }, standing: { poolSize: 49, input: { cheapest: false, vs: 2.222222222, tags: ['wafer/us'], providers: ['Wafer'] }, output: { cheapest: false, vs: 6, tags: ['sail-research/fp4', 'sail-research/fp4/us'], providers: ['Sail Research', 'Sail Research'] } } },
      { type: 'price-changed', tag: 'open-inference/fp4', provider: 'OpenInference', prompt: { from: 0.07, to: 0.1, change: 0.4285714286 }, completion: null, standing: { poolSize: 49, input: { cheapest: false, vs: 2.777777778, tags: ['wafer/us'], providers: ['Wafer'] }, output: { cheapest: false, vs: 12, tags: ['sail-research/fp4', 'sail-research/fp4/us'], providers: ['Sail Research', 'Sail Research'] } } },
      { type: 'price-changed', tag: 'morph/fp8', provider: 'Morph', prompt: { from: 0.07, to: 0.074, change: 0.05714285714 }, completion: { from: 0.622, to: 0.661, change: 0.06270096463 }, standing: { poolSize: 49, input: { cheapest: false, vs: 2.055555556, tags: ['wafer/us'], providers: ['Wafer'] }, output: { cheapest: false, vs: 6.61, tags: ['sail-research/fp4', 'sail-research/fp4/us'], providers: ['Sail Research', 'Sail Research'] } } },
      { type: 'price-changed', tag: 'makora/fp8', provider: 'Makora', prompt: { from: 0.15, to: 0.12, change: -0.2 }, completion: { from: 1.2, to: 0.4, change: -0.6666666667 }, standing: { poolSize: 49, input: { cheapest: false, vs: 3.333333333, tags: ['wafer/us'], providers: ['Wafer'] }, output: { cheapest: false, vs: 4, tags: ['sail-research/fp4', 'sail-research/fp4/us'], providers: ['Sail Research', 'Sail Research'] } } },
    ],
    fields: {
      Joined: "[Ambient](https://openrouter.ai/provider/ambient) · $0.098 in / $0.294 out per M · input 2.7x, output 2.9x the cheapest",
      Prices: "[Particle AI](https://openrouter.ai/provider/particle-ai) (particle-ai/us/flex) ↑ · [flex tier](https://openrouter.ai/docs/guides/features/service-tiers) · input $0.03 to $0.04 per M (+33%) · output $0.25 to $0.30 (+20%) · input 1.1x, output 3x the cheapest\n[Particle AI](https://openrouter.ai/provider/particle-ai) (particle-ai/us) ↑ · input $0.06 to $0.08 per M (+33%) · output $0.50 to $0.60 (+20%) · input 2.2x, output 6x the cheapest\n[OpenInference](https://openrouter.ai/provider/open-inference) ↑ · input $0.07 to $0.10 per M (+43%) · input 2.8x, output 12x the cheapest\n[Morph](https://openrouter.ai/provider/morph) (morph/fp8) ↑ · input $0.07 to $0.074 per M (+6%) · output $0.622 to $0.661 (+6%) · input 2.1x, output 6.6x the cheapest\n[Makora](https://openrouter.ai/provider/makora) ↓ · input $0.15 to $0.12 per M (-20%) · output $1.20 to $0.40 (-67%) · input 3.3x, output 4x the cheapest",
      Cheapest: "Input: [Wafer](https://openrouter.ai/provider/wafer) (wafer/us) at $0.036 per M\nInput before: [Particle AI](https://openrouter.ai/provider/particle-ai) (particle-ai/us/flex) (now $0.04 per M)\nOutput: [Sail Research](https://openrouter.ai/provider/sail-research), 2 endpoints (sail-research/fp4, sail-research/fp4/us), at $0.10 per M\nLowest input + output: [Sail Research](https://openrouter.ai/provider/sail-research) (sail-research/fp4) at $0.15 per M ($0.05 + $0.10)",
    },
    ties: [[2, [{ label: link('Sail Research', 'sail-research'), provider: 'Sail Research', tag: 'sail-research/fp4' }, { label: link('Sail Research', 'sail-research'), provider: 'Sail Research', tag: 'sail-research/fp4/us' }], '$0.10 per M']],
  },
  {
    card: 'a join on a flex-tier endpoint',
    events: [
      { type: 'joined', tag: 'particle-ai/us/flex', provider: 'Particle AI', prompt: 0.03, completion: 0.25, standing: { poolSize: 2, input: { cheapest: true, vs: null, tags: ['particle-ai/us'], providers: ['Particle AI'] }, output: { cheapest: true, vs: null, tags: ['particle-ai/us'], providers: ['Particle AI'] } } },
    ],
    fields: {
      Joined: "[Particle AI](https://openrouter.ai/provider/particle-ai) (particle-ai/us/flex) · [flex tier](https://openrouter.ai/docs/guides/features/service-tiers) · $0.03 in / $0.25 out per M · cheapest on input and output",
    },
  },
  {
    card: 'a price increase on a service-tier endpoint',
    events: [
      { type: 'price-changed', tag: 'openai/flex', provider: 'OpenAI', prompt: { from: 1, to: 1.25, change: 0.25 }, completion: { from: 4, to: 5, change: 0.25 }, standing: { poolSize: 2, input: { cheapest: true, vs: null, tags: ['openai'], providers: ['OpenAI'] }, output: { cheapest: true, vs: null, tags: ['openai'], providers: ['OpenAI'] } } },
    ],
    fields: {
      Prices: "[OpenAI](https://openrouter.ai/provider/openai) (openai/flex) ↑ · [flex tier](https://openrouter.ai/docs/guides/features/service-tiers) · input $1.00 to $1.25 per M (+25%) · output $4.00 to $5.00 (+25%) · cheapest on input and output",
    },
  },
  {
    card: 'an endpoint change riding along on a price increase',
    events: [
      { type: 'price-changed', tag: 'relace', provider: 'Relace', prompt: { from: 0.24, to: 0.3, change: 0.25 }, completion: null, standing: { poolSize: 3, input: { cheapest: false, vs: 7.5, tags: ['sail-research/fp4/us'], providers: ['Sail Research'] }, output: { cheapest: false, vs: 128.5714286, tags: ['sail-research/fp4/us'], providers: ['Sail Research'] } } },
    ],
    fields: {
      Prices: "[Relace](https://openrouter.ai/provider/relace) ↑ · input $0.24 to $0.30 per M (+25%) · input 7.5x, output 129x the cheapest",
    },
  },
  {
    card: 'a quantization change riding along on a price increase',
    events: [
      { type: 'price-changed', tag: 'deepinfra/fp8', provider: 'DeepInfra', prompt: { from: 0.5, to: 0.6, change: 0.2 }, completion: { from: 2, to: 2.4, change: 0.2 }, standing: { poolSize: 3, input: { cheapest: false, vs: 2.5, tags: ['relace'], providers: ['Relace'] }, output: { cheapest: true, vs: null, tags: ['decart'], providers: ['Decart'] } } },
    ],
    fields: {
      Prices: "[DeepInfra](https://openrouter.ai/provider/deepinfra) (deepinfra/fp8) ↑ · input $0.50 to $0.60 per M (+20%) · output $2.00 to $2.40 (+20%) · cheapest output; input 2.5x the cheapest",
    },
  },
  {
    card: 'model delisted',
    events: [{ type: 'model-delisted' }],
    fields: { Model: "No longer in OpenRouter's model list" },
  },
  {
    card: 'no providers left',
    events: [{ type: 'pool-empty' }],
    fields: { Model: 'OpenRouter lists no providers for this model now' },
  },
];

for (const { card, events, fields, ties = [] } of cards) {
  test(`full card, ${card}: the event phrases in its fields`, () => {
    const lines = (name) => fields[name].split('\n');

    const joins = events.filter((e) => e.type === 'joined');
    if (fields.Joined) {
      assert.equal(lines('Joined').length, joins.length);
      joins.forEach((e, i) => assert.ok(
        lines('Joined')[i].endsWith(` · ${standingText(e.standing, null)}`),
        `Joined line ${i} ends with the standing of ${e.tag}`,
      ));
    }

    const prices = events.filter((e) => e.type === 'price-changed');
    if (fields.Prices) {
      assert.equal(lines('Prices').length, prices.length);
      prices.forEach((e, i) => assert.ok(
        lines('Prices')[i].endsWith(` · ${pricePhrase(e)}`),
        `Prices line ${i} ends with "${pricePhrase(e)}"`,
      ));
    }

    const range = events.find((e) => e.type === 'spread-crossed');
    if (fields['Price range']) {
      const label = { input: 'Input', output: 'Output' };
      assert.deepEqual(
        lines('Price range'),
        rangeSides(range).map(([side, s]) => `${label[side]}: ${rangeText(s)}`),
      );
    }

    if (fields.Model) assert.equal(fields.Model, eventSentence(events[0]));

    for (const [index, items, price] of ties) {
      const text = tiedText(items, price);
      assert.ok(lines('Cheapest')[index].endsWith(text), `Cheapest line ${index} ends with "${text}"`);
    }
  });
}
