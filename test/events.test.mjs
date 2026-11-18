import test from 'node:test';
import assert from 'node:assert/strict';
import * as events from '../src/events.mjs';

function endpoint(
  tag,
  provider,
  prompt,
  completion,
  {
    discount = 0,
    quantization = null,
  } = {},
) {
  return {
    tag,
    provider,
    prompt,
    completion,
    discount,
    context: null,
    quantization,
    status: null,
    uptime30m: null,
    uptime1d: null,
    uptimePage: null,
    latency30m: null,
    throughput30m: null,
  };
}

test('exports its public API', () => {
  for (const name of [
    'cheapestNow',
    'standing',
    'tiedText',
    'standingText',
    'cheapestSides',
    'tieChange',
    'cheapestKinds',
    'cheapestMove',
    'priceDirection',
    'sideRose',
    'diffModel',
    'rangeSides',
    'rangeVerb',
    'rangeText',
    'saidByJoin',
    'shownEvents',
    'priceParts',
    'eventSentence',
    'diffSnapshots',
    'fmtMultiple',
  ]) {
    assert.equal(typeof events[name], 'function', `${name} is exported`);
  }
});

test('fmtMultiple rounds a multiple, ends it in x, and gives null for Infinity', () => {
  assert.equal(events.fmtMultiple(1), '1x');
  assert.equal(events.fmtMultiple(1.004), '1.00x');
  assert.equal(events.fmtMultiple(1.02), '1.02x');
  assert.equal(events.fmtMultiple(1.05), '1.1x');
  assert.equal(events.fmtMultiple(3.75), '3.8x');
  assert.equal(events.fmtMultiple(9.96), '10x');
  assert.equal(events.fmtMultiple(12.26), '12x');
  assert.equal(events.fmtMultiple(20.4), '20x');
  assert.equal(events.fmtMultiple(Infinity), null);
});

test('cheapestNow finds input, output, and lowest combined endpoint separately', () => {
  const pool = [
    endpoint('wafer/us', 'Wafer', 0.0699, 1.4),
    endpoint('wafer/fp4', 'Wafer', 0.179, 1.4),
    endpoint('makora/fp4', 'Makora', 1.5, 2),
  ];

  assert.deepEqual(events.cheapestNow(pool), {
    input: {
      tags: ['wafer/us'],
      providers: ['Wafer'],
      price: 0.0699,
    },
    output: {
      tags: ['wafer/fp4', 'wafer/us'],
      providers: ['Wafer', 'Wafer'],
      price: 1.4,
    },
    combined: {
      tags: ['wafer/us'],
      providers: ['Wafer'],
      prompt: 0.0699,
      completion: 1.4,
      price: 1.4699,
    },
  });

  assert.equal(events.cheapestNow([endpoint('solo', 'Solo', 1, 2)]), null);
  assert.equal(events.cheapestNow([
    endpoint('a', 'A', null, null),
    endpoint('b', 'B', null, null),
  ]), null);
});

// A multiple ends in one `x`; when one side is within 5% of the cheapest and the other is a
// multiple, each side names its reference.
test('standingText with one side near the cheapest and the other a multiple writes one x and both references', () => {
  const snap = (takenAt, makora) => ({
    takenAt,
    source: 'openrouter-api',
    partial: false,
    note: null,
    modelCount: 1,
    models: {
      'a/b': {
        name: 'A: B',
        listed: null,
        outputModalities: ['text'],
        endpoints: [endpoint('n', 'Novita', 0.63, 1.98), endpoint('m', 'Makora', ...makora)],
      },
    },
  });

  const outputNear = events.diffSnapshots(
    snap('2026-11-17T12:00:00Z', [1, 3.6]),
    snap('2026-11-17T12:15:00Z', [1.5, 2]),
  ).filter(e => e.type === 'price-changed');
  assert.deepEqual(outputNear.map(events.eventSentence), [
    'Makora (m) · input $1.00 to $1.50 per M (+50%) · output $3.60 to $2.00 (-44%) · input 2.4x the cheapest (Novita), output 1% above the cheapest (Novita)',
  ]);

  const inputNear = events.diffSnapshots(
    snap('2026-11-17T12:00:00Z', [1.5, 2]),
    snap('2026-11-17T12:15:00Z', [0.65, 4.8]),
  ).filter(e => e.type === 'price-changed');
  assert.equal(
    events.standingText(inputNear[0].standing),
    'input 3% above the cheapest (Novita), output 2.4x the cheapest (Novita)',
  );

  const A = { tags: ['a'], providers: ['A'] };
  assert.equal(events.standingText({
    poolSize: 3,
    input: { cheapest: false, vs: 1.4, ...A },
    output: { cheapest: false, vs: 1.004, ...A },
  }), 'input 1.4x the cheapest (A), output less than 1% above the cheapest (A)');
  assert.equal(events.standingText({
    poolSize: 3,
    input: { cheapest: false, vs: 1.02, ...A },
    output: { cheapest: false, vs: 1.1, ...A },
  }), 'input 2% above the cheapest (A), output 1.1x the cheapest (A)');
  // One side near the cheapest, the other a multiple, unchanged.
  assert.equal(events.standingText({
    poolSize: 3,
    input: { cheapest: false, vs: 1.02, ...A },
    output: { cheapest: false, vs: 1.004, ...A },
  }), 'input 2% above the cheapest (A), output less than 1% above the cheapest (A)');
});

