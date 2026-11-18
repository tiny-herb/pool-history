import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SPREAD,
  PRICE_MAJOR,
  PRICE_EPSILON,
  BLEND,
  blended,
  priced,
  cheapest,
  priciest,
  ratio,
  spreadOf,
  sideRange,
  priceRanges,
  providerTag,
  DYNAMIC_MIN_CHECKS,
  DYNAMIC_SHARE,
  DYNAMIC_WINDOW_MS,
  repricingIndex,
  dynamicProviders,
  routineMove,
  routineMoves,
} from '../src/rules.mjs';

const endpoint = (tag, provider, prompt, completion) => ({
  tag,
  provider,
  prompt,
  completion,
});

test('exports the fixed pool thresholds and blend weights', () => {
  assert.equal(SPREAD, 3);
  assert.equal(PRICE_MAJOR, 0.25);
  assert.equal(PRICE_EPSILON, 0.005);
  assert.deepEqual(BLEND, { prompt: 3, completion: 1 });
});

test('blended returns the 3:1 internal price for recorded prices', () => {
  assert.equal(blended(endpoint('a', 'A', 1, 2)), 1.25);
  assert.equal(blended(endpoint('b', 'B', 0.3698, 0.7395)), 0.462225);
  assert.equal(blended(endpoint('c', 'C', 0, 0)), 0);
});

test('blended leaves incomplete and invalid prices unrecorded', () => {
  assert.equal(blended(endpoint('a', 'A', null, 1)), null);
  assert.equal(blended(endpoint('b', 'B', 1, null)), null);
  assert.equal(blended(endpoint('c', 'C', undefined, 1)), null);
  assert.equal(blended(endpoint('d', 'D', 1, undefined)), null);
  assert.equal(blended(endpoint('e', 'E', '1', 2)), null);
  assert.equal(blended(endpoint('f', 'F', 1, NaN)), null);
});

test('priced keeps only endpoints whose two prices are numeric', () => {
  const a = endpoint('a', 'A', 1, 2);
  const b = endpoint('b', 'B', 0, 0);
  const c = endpoint('c', 'C', 1, null);
  const d = endpoint('d', 'D', null, 2);

  assert.deepEqual(priced([a, c, b, d]), [a, b]);
  assert.deepEqual(priced([]), []);
});

test('cheapest keeps every tied lowest blend in input order', () => {
  const a = endpoint('a', 'A', 1, 1);
  const b = endpoint('b', 'B', 0.5, 2.5);
  const c = endpoint('c', 'C', 2, 2);
  const d = endpoint('d', 'D', null, 1);

  assert.deepEqual(cheapest([a, b, c, d]), [a, b]);
  assert.deepEqual(cheapest([d]), []);
  assert.deepEqual(cheapest([]), []);
});

test('cheapest ignores endpoints with an unrecorded price', () => {
  const missing = endpoint('missing', 'Missing', null, null);
  const paid = endpoint('paid', 'Paid', 1, 2);

  assert.deepEqual(cheapest([missing, paid]), [paid]);
});

test('priciest returns the endpoint with the highest blend', () => {
  const a = endpoint('a', 'A', 1, 1);
  const b = endpoint('b', 'B', 4, 4);
  const missing = endpoint('missing', 'Missing', null, null);

  assert.equal(priciest([a, missing, b]), b);
  assert.equal(priciest([missing]), null);
  assert.equal(priciest([]), null);
});

test('ratio handles paid and free prices', () => {
  assert.equal(ratio(2, 1), 2);
  assert.equal(ratio(1, 2), 0.5);
  assert.equal(ratio(1, 0), Infinity);
  assert.equal(ratio(0, 0), 1);
});

test('spreadOf reports the blended spread and mixed-free pools', () => {
  const equal = [
    endpoint('a', 'A', 1, 1),
    endpoint('b', 'B', 1, 1),
  ];
  const varied = [
    endpoint('cheap', 'Cheap', 1, 1),
    endpoint('dear', 'Dear', 4, 4),
  ];
  const freeAndPaid = [
    endpoint('free', 'Free', 0, 0),
    endpoint('paid', 'Paid', 1, 2),
  ];
  const unpriced = [
    endpoint('unknown', 'Unknown', null, null),
  ];

  assert.deepEqual(spreadOf(equal), { spread: 1, mixedFree: false });
  assert.deepEqual(spreadOf(varied), { spread: 4, mixedFree: false });
  assert.deepEqual(spreadOf(freeAndPaid), { spread: null, mixedFree: true });
  assert.deepEqual(spreadOf(unpriced), { spread: null, mixedFree: false });
  assert.deepEqual(spreadOf([]), { spread: null, mixedFree: false });
});

