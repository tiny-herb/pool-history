import test from 'node:test';
import assert from 'node:assert/strict';
import { diffModel, diffSnapshots, eventSentence } from '../src/events.mjs';

// Event sentences held verbatim. Lines that other files frame (pills, feed titles,
// CLI columns) are asserted only for the sentence this file returns.

function ep(tag, provider, prompt, completion, { discount = 0, quantization = null } = {}) {
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

const poolA = () => [
  ep('gmicloud/bf16', 'GMICloud', 0.3698, 0.7395, { discount: 0.15 }),
  ep('xiaomi/fp8', 'Xiaomi', 0.435, 0.87),
  ep('deepinfra/fp8', 'DeepInfra', 0.387, 0.783, { discount: 0.1 }),
  ep('streamlake', 'StreamLake', 0.522, 1.044),
  ep('novitaai', 'NovitaAI', 0.435, 0.87),
];

const poolB = () => [
  ep('xiaomi/fp8', 'Xiaomi', 0.435, 0.87),
  ep('deepinfra/fp8', 'DeepInfra', 0.387, 0.783, { discount: 0.1 }),
  ep('primalabs/fp8', 'PrimaLabs', 4, 8),
  ep('gmicloud/bf16', 'GMICloud', 0.3263, 0.6525, { discount: 0.25 }),
  ep('streamlake', 'StreamLake', 0.522, 1.044),
];

function only(list, type, tag) {
  const found = list.filter((e) => e.type === type && (tag === undefined || e.tag === tag));
  assert.equal(found.length, 1, `one ${type} ${tag ?? ''} event`);
  return found[0];
}

// "<at> <type> <flags json> | <sentence> | <pill>"
function eventLine(line) {
  const [head, sentence] = line.split(' | ');
  const match = /^(\S+) (\S+) (\{.*\})$/.exec(head);
  return { at: match[1], type: match[2], flags: JSON.parse(match[3]), sentence };
}

test('departure confirmation, briefly unlisted, rejoined and replacedBy sentences', () => {
  const wafer = ep('wafer', 'Wafer', 0.192, 16);
  const relace = ep('relace/fp4', 'Relace', 0.1824, 11);
  const sail = ep('sail-research/fp4', 'Sail Research', 0.2, 12);
  const sailUs = ep('sail-research/fp4/us', 'Sail Research', 0.2, 12);
  const full = [wafer, relace, sail];
  const without = [wafer, relace];

  const leftAt0006 = only(diffModel(full, without), 'left', 'sail-research/fp4');
  const joinedAt0009 = only(diffModel(without, full), 'joined', 'sail-research/fp4');

  const lines = [
    [leftAt0006, '2026-11-17T00:06:00Z left {"confirmed":false} | Sail Research (sail-research/fp4) missing at the last check; may come back | <span class="pill pill-neutral">not listed · unconfirmed</span>'],
    [leftAt0006, '2026-11-17T00:06:00Z left {"confirmed":true} | Sail Research (sail-research/fp4) left | <span class="pill pill-neutral">left</span>'],
    [joinedAt0009, '2026-11-17T00:09:00Z joined {"rejoined":true} | Sail Research (sail-research/fp4) joined at $0.20 / $12.00 per M, input and output 1.1x the cheapest (Relace) | <span class="pill pill-neutral">joined</span>'],
    [leftAt0006, '2026-11-17T00:06:00Z left {"confirmed":false,"returned":true} | Sail Research (sail-research/fp4) was briefly unlisted and came back | <span class="pill pill-neutral">briefly unlisted</span>'],
  ];
  for (const [event, line] of lines) {
    const { type, flags, sentence } = eventLine(line);
    assert.equal(event.type, type);
    assert.equal(eventSentence({ ...event, ...flags }), sentence);
  }

  // Back under a new endpoint id. The 00:18 pools hold Wafer and Sail Research only:
  // with Relace's $11.00 output in the pool the cheapest output never moves (4.4).
  const replaced = diffModel([wafer, sail], [wafer, sailUs]);
  const replacement = [
    [only(replaced, 'left', 'sail-research/fp4'), '2026-11-17T00:18:00Z left {"confirmed":false,"replacedBy":"sail-research/fp4/us"} | Sail Research endpoint sail-research/fp4 replaced by sail-research/fp4/us | <span class="pill pill-neutral">endpoint changed</span>'],
    [only(replaced, 'joined', 'sail-research/fp4/us'), '2026-11-17T00:18:00Z joined {"replaces":"sail-research/fp4"} | Sail Research endpoint changed: sail-research/fp4 to sail-research/fp4/us, at $0.20 / $12.00 per M | <span class="pill pill-neutral">endpoint changed</span>'],
    [only(replaced, 'cheapest-changed'), '2026-11-17T00:18:00Z cheapest-changed {} | Cheapest output: now sail-research/fp4/us at $12.00 per M · was sail-research/fp4 (left) | <span class="pill pill-neutral">cheapest</span>'],
  ];
  for (const [event, line] of replacement) {
    const { type, flags, sentence } = eventLine(line);
    assert.equal(event.type, type);
    assert.equal(eventSentence({ ...event, ...flags }), sentence);
  }
});

test('join sentences', () => {
  const free = only(diffModel(
    [ep('f', 'Free', 0, 0)],
    [ep('f', 'Free', 0, 0), ep('p', 'Paid', 1, 2)],
  ), 'joined', 'p');
  assert.equal(free.ratio, null);
  assert.equal(eventSentence(free), 'Paid (p) joined at $1.00 / $2.00 per M, the cheapest (Free) is free');

  const q = only(diffModel(poolA(), [...poolA(), ep('q', 'Q', null, null)]), 'joined', 'q');
  assert.equal(eventSentence(q), 'Q joined (price not recorded)');

  const flash = [ep('relace/fp4', 'Relace', 0.0399, 0.0784), ep('fireworks/us', 'Fireworks', 0.225, 0.75)];
  const baidu = only(diffModel(flash, [...flash, ep('baidu/fp8', 'Baidu', 0.15, 0.5)]), 'joined', 'baidu/fp8');
  assert.equal(eventSentence(baidu), 'Baidu (baidu/fp8) joined at $0.15 / $0.50 per M, input 3.8x, output 6.4x the cheapest (Relace)');

  const wafer = ep('wafer/fast', 'Wafer', 0.153, 16);
  const chutes = ep('chutes/mxfp4', 'Chutes', 1.85, 9.5);
  const kimi = diffModel(
    [wafer, chutes, ep('sail-research/fp4', 'Sail Research', 0.345, 16.58)],
    [wafer, chutes, ep('modal/mxfp4', 'Modal', 3, 15), ep('sail-research/fp4/us', 'Sail Research', 0.345, 16.58)],
  );
  assert.equal(
    eventSentence(only(kimi, 'joined', 'modal/mxfp4')),
    'Modal (modal/mxfp4) joined at $3.00 / $15.00 per M, input 20x the cheapest (Wafer), output 1.6x the cheapest (Chutes)',
  );
  // The pairing of the Sail Research departure with its join is the history's (3.3).
  assert.equal(
    eventSentence({ ...only(kimi, 'joined', 'sail-research/fp4/us'), replaces: 'sail-research/fp4' }),
    'Sail Research endpoint changed: sail-research/fp4 to sail-research/fp4/us, at $0.345 / $16.58 per M',
  );
});

test('departure sentences at 10:15', () => {
  // Observed at 10:00, 10:15 and 10:45: the 10:45 observation confirms (3.3).
  const confirmed = (before, after, tag) => ({ ...only(diffModel(before, after), 'left', tag), confirmed: true });

  const eu = ep('mistral/eu', 'Mistral', 0.44, 2.2);
  assert.equal(
    eventSentence(confirmed([ep('mistral/zdr', 'Mistral', 0.4, 2), eu], [eu], 'mistral/zdr')),
    'Mistral (mistral/zdr) endpoint removed; only Mistral (mistral/eu) remains',
  );

  const azure = ep('azure', 'Azure', 30, 180);
  const openai = ep('openai', 'OpenAI', 30, 180);
  assert.equal(
    eventSentence(confirmed([ep('openai/flex', 'OpenAI', 15, 90), azure, openai], [azure, openai], 'openai/flex')),
    'OpenAI (openai/flex) endpoint removed',
  );

  const bedrock = ep('amazon-bedrock/us-west-2', 'Amazon Bedrock', 0.15, 0.6);
  assert.equal(
    eventSentence(confirmed([ep('siliconflow/fp8', 'SiliconFlow', 0.07, 0.28), bedrock], [bedrock], 'siliconflow/fp8')),
    'SiliconFlow (siliconflow/fp8) left; only Amazon Bedrock (amazon-bedrock/us-west-2) remains',
  );

  const venice = ep('venice/fp8', 'Venice', 0.45, 3.2);
  const cerebras = ep('cerebras/fp16', 'Cerebras', 0.99, 1.49);
  assert.equal(
    eventSentence(confirmed([ep('io-net/fp8', 'Io Net', 0.05, 0.9), venice, cerebras], [venice, cerebras], 'io-net/fp8')),
    'Io Net (io-net/fp8) left',
  );

  // The last input's 10:45 pool is the first again: the departure returned.
  const baseten = ep('baseten/fast', 'BaseTen', 0.6, 2.4);
  const ionstream = only(diffModel([ep('ionstream/flex', 'Ionstream', 0.0775, 0.2325), baseten], [baseten]), 'left', 'ionstream/flex');
  assert.equal(
    eventSentence({ ...ionstream, confirmed: false, returned: true }),
    'Ionstream (ionstream/flex) was briefly unlisted and came back',
  );
});

test('price-change sentences', () => {
  const sep25 = [
    ep('gmicloud', 'GMICloud', 0.2088, 0.3096, { discount: 0.28 }),
    ep('siliconflow', 'SiliconFlow', 0.259, 0.42),
    ep('deepinfra', 'DeepInfra', 0.26, 0.38),
    ep('atlascloud', 'AtlasCloud', 0.26, 0.38),
    ep('venice', 'Venice', 0.2683, 0.3902, { discount: 0.19 }),
    ep('novitaai', 'NovitaAI', 0.269, 0.4),
    ep('baidu', 'Baidu', 0.28, 0.42),
    ep('digitalocean', 'DigitalOcean', 0.3, 0.96),
    ep('alibaba-cloud-int', 'Alibaba Cloud Int.', 0.3705, 1.1115),
    ep('friendli', 'Friendli', 0.5, 1.5),
    ep('google-vertex', 'Google Vertex', 0.56, 1.68),
    ep('phala', 'Phala', 1, 1),
    ep('mara', 'MARA', 3, 4.5),
    ep('sambanova', 'SambaNova', 3, 4.5),
  ];
  const oct28 = [
    ep('digitalocean', 'DigitalOcean', 0.3, 0.96),
    ep('deepinfra', 'DeepInfra', 0.26, 0.38),
    ep('venice', 'Venice', 0.2683, 0.3902, { discount: 0.19 }),
    ep('siliconflow', 'SiliconFlow', 0.259, 0.8),
    ep('phala', 'Phala', 1, 1),
    ep('atlascloud', 'AtlasCloud', 0.26, 0.38),
    ep('baidu', 'Baidu', 0.28, 0.42),
    ep('gmicloud', 'GMICloud', 0.2088, 0.3096, { discount: 0.28 }),
    ep('sambanova', 'SambaNova', 3, 4.5),
    ep('google-vertex', 'Google Vertex', 0.56, 1.68),
    ep('mara', 'MARA', 3, 4.5),
  ];
  assert.equal(
    eventSentence(only(diffModel(sep25, oct28), 'price-changed', 'siliconflow')),
    'SiliconFlow · output $0.42 to $0.80 per M (+90%) · input 1.2x, output 2.6x the cheapest (GMICloud)',
  );

  const doubled = poolA().map((e) => (e.tag === 'streamlake' ? { ...e, prompt: 1.044, completion: 0.783 } : e));
  assert.equal(
    eventSentence(only(diffModel(poolA(), doubled), 'price-changed', 'streamlake')),
    'StreamLake · input $0.522 to $1.04 per M (+100%) · output $1.04 to $0.783 (-25%) · input 2.8x, output 1.1x the cheapest (GMICloud)',
  );

  const relace = ep('relace/fp8', 'Relace', 0.9, 1.45);
  const siliconflow = ep('siliconflow/fp8', 'SiliconFlow', 1, 1.45);
  const v4pro = diffModel(
    [ep('streamlake/fp8', 'StreamLake', 0.869, 1.74, { discount: 0.5 }), relace, siliconflow],
    [ep('streamlake/fp8', 'StreamLake', 0.864, 1.73, { discount: 0.497 }), relace, siliconflow],
  );
  assert.equal(
    eventSentence(only(v4pro, 'price-changed', 'streamlake/fp8')),
    'StreamLake (streamlake/fp8) · input $0.869 to $0.864 per M (-1%) · output $1.74 to $1.73 (-1%) · listed discount 50% to 50% · cheapest input; output 1.2x the cheapest (Relace, SiliconFlow)',
  );
});

test('cheapest-change sentences', () => {
  const cheapest = (before, after) => eventSentence(only(diffModel(before, after), 'cheapest-changed'));

  const deepinfra = ep('deepinfra/bf16/flex', 'DeepInfra', 0.08, 0.12);
  const darkbloom = ep('darkbloom/fp4', 'Darkbloom', 0.08, 0.13);
  assert.equal(
    cheapest(
      [ep('primeintellect/bf16', 'PrimeIntellect', 0.069, 0.101), deepinfra, darkbloom],
      [ep('primeintellect/bf16', 'PrimeIntellect', 0.142, 0.209), deepinfra, darkbloom],
    ),
    'Cheapest input: now Darkbloom and DeepInfra, tied, at $0.08 per M · was PrimeIntellect, now $0.142. Cheapest output: now DeepInfra at $0.12 per M · was PrimeIntellect, now $0.209',
  );

  const near = ep('near-ai/fp4', 'Near AI', 0.03, 0.15);
  const venice = ep('venice/int4', 'Venice', 0.03, 0.15);
  assert.equal(
    cheapest(
      [near, venice, ep('primeintellect/fp4', 'PrimeIntellect', 0.054, 0.117)],
      [near, venice, ep('primeintellect/fp4', 'PrimeIntellect', 0.156, 0.335)],
    ),
    'Cheapest output: now Near AI and Venice, tied, at $0.15 per M · was PrimeIntellect, now $0.335',
  );

  const bloom = ep('darkbloom', 'Darkbloom', 0.04, 0.15);
  assert.equal(
    cheapest(
      [bloom, ep('primeintellect/bf16', 'PrimeIntellect', 0.048, 0.143)],
      [bloom, ep('primeintellect/bf16', 'PrimeIntellect', 0.04, 0.121)],
    ),
    'Cheapest input: PrimeIntellect now ties Darkbloom',
  );

  const five = [
    ep('gmicloud/bf16', 'GMICloud', 0.834, 2.501),
    ep('deepinfra/fp4', 'DeepInfra', 0.834, 2.501),
    ep('novita/fp8', 'Novita', 0.834, 2.501),
    ep('siliconflow/fp8', 'SiliconFlow', 0.834, 2.501),
    ep('tencent/fp8', 'Tencent', 0.834, 2.501),
  ];
  assert.equal(
    cheapest(five, five.map((e) => (e.tag === 'tencent/fp8' ? { ...e, prompt: 0.7506, completion: 2.2509 } : e))),
    'Cheapest endpoint: Tencent alone (DeepInfra, GMICloud, Novita, SiliconFlow no longer tie)',
  );

  assert.equal(
    cheapest(poolA(), poolA().map((e) => (e.tag === 'deepinfra/fp8' ? { ...e, prompt: 0.1 } : e))),
    'Cheapest input: now DeepInfra at $0.10 per M · was GMICloud, now $0.37',
  );
});

test('price range sentences', () => {
  const range = (before, after) => eventSentence(only(diffModel(before, after), 'spread-crossed'));
  const together = ep('together', 'Together', 0.17, 0.25);
  assert.equal(
    range(
      [ep('primeintellect/bf16', 'PrimeIntellect', 0.088, 0.129), together],
      [ep('primeintellect/bf16', 'PrimeIntellect', 0.046, 0.068), together],
    ),
    'Price range widened · input $0.046 to $0.17 per M (3.7x, above 3x, as the cheapest fell) · output $0.068 to $0.25 (3.7x, above 3x, as the cheapest fell)',
  );

  const siliconflow = ep('siliconflow/fp8', 'SiliconFlow', 0.24, 1.8);
  assert.equal(
    range(
      [ep('primeintellect/fp8', 'PrimeIntellect', 0.06, 0.553), siliconflow],
      [ep('primeintellect/fp8', 'PrimeIntellect', 0.074, 0.677), siliconflow],
    ),
    'Price range narrowed · output back under 3x (2.7x)',
  );
});

test('the diff command prints each event sentence after the model id', () => {
  const snapshot = (takenAt, listed, endpoints) => ({
    takenAt,
    source: 'archived-model-page',
    partial: true,
    note: null,
    modelCount: 1,
    models: { 'xiaomi/mimo-v2.6-pro': { name: 'Xiaomi: MiMo-V2.6-Pro', listed, endpoints } },
  });
  const a = snapshot('2026-10-27T16:45:15Z', { prompt: 0.3698, completion: 0.7395 }, poolA());
  const c = snapshot('2026-11-10T17:15:01Z', { prompt: 0.3263, completion: 0.6525 }, poolB());

  const lines = [
    'xiaomi/mimo-v2.6-pro  NovitaAI left',
    'xiaomi/mimo-v2.6-pro  PrimaLabs (primalabs/fp8) joined at $4.00 / $8.00 per M, input and output 12x the cheapest (GMICloud)',
    'xiaomi/mimo-v2.6-pro  GMICloud (gmicloud/bf16) · input $0.37 to $0.326 per M (-12%) · output $0.74 to $0.652 (-12%) · listed discount 15% to 25% · cheapest on input and output',
    'xiaomi/mimo-v2.6-pro  Price range widened · input $0.326 to $4.00 per M (12x, above 3x) · output $0.652 to $8.00 (12x, above 3x)',
  ];
  const result = diffSnapshots(a, c);
  assert.equal(result.length, lines.length);
  result.forEach((event, i) => {
    const [model, sentence] = lines[i].split('  ');
    assert.equal(event.model, model);
    assert.equal(eventSentence(event), sentence);
  });
});