test('standing and standingText keep input and output separate', () => {
  const e = endpoint('x', 'X', 1.4, 1.1);
  const others = [
    endpoint('a', 'A', 1, 1),
    endpoint('b', 'B', 2, 2),
  ];

  const result = events.standing(e, others);
  assert.deepEqual(result, {
    poolSize: 3,
    input: {
      cheapest: false,
      vs: 1.4,
      tags: ['a'],
      providers: ['A'],
    },
    output: {
      cheapest: false,
      vs: 1.1,
      tags: ['a'],
      providers: ['A'],
    },
  });

  assert.equal(
    events.standingText(result),
    'input 1.4x, output 1.1x the cheapest (A)',
  );

  assert.equal(events.standingText({
    poolSize: 3,
    input: { cheapest: true, vs: null, tags: ['a'], providers: ['A'] },
    output: { cheapest: true, vs: null, tags: ['a'], providers: ['A'] },
  }), 'cheapest on input and output');

  assert.equal(events.standingText({
    poolSize: 3,
    input: { cheapest: true, vs: null, tags: ['a'], providers: ['A'] },
    output: { cheapest: false, vs: 1.1, tags: ['a'], providers: ['A'] },
  }), 'cheapest input; output 1.1x the cheapest (A)');

  assert.equal(events.standingText({
    poolSize: 3,
    input: { cheapest: false, vs: null, tags: ['a'], providers: ['A'] },
    output: { cheapest: false, vs: 2, tags: ['a'], providers: ['A'] },
  }), 'the cheapest input is free, output 2x the cheapest (A)');

  assert.equal(events.standingText({
    poolSize: 1,
    input: null,
    output: null,
  }), '');

  assert.equal(events.standingText(result, null),
    'input 1.4x, output 1.1x the cheapest');
});

test('tiedText follows the tie shapes', () => {
  assert.equal(events.tiedText([
    { provider: 'Chutes', tag: 'chutes' },
  ], '$0.039 per M'), 'Chutes at $0.039 per M');

  assert.equal(events.tiedText([
    { provider: 'Azure', tag: 'azure' },
    { provider: 'OpenAI', tag: 'openai' },
  ], '$15.00 per M'), 'Azure and OpenAI, tied, at $15.00 per M');

  assert.equal(events.tiedText([
    { provider: 'Wafer', tag: 'wafer/fp4' },
    { provider: 'Wafer', tag: 'wafer/us' },
  ], '$1.40 per M'),
  'Wafer, 2 endpoints (wafer/fp4, wafer/us), at $1.40 per M');

  assert.equal(events.tiedText([
    { provider: 'AkashML', tag: 'akashml' },
    { provider: 'CoreWeave', tag: 'coreweave' },
    { provider: 'KT', tag: 'kt' },
    { provider: 'Modal', tag: 'modal' },
    { provider: 'Novita', tag: 'novita' },
  ], '$0.03 per M'),
  '5 tied at $0.03 per M: AkashML, CoreWeave, KT, Modal, Novita');
});