test('sideRange returns the finite range of one side', () => {
  const endpoints = [
    endpoint('a', 'A', 0.1, 1),
    endpoint('b', 'B', 0.3, 2),
    endpoint('c', 'C', null, 3),
  ];

  assert.deepEqual(sideRange(endpoints, 'prompt'), {
    low: 0.1,
    high: 0.3,
    range: 3,
    mixedFree: false,
  });

  assert.deepEqual(sideRange(endpoints, 'completion'), {
    low: 1,
    high: 3,
    range: 3,
    mixedFree: false,
  });
});

test('sideRange identifies a free-and-paid side and omits its finite range', () => {
  const endpoints = [
    endpoint('free', 'Free', 0, 0),
    endpoint('paid', 'Paid', 0.1, 2),
    endpoint('unknown', 'Unknown', null, null),
  ];

  assert.deepEqual(sideRange(endpoints, 'prompt'), {
    low: 0,
    high: 0.1,
    range: null,
    mixedFree: true,
  });

  assert.deepEqual(sideRange(endpoints, 'completion'), {
    low: 0,
    high: 2,
    range: null,
    mixedFree: true,
  });
});

test('sideRange omits unrecorded values and reports an empty side', () => {
  const onlyMissing = [
    endpoint('a', 'A', null, null),
    endpoint('b', 'B', null, 2),
  ];

  assert.deepEqual(sideRange(onlyMissing, 'prompt'), {
    low: null,
    high: null,
    range: null,
    mixedFree: false,
  });

  assert.deepEqual(sideRange([endpoint('a', 'A', 2, null)], 'prompt'), {
    low: 2,
    high: 2,
    range: 1,
    mixedFree: false,
  });
});

test('priceRanges returns input and output side ranges', () => {
  const endpoints = [
    endpoint('a', 'A', 0.1, 0),
    endpoint('b', 'B', 0.3, 2),
  ];

  assert.deepEqual(priceRanges(endpoints), {
    input: {
      low: 0.1,
      high: 0.3,
      range: 3,
      mixedFree: false,
    },
    output: {
      low: 0,
      high: 2,
      range: null,
      mixedFree: true,
    },
  });
});

test('providerTag makes stable lower-case provider slugs', () => {
  assert.equal(providerTag('Alibaba Cloud Int.'), 'alibaba-cloud-int');
  assert.equal(providerTag('  Baidu Qianfan  '), 'baidu-qianfan');
  assert.equal(providerTag('Google Vertex'), 'google-vertex');
  assert.equal(providerTag('OpenAI/US-East_1'), 'openai-us-east-1');
  assert.equal(providerTag('---Odd__Name---'), 'odd-name');
  assert.equal(providerTag(''), '');
});