test('diffModel produces joins, departures, price changes, quantization changes, cheapest and range events in feed order', () => {
  const previous = [
    endpoint('gmicloud/bf16', 'GMICloud', 0.3698, 0.7395, {
      discount: 0.15,
      quantization: 'bf16',
    }),
    endpoint('xiaomi/fp8', 'Xiaomi', 0.435, 0.87, { quantization: 'fp8' }),
    endpoint('deepinfra/fp8', 'DeepInfra', 0.387, 0.783, {
      discount: 0.1,
      quantization: 'fp8',
    }),
    endpoint('streamlake', 'StreamLake', 0.522, 1.044, {
      quantization: 'fp8',
    }),
    endpoint('novitaai', 'NovitaAI', 0.435, 0.87, { quantization: 'fp8' }),
  ];

  const next = [
    endpoint('xiaomi/fp8', 'Xiaomi', 0.435, 0.87, { quantization: 'fp8' }),
    endpoint('deepinfra/fp8', 'DeepInfra', 0.387, 0.783, {
      discount: 0.1,
      quantization: 'fp8',
    }),
    endpoint('primalabs/fp8', 'PrimaLabs', 4, 8, { quantization: 'fp8' }),
    endpoint('gmicloud/bf16', 'GMICloud', 0.3263, 0.6525, {
      discount: 0.25,
      quantization: 'bf16',
    }),
    endpoint('streamlake', 'StreamLake', 0.522, 1.044, {
      quantization: 'fp8',
    }),
  ];

  const changed = events.diffModel(previous, next);

  assert.deepEqual(changed.map(event => event.type), [
    'left',
    'joined',
    'price-changed',
    'spread-crossed',
  ]);

  assert.equal(
    events.eventSentence(changed[0]),
    'NovitaAI left',
  );
  assert.equal(
    events.eventSentence(changed[1]),
    'PrimaLabs (primalabs/fp8) joined at $4.00 / $8.00 per M, input and output 12x the cheapest (GMICloud)',
  );
  assert.equal(
    events.eventSentence(changed[2]),
    'GMICloud (gmicloud/bf16) · input $0.37 to $0.326 per M (-12%) · output $0.74 to $0.652 (-12%) · listed discount 15% to 25% · cheapest on input and output',
  );
  assert.equal(
    events.eventSentence(changed[3]),
    'Price range widened · input $0.326 to $4.00 per M (12x, above 3x) · output $0.652 to $8.00 (12x, above 3x)',
  );

  assert.equal(changed[1].expensive, true);
  assert.equal(changed[1].cheapestProvider, 'GMICloud');
  assert.equal(changed[1].cheapestTag, 'gmicloud/bf16');
  assert.equal(changed[2].major, false);
  assert.equal(changed[2].direction, 'down');
});

test('price changes ignore rounding but detect free transitions and mixed moves', () => {
  const noChange = events.diffModel([
    endpoint('x', 'X', 0.3263, 1),
    endpoint('y', 'Y', 1, 1),
  ], [
    endpoint('x', 'X', 0.32625, 1),
    endpoint('y', 'Y', 1, 1),
  ]);
  assert.deepEqual(noChange, []);

  const freeToPaid = events.diffModel([
    endpoint('x', 'X', 0, 1),
    endpoint('y', 'Y', 1, 1),
  ], [
    endpoint('x', 'X', 0.1, 1),
    endpoint('y', 'Y', 1, 1),
  ]).find(event => event.type === 'price-changed');

  assert.equal(
    events.eventSentence(freeToPaid),
    'X · input free to $0.10 per M · cheapest on input and output',
  );
  assert.equal(freeToPaid.major, true);
  assert.equal(freeToPaid.direction, 'up');

  const paidToFree = events.diffModel([
    endpoint('x', 'X', 0.1, 1),
    endpoint('y', 'Y', 1, 1),
  ], [
    endpoint('x', 'X', 0, 1),
    endpoint('y', 'Y', 1, 1),
  ]).find(event => event.type === 'price-changed');

  assert.equal(
    events.eventSentence(paidToFree),
    'X · input $0.10 per M to free · cheapest on input and output',
  );
  assert.equal(paidToFree.direction, 'down');

  const mixed = events.diffModel([
    endpoint('makora/fp4', 'Makora', 1, 3.6),
    endpoint('wafer/us', 'Wafer', 0.0699, 1.4),
    endpoint('wafer/fp4', 'Wafer', 0.179, 1.4),
  ], [
    endpoint('makora/fp4', 'Makora', 1.5, 2),
    endpoint('wafer/us', 'Wafer', 0.0699, 1.4),
    endpoint('wafer/fp4', 'Wafer', 0.179, 1.4),
  ]).find(event => event.type === 'price-changed');

  assert.equal(mixed.direction, 'mixed');
  assert.equal(events.priceDirection(mixed), 'mixed');
  assert.equal(events.sideRose(mixed, 0.1), true);
  assert.equal(
    events.eventSentence(mixed),
    'Makora (makora/fp4) · input $1.00 to $1.50 per M (+50%) · output $3.60 to $2.00 (-44%) · input 21x the cheapest (Wafer), output 1.4x the cheapest (2 Wafer endpoints)',
  );
});

test('quantization changes are emitted after price changes for the same endpoint', () => {
  const changed = events.diffModel([
    endpoint('deepinfra/fp8', 'DeepInfra', 0.5, 2, {
      quantization: 'fp8',
    }),
    endpoint('relace', 'Relace', 0.24, 4),
    endpoint('decart', 'Decart', 1, 3),
  ], [
    endpoint('deepinfra/fp8', 'DeepInfra', 0.6, 2.4, {
      quantization: 'fp4',
    }),
    endpoint('relace', 'Relace', 0.24, 4),
    endpoint('decart', 'Decart', 1, 3),
  ]);

  assert.deepEqual(changed.map(event => event.type), [
    'price-changed',
    'quantization-changed',
  ]);
  assert.deepEqual(changed[0].standing, {
    poolSize: 3,
    input: { cheapest: false, vs: 2.5, tags: ['relace'], providers: ['Relace'] },
    output: { cheapest: true, vs: null, tags: ['decart'], providers: ['Decart'] },
  });
  assert.equal(
    events.eventSentence(changed[1]),
    'DeepInfra (deepinfra/fp8) quantization fp8 to fp4',
  );
});

test('a quantization change does not hold back a cheapest change in the same diff', () => {
  const changed = events.diffModel([
    endpoint('chutes/int4', 'Chutes', 0.39, 1.8),
    endpoint('baidu/fp4', 'Baidu', 0.6498, 2.736, { quantization: 'fp4' }),
  ], [
    endpoint('chutes/int4', 'Chutes', 0.39, 1.8),
    endpoint('baidu/fp4', 'Baidu', 0.3895, 1.64, { quantization: 'fp8' }),
  ]);

  assert.deepEqual(changed.map(event => event.type), [
    'price-changed',
    'quantization-changed',
    'cheapest-changed',
  ]);
  assert.equal(
    events.eventSentence(changed[2]),
    'Cheapest endpoint: now Baidu at $0.39 in / $1.64 out per M · was Chutes, now $0.39 in / $1.80 out',
  );
});

test('cheapest changes retain ties, current old prices, and departed old endpoints', () => {
  const moved = events.diffModel([
    endpoint('chutes/int4', 'Chutes', 0.39, 1.8),
    endpoint('baidu/fp4', 'Baidu', 0.6498, 2.736),
  ], [
    endpoint('chutes/int4', 'Chutes', 0.39, 1.8),
    endpoint('baidu/fp4', 'Baidu', 0.3895, 1.64),
  ]).find(event => event.type === 'cheapest-changed');

  assert.equal(
    events.eventSentence(moved),
    'Cheapest endpoint: now Baidu at $0.39 in / $1.64 out per M · was Chutes, now $0.39 in / $1.80 out',
  );
  assert.deepEqual(events.cheapestKinds(moved), new Set(['new']));

  const tied = events.diffModel([
    endpoint('inferact-vllm/nvfp4', 'Inferact vLLM', 0.075, 0.3),
    endpoint('minimax', 'Minimax', 0.15, 0.6),
  ], [
    endpoint('inferact-vllm/nvfp4', 'Inferact vLLM', 0.075, 0.3),
    endpoint('minimax', 'Minimax', 0.075, 0.3),
  ]).find(event => event.type === 'cheapest-changed');

  assert.equal(
    events.eventSentence(tied),
    'Cheapest endpoint: Minimax now ties Inferact vLLM',
  );
  assert.equal(events.tieChange(tied.input), 'tied');
  assert.deepEqual(events.cheapestKinds(tied), new Set(['tied']));

  const untied = events.diffModel([
    endpoint('darkbloom', 'Darkbloom', 0.04, 0.15),
    endpoint('primeintellect/bf16', 'PrimeIntellect', 0.04, 0.121),
  ], [
    endpoint('darkbloom', 'Darkbloom', 0.04, 0.15),
    endpoint('primeintellect/bf16', 'PrimeIntellect', 0.059, 0.176),
  ]).find(event => event.type === 'cheapest-changed');

  assert.equal(
    events.eventSentence(untied),
    'Cheapest input: Darkbloom alone (PrimeIntellect no longer ties). Cheapest output: now Darkbloom at $0.15 per M · was PrimeIntellect, now $0.176',
  );
  assert.equal(events.tieChange(untied.input), 'untied');
  assert.deepEqual(events.cheapestKinds(untied), new Set(['untied']));

  const departed = events.diffModel([
    endpoint('openai/flex', 'OpenAI', 15, 90),
    endpoint('azure', 'Azure', 30, 180),
    endpoint('openai', 'OpenAI', 30, 180),
  ], [
    endpoint('azure', 'Azure', 30, 180),
    endpoint('openai', 'OpenAI', 30, 180),
  ]).find(event => event.type === 'cheapest-changed');

  assert.equal(
    events.eventSentence(departed),
    'Cheapest endpoint: now Azure and OpenAI (openai), tied, at $30.00 in / $180.00 out per M · was openai/flex (left)',
  );
});