test('supports the pool values used by the joined and price-range examples', () => {
  const joinLines = [
    'PrimaLabs (primalabs/fp8) joined at $4.00 / $8.00 per M, input and output 12x the cheapest (GMICloud)',
    'Paid (p) joined at $1.00 / $2.00 per M, the cheapest (Free) is free',
    'Q joined (price not recorded)',
    'Fal (fal/video) joined; price not listed per token (see OpenRouter)',
    'Baidu (baidu/fp8) joined at $0.15 / $0.50 per M, input 3.8x, output 6.4x the cheapest (Relace)',
    'Modal (modal/mxfp4) joined at $3.00 / $15.00 per M, input 20x the cheapest (Wafer), output 1.6x the cheapest (Chutes)',
    'Sail Research endpoint changed: sail-research/fp4 to sail-research/fp4/us, at $0.345 / $16.58 per M',
  ];
  const rangeLines = [
    'Price range widened · input $0.326 to $4.00 per M (12x, above 3x) · output $0.652 to $8.00 (12x, above 3x)',
    'Price range widened · input $0.10 to $0.522 per M (5.2x, above 3x, as the cheapest fell)',
    'Price range narrowed · input back under 3x (1.4x) · output back under 3x (1.4x)',
    'Price range widened · input $0.046 to $0.17 per M (3.7x, above 3x, as the cheapest fell) · output $0.068 to $0.25 (3.7x, above 3x, as the cheapest fell)',
    'Price range narrowed · output back under 3x (2.7x)',
  ];

  // A multiple as the example lines show it: whole above 10, two significant digits below.
  const shown = (r) => (r >= 10 ? `${Math.round(r)}x` : `${Number(r.toPrecision(2))}x`);
  const [primaLabs, , , , baidu, modal] = joinLines;
  const [mimoWidened, cheapestFell] = rangeLines;

  const mimoB = [
    endpoint('xiaomi/fp8', 'Xiaomi', 0.435, 0.87),
    endpoint('deepinfra/fp8', 'DeepInfra', 0.387, 0.783),
    endpoint('primalabs/fp8', 'PrimaLabs', 4, 8),
    endpoint('gmicloud/bf16', 'GMICloud', 0.3263, 0.6525),
    endpoint('streamlake', 'StreamLake', 0.522, 1.044),
  ];
  const gmicloud = cheapest(mimoB)[0];

  assert.equal(gmicloud.tag, 'gmicloud/bf16');
  assert.ok(primaLabs.endsWith(`(${gmicloud.provider})`));
  const primaInput = shown(ratio(mimoB[2].prompt, gmicloud.prompt));
  assert.equal(primaInput, shown(ratio(mimoB[2].completion, gmicloud.completion)));
  assert.ok(primaLabs.includes(`input and output ${primaInput} the cheapest`));
  assert.ok(ratio(blended(mimoB[2]), blended(gmicloud)) >= SPREAD);
  const mimoInput = sideRange(mimoB, 'prompt');
  const mimoOutput = sideRange(mimoB, 'completion');
  assert.ok(mimoInput.range >= SPREAD);
  assert.ok(mimoOutput.range >= SPREAD);
  assert.ok(mimoWidened.includes(`input $0.326 to $4.00 per M (${shown(mimoInput.range)}, above ${SPREAD}x)`));
  assert.ok(mimoWidened.includes(`output $0.652 to $8.00 (${shown(mimoOutput.range)}, above ${SPREAD}x)`));

  const freeAndPaid = [
    endpoint('f', 'Free', 0, 0),
    endpoint('p', 'Paid', 1, 2),
  ];
  assert.deepEqual(spreadOf(freeAndPaid), { spread: null, mixedFree: true });
  assert.equal(ratio(1, 0), Infinity);

  const baiduPool = [
    endpoint('relace/fp4', 'Relace', 0.0399, 0.0784),
    endpoint('fireworks/us', 'Fireworks', 0.225, 0.75),
    endpoint('baidu/fp8', 'Baidu', 0.15, 0.5),
  ];
  const relace = cheapest(baiduPool)[0];
  assert.equal(relace.provider, 'Relace');
  assert.ok(baidu.endsWith(`(${relace.provider})`));
  assert.ok(baidu.includes(
    `input ${shown(ratio(0.15, relace.prompt))}, output ${shown(ratio(0.5, relace.completion))} the cheapest`,
  ));

  const modalPool = [
    endpoint('wafer/fast', 'Wafer', 0.153, 16),
    endpoint('chutes/mxfp4', 'Chutes', 1.85, 9.5),
    endpoint('modal/mxfp4', 'Modal', 3, 15),
  ];
  assert.equal(sideRange(modalPool, 'prompt').low, 0.153);
  assert.equal(sideRange(modalPool, 'completion').low, 9.5);
  assert.ok(modal.includes(`input ${shown(ratio(3, sideRange(modalPool, 'prompt').low))} the cheapest (Wafer)`));
  assert.ok(modal.includes(`output ${shown(ratio(15, sideRange(modalPool, 'completion').low))} the cheapest (Chutes)`));

  const fell = sideRange([
    endpoint('low', 'Low', 0.1, 0.2),
    endpoint('high', 'High', 0.522, 0.3),
  ], 'prompt');
  assert.deepEqual(fell, {
    low: 0.1,
    high: 0.522,
    range: 5.22,
    mixedFree: false,
  });
  assert.ok(cheapestFell.includes(`input $0.10 to $0.522 per M (${shown(fell.range)}, above ${SPREAD}x`));
  assert.equal(SPREAD, 3);
});

const API = ['openrouter-api', 'openrouter-api'];

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

test('exports the dynamic-provider thresholds', () => {
  assert.equal(DYNAMIC_MIN_CHECKS, 8);
  assert.equal(DYNAMIC_SHARE, 0.5);
  assert.equal(DYNAMIC_WINDOW_MS, 86_400_000);
});

// a/b observed every 15 minutes from 00:00 to 02:00; X's input rises by 0.01 at
// every observation after the first; Y holds 1/1.
const risingTimes = [
  '2026-11-17T00:00:00Z', '2026-11-17T00:15:00Z', '2026-11-17T00:30:00Z',
  '2026-11-17T00:45:00Z', '2026-11-17T01:00:00Z', '2026-11-17T01:15:00Z',
  '2026-11-17T01:30:00Z', '2026-11-17T01:45:00Z', '2026-11-17T02:00:00Z',
];
const risingInputs = [0.1, 0.11, 0.12, 0.13, 0.14, 0.15, 0.16, 0.17, 0.18];
const risingSeries = risingTimes.map((takenAt, i) => ({
  takenAt,
  source: 'openrouter-api',
  prices: {
    x: { provider: 'X', prompt: risingInputs[i], completion: 1, discount: null, quantization: null },
    y: { provider: 'Y', prompt: 1, completion: 1, discount: null, quantization: null },
  },
}));
const risingEvents = risingTimes.slice(1).map((at, i) =>
  priceMove('a/b', at, 'X', 'x', risingInputs[i], risingInputs[i + 1])).reverse();

test('dynamicProviders: X, repriced at all eight checks up to 02:00, is dynamic there with its 24-hour range', () => {
  const index = repricingIndex(risingEvents);
  assert.deepEqual(
    dynamicProviders(index, '2026-11-17T02:00:00Z', ['X'], risingSeries),
    [{ provider: 'X', checks: 8, of: 8, range: { input: { low: 0.1, high: 0.18 }, output: { low: 1, high: 1 } } }],
  );
  assert.equal(
    JSON.stringify(dynamicProviders(index, '2026-11-17T02:00:00Z', ['X'], risingSeries)[0]),
    '{"provider":"X","checks":8,"of":8,"range":{"input":{"low":0.1,"high":0.18},"output":{"low":1,"high":1}}}',
  );
});

test('dynamicProviders: seven changing checks are not enough, and the range is null without a series', () => {
  const index = repricingIndex(risingEvents);
  assert.deepEqual(dynamicProviders(index, '2026-11-17T01:45:00Z', ['X'], risingSeries), []);
  assert.deepEqual(
    dynamicProviders(index, '2026-11-17T02:00:00Z', ['X']),
    [{ provider: 'X', checks: 8, of: 8, range: { input: null, output: null } }],
  );
  assert.deepEqual(dynamicProviders(index, '2026-11-17T02:00:00Z', []), []);
  assert.deepEqual(dynamicProviders(index, 'not a time', ['X']), []);
});

test('dynamicProviders counts checks on every model, needs half of them, and leaves archived sources out', () => {
  // X moves at 8 checks; Z at 9 others on another model: X changed at 8 of 17 checks.
  const xTimes = risingTimes.slice(1);
  const zTimes = [
    '2026-11-17T00:05:00Z', '2026-11-17T00:20:00Z', '2026-11-17T00:35:00Z',
    '2026-11-17T00:50:00Z', '2026-11-17T01:05:00Z', '2026-11-17T01:20:00Z',
    '2026-11-17T01:35:00Z', '2026-11-17T01:50:00Z', '2026-11-17T01:55:00Z',
  ];
  const events = [
    ...xTimes.map((at, i) => priceMove('a/b', at, 'X', 'x', 0.1 + i / 100, 0.11 + i / 100)),
    ...zTimes.map(at => priceMove('c/d', at, 'Z', 'z', 1, 1.1)),
  ];
  const index = repricingIndex(events);
  assert.deepEqual(dynamicProviders(index, '2026-11-17T02:00:00Z', ['X', 'Z']), [
    { provider: 'Z', checks: 9, of: 17, range: { input: null, output: null } },
  ]);

  const archived = xTimes.map((at, i) => ({
    ...priceMove('a/b', at, 'X', 'x', 0.1 + i / 100, 0.11 + i / 100),
    sources: i === 7 ? ['openrouter-api', 'archived-model-page'] : API,
  }));
  assert.deepEqual(dynamicProviders(repricingIndex(archived), '2026-11-17T02:00:00Z', ['X']), []);
});