test('range crossings report direction, cause and reader sentence', () => {
  const widened = events.diffModel([
    endpoint('a', 'A', 0.5, 1),
    endpoint('b', 'B', 1.4, 2),
  ], [
    endpoint('a', 'A', 0.5, 1),
    endpoint('b', 'B', 4, 8),
  ]).find(event => event.type === 'spread-crossed');

  assert.equal(events.rangeVerb(widened), 'widened');
  assert.deepEqual(events.rangeSides(widened).map(([side]) => side), [
    'input',
    'output',
  ]);
  assert.equal(
    events.eventSentence(widened),
    'Price range widened · input $0.50 to $4.00 per M (8x, above 3x) · output $1.00 to $8.00 (8x, above 3x)',
  );

  const cheapestFell = events.diffModel([
    endpoint('deepinfra', 'DeepInfra', 0.387, 0.783),
    endpoint('streamlake', 'StreamLake', 0.522, 1.044),
  ], [
    endpoint('deepinfra', 'DeepInfra', 0.1, 0.783),
    endpoint('streamlake', 'StreamLake', 0.522, 1.044),
  ]).find(event => event.type === 'spread-crossed');

  assert.equal(cheapestFell.input.cause, 'cheapest-fell');
  assert.equal(
    events.eventSentence(cheapestFell),
    'Price range widened · input $0.10 to $0.522 per M (5.2x, above 3x, as the cheapest fell)',
  );
  assert.equal(
    events.rangeText(cheapestFell.input),
    '$0.10 to $0.522 per M (5.2x, above 3x, as the cheapest fell)',
  );

  const narrowed = events.diffModel([
    endpoint('a', 'A', 0.5, 1),
    endpoint('b', 'B', 4, 8),
  ], [
    endpoint('a', 'A', 0.5, 1),
    endpoint('b', 'B', 0.7, 1.4),
  ]).find(event => event.type === 'spread-crossed');

  assert.equal(events.rangeVerb(narrowed), 'narrowed');
  assert.equal(
    events.eventSentence(narrowed),
    'Price range narrowed · input back under 3x (1.4x) · output back under 3x (1.4x)',
  );
  assert.equal(events.rangeText(narrowed.input), 'back under 3x (1.4x)');
});

test('model pool transitions produce model-listed and pool-empty', () => {
  const listed = events.diffModel([], [
    endpoint('n1', 'N1', 1, 2),
    endpoint('n2', 'N2', 1.5, 3),
  ]);
  assert.deepEqual(listed, [{ type: 'model-listed', endpoints: 2 }]);
  assert.equal(events.eventSentence(listed[0]), 'Listed with 2 endpoints');

  const empty = events.diffModel([
    endpoint('n1', 'N1', 1, 2),
  ], []);
  assert.deepEqual(empty, [{ type: 'pool-empty' }]);
  assert.equal(
    events.eventSentence(empty[0]),
    'OpenRouter lists no providers for this model now',
  );

  assert.deepEqual(events.diffModel([], []), []);
});

test('shownEvents hides rejoined endpoints and same-list endpoint replacement departures', () => {
  const list = [
    {
      type: 'left',
      tag: 'sail-research/fp4',
      provider: 'Sail Research',
      replacedBy: 'sail-research/fp4/us',
    },
    {
      type: 'joined',
      tag: 'sail-research/fp4/us',
      provider: 'Sail Research',
      replaces: 'sail-research/fp4',
      prompt: 0.2,
      completion: 12,
    },
    {
      type: 'joined',
      tag: 'ionstream/flex',
      provider: 'Ionstream',
      rejoined: true,
      prompt: 1,
      completion: 2,
    },
    {
      type: 'price-changed',
      tag: 'x',
      provider: 'X',
      prompt: { from: 1, to: 1.5, change: 0.5 },
      completion: null,
      direction: 'up',
    },
  ];

  assert.deepEqual(events.shownEvents(list), [
    list[1],
    list[3],
  ]);
  assert.equal(events.saidByJoin(list[0], list), true);
});