test('dynamicProviders looks back 24 hours, so moves a day old no longer count', () => {
  const index = repricingIndex(risingEvents);
  assert.deepEqual(
    dynamicProviders(index, '2026-11-18T00:15:00Z', ['X']),
    [{ provider: 'X', checks: 8, of: 8, range: { input: null, output: null } }],
  );
  assert.deepEqual(dynamicProviders(index, '2026-11-18T00:15:01Z', ['X']), []);
});

// Provider P changes price at ten checks across three models; Q once. At the last
// check P also becomes the cheapest on m/3.
const checks10 = [
  '2026-11-17T00:15:00Z', '2026-11-17T00:30:00Z', '2026-11-17T00:45:00Z',
  '2026-11-17T01:00:00Z', '2026-11-17T01:15:00Z', '2026-11-17T01:30:00Z',
  '2026-11-17T01:45:00Z', '2026-11-17T02:00:00Z', '2026-11-17T02:15:00Z',
  '2026-11-17T02:30:00Z',
];
const pMove = (model, at, i) =>
  priceMove(model, at, 'P', 'p/fp8', i % 2 ? 0.11 : 0.1, i % 2 ? 0.1 : 0.11);
const pqEvents = checks10.map((at, i) => [
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

test('routineMoves picks out P\'s moves from its eighth changing check on, except where it became the cheapest', () => {
  const routine = routineMoves(pqEvents);
  assert.deepEqual(
    pqEvents.filter(e => routine.has(e)).map(e => `${e.provider} ${e.model} ${e.at}`),
    [
      'P m/1 2026-11-17T02:30:00Z',
      'P m/2 2026-11-17T02:30:00Z',
      'P m/1 2026-11-17T02:15:00Z',
      'P m/2 2026-11-17T02:15:00Z',
      'P m/3 2026-11-17T02:15:00Z',
      'P m/1 2026-11-17T02:00:00Z',
      'P m/2 2026-11-17T02:00:00Z',
      'P m/3 2026-11-17T02:00:00Z',
    ],
  );
});

test('routineMoves finds nothing before the eighth changing check', () => {
  const early = pqEvents.filter(e => e.at <= '2026-11-17T01:45:00Z');
  assert.equal(early.length, 21);
  assert.equal(routineMoves(early).size, 0);
});

test('routineMove keeps a dynamic provider\'s move that pushes a range past 3x, and any move by others', () => {
  const dynamic = new Set(['X']);
  const fell = priceMove('a/b', '2026-11-17T02:00:00Z', 'X', 'x', 0.34, 0.32);
  const crossed = {
    type: 'spread-crossed', model: 'a/b', at: '2026-11-17T02:00:00Z', since: '2026-11-17T01:45:00Z', sources: API,
    input: { from: 2.94, to: 3.125, low: 0.32, high: 1, up: true, cause: 'cheapest-fell' }, output: null, up: true, cause: 'cheapest-fell',
  };
  assert.equal(routineMove(fell, [fell, crossed], dynamic), false);
  assert.equal(routineMove(fell, [fell], dynamic), true);
  assert.equal(routineMove(fell, [fell, { ...crossed, input: { ...crossed.input, up: false } }], dynamic), true);
  assert.equal(routineMove({ ...fell, provider: 'Z' }, [fell], dynamic), false);
  assert.equal(routineMove(crossed, [fell, crossed], dynamic), false);

  const rose = priceMove('a/b', '2026-11-17T02:00:00Z', 'X', 'x', 3, 3.3);
  const priciest = { ...crossed, input: { from: 2.9, to: 3.3, low: 1, high: 3.3, up: true, cause: 'priciest-rose' } };
  assert.equal(routineMove(rose, [rose, priciest], dynamic), false);

  const stopped = {
    type: 'cheapest-changed', model: 'a/b', at: '2026-11-17T02:00:00Z', since: '2026-11-17T01:45:00Z', sources: API,
    input: null,
    output: { from: ['x'], to: ['y'], fromProviders: ['X'], toProviders: ['Y'], toPrice: 1, fromNow: 1.1, fromLeft: false },
  };
  assert.equal(routineMove(rose, [rose, stopped], dynamic), false);
});