test('eventSentence handles departure lifecycle and endpoint replacement wording', () => {
  assert.equal(events.eventSentence({
    type: 'left',
    tag: 'sail-research/fp4',
    provider: 'Sail Research',
    confirmed: false,
  }), 'Sail Research (sail-research/fp4) missing at the last check; may come back');

  assert.equal(events.eventSentence({
    type: 'left',
    tag: 'ionstream/flex',
    provider: 'Ionstream',
    returned: true,
  }), 'Ionstream (ionstream/flex) was briefly unlisted and came back');

  assert.equal(events.eventSentence({
    type: 'left',
    tag: 'mistral/zdr',
    provider: 'Mistral',
    providerStays: true,
    remains: { tag: 'mistral/eu', provider: 'Mistral' },
  }), 'Mistral (mistral/zdr) endpoint removed; only Mistral (mistral/eu) remains');

  assert.equal(events.eventSentence({
    type: 'left',
    tag: 'sail-research/fp4',
    provider: 'Sail Research',
    replacedBy: 'sail-research/fp4/us',
  }), 'Sail Research endpoint sail-research/fp4 replaced by sail-research/fp4/us');

  assert.equal(events.eventSentence({
    type: 'joined',
    tag: 'sail-research/fp4/us',
    provider: 'Sail Research',
    prompt: 0.2,
    completion: 12,
    replaces: 'sail-research/fp4',
  }), 'Sail Research endpoint changed: sail-research/fp4 to sail-research/fp4/us, at $0.20 / $12.00 per M');
});

test('priceNotPerToken suppresses reader-facing per-token prices', () => {
  const join = {
    type: 'joined',
    tag: 'fal/video',
    provider: 'Fal',
    prompt: 0,
    completion: 0,
    priceNotPerToken: true,
  };

  assert.equal(
    events.eventSentence(join),
    'Fal (fal/video) joined; price not listed per token (see OpenRouter)',
  );

  const replacement = {
    ...join,
    tag: 'fal/video/new',
    replaces: 'fal/video',
  };

  assert.equal(
    events.eventSentence(replacement),
    'Fal endpoint changed: fal/video to fal/video/new; price not listed per token (see OpenRouter)',
  );
});

test('diffSnapshots stamps model, at, since and sources without history-only departure fields', () => {
  const a = {
    takenAt: '2026-10-27T16:45:15Z',
    source: 'archived-model-page',
    partial: true,
    note: null,
    modelCount: 1,
    models: {
      'xiaomi/mimo-v2.6-pro': {
        name: 'Xiaomi: MiMo-V2.6-Pro',
        listed: { prompt: 0.3698, completion: 0.7395 },
        endpoints: [
          endpoint('gmicloud/bf16', 'GMICloud', 0.3698, 0.7395, {
            discount: 0.15,
          }),
          endpoint('novitaai', 'NovitaAI', 0.435, 0.87),
        ],
      },
    },
  };

  const b = {
    takenAt: '2026-11-10T17:15:01Z',
    source: 'archived-model-page',
    partial: true,
    note: null,
    modelCount: 1,
    models: {
      'xiaomi/mimo-v2.6-pro': {
        name: 'Xiaomi: MiMo-V2.6-Pro',
        listed: { prompt: 0.3263, completion: 0.6525 },
        endpoints: [
          endpoint('gmicloud/bf16', 'GMICloud', 0.3263, 0.6525, {
            discount: 0.25,
          }),
          endpoint('primalabs/fp8', 'PrimaLabs', 4, 8),
        ],
      },
    },
  };

  const result = events.diffSnapshots(a, b);

  assert.equal(result.length, 4);
  for (const event of result) {
    assert.equal(event.model, 'xiaomi/mimo-v2.6-pro');
    assert.equal(event.at, '2026-11-10T17:15:01Z');
    assert.equal(event.since, '2026-10-27T16:45:15Z');
    assert.deepEqual(event.sources, [
      'archived-model-page',
      'archived-model-page',
    ]);
  }

  assert.equal(
    events.eventSentence(result[0]),
    'NovitaAI left',
  );
  assert.equal(
    events.eventSentence(result[1]),
    'PrimaLabs (primalabs/fp8) joined at $4.00 / $8.00 per M, input and output 12x the cheapest (GMICloud)',
  );
});
