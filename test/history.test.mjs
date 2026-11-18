import test from 'node:test';
import assert from 'node:assert/strict';

import {
  uptimeOf,
  CHECK_GAP_MINUTES,
  LEFT_CONFIRM_MINUTES,
  HistoryBuilder
} from '../src/history.mjs';
import { eventSentence } from '../src/events.mjs';

function endpoint(
  tag,
  provider = tag,
  prompt = 1,
  completion = 1,
  extra = {}
) {
  return {
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
    ...extra
  };
}

function snapshot(
  takenAt,
  models,
  {
    source = 'openrouter-api',
    partial = false,
    modelCount = Object.keys(models).length,
    catalogue
  } = {}
) {
  const result = {
    takenAt,
    source,
    partial,
    note: null,
    modelCount,
    models
  };

  if (catalogue !== undefined) result.catalogue = catalogue;
  return result;
}

function observed(name, endpoints, extra = {}) {
  return {
    name,
    listed: { prompt: 1, completion: 1 },
    endpoints,
    ...extra
  };
}

function event(history, type, model, predicate = () => true) {
  const found = history.events.find(item =>
    item.type === type && item.model === model && predicate(item)
  );
  assert.ok(found, `expected ${type} event for ${model}`);
  return found;
}

test('exports the fixed history timing constants and chooses daily uptime first', () => {
  assert.equal(CHECK_GAP_MINUTES, 20);
  assert.equal(LEFT_CONFIRM_MINUTES, 30);

  assert.equal(uptimeOf(endpoint('a', 'A', 1, 1, {
    uptime1d: 99.5,
    uptimePage: 87
  })), 99.5);

  assert.equal(uptimeOf(endpoint('a', 'A', 1, 1, {
    uptime1d: null,
    uptimePage: 87
  })), 87);

  assert.equal(uptimeOf(endpoint('a', 'A', 1, 1, {
    uptime1d: null,
    uptimePage: null
  })), null);
});

test('rejects snapshots added out of time order', () => {
  const builder = new HistoryBuilder();

  builder.add(snapshot('2026-11-17T11:07:00Z', {
    'a/b': observed('A: B', [endpoint('x', 'X')])
  }));

  assert.throws(
    () => builder.add(snapshot('2026-11-17T10:07:00Z', {
      'a/b': observed('A: B', [endpoint('x', 'X')])
    })),
    {
      message: 'snapshots must be added in time order: 2026-11-17T10:07:00Z came after 2026-11-17T11:07:00Z'
    }
  );
});

test('keeps one series point per observed model observation and trims names', () => {
  const builder = new HistoryBuilder();

  builder.add(snapshot('2026-11-17T10:07:00Z', {
    'a/b': observed(' Gemma 4 26B A4B ', [
      endpoint('x', 'X', 1, 2, { uptime1d: 99 })
    ])
  }));

  builder.add(snapshot('2026-11-17T11:07:00Z', {
    'a/b': observed('', [
      endpoint('x', 'X', 1.5, 2, { uptimePage: 98 })
    ])
  }));

  const history = builder.finish();
  const model = history.models['a/b'];

  assert.equal(model.slug, 'a/b');
  assert.equal(model.name, 'Gemma 4 26B A4B');
  assert.equal(model.series.length, 2);
  assert.equal(model.firstSeen.takenAt, '2026-11-17T10:07:00Z');
  assert.equal(model.latest.takenAt, '2026-11-17T11:07:00Z');
  assert.equal(model.latest.source, 'openrouter-api');
  assert.equal(model.latest.endpoints[0].tag, 'x');
  assert.equal(model.series[0].minUptime, 99);
  assert.equal(model.series[1].minUptime, 98);
  assert.deepEqual(model.series[1].tags, ['x']);
  assert.equal(history.takenAt, '2026-11-17T11:07:00Z');
  assert.equal(history.snapshots.length, 2);
  assert.deepEqual(history.snapshots.map(head => head.takenAt), [
    '2026-11-17T10:07:00Z',
    '2026-11-17T11:07:00Z'
  ]);
});

test('dates a change from the last logged check that read the model', () => {
  const checks = [
    { at: '2026-11-17T10:22:00Z', models: 1, errors: [] },
    { at: '2026-11-17T10:37:00Z', models: 1, errors: [] },
    { at: '2026-11-17T10:52:00Z', models: 1, errors: ['a/b'] }
  ];

  const builder = new HistoryBuilder({ checks });

  builder.add(snapshot('2026-11-17T10:07:00Z', {
    'a/b': observed('A: B', [
      endpoint('x', 'X', 1, 1),
      endpoint('y', 'Y', 2, 2)
    ])
  }));

  builder.add(snapshot('2026-11-17T11:07:00Z', {
    'a/b': observed('A: B', [
      endpoint('x', 'X', 1.5, 1),
      endpoint('y', 'Y', 2, 2)
    ])
  }));

  const changed = event(builder.finish(), 'price-changed', 'a/b', item => item.tag === 'x');

  assert.equal(changed.at, '2026-11-17T11:07:00Z');
  assert.equal(changed.since, '2026-11-17T10:37:00Z');
  assert.deepEqual(changed.sources, ['openrouter-api', 'openrouter-api']);
  assert.equal(changed.watcherOff, undefined);
});

test('marks watcherOff when the last successful check is more than twenty minutes old', () => {
  const builder = new HistoryBuilder({
    checks: [
      { at: '2026-11-17T10:22:00Z', models: 1, errors: [] }
    ]
  });

  builder.add(snapshot('2026-11-17T10:07:00Z', {
    'a/b': observed('A: B', [endpoint('x', 'X', 1, 1)])
  }));
  builder.add(snapshot('2026-11-17T11:07:00Z', {
    'a/b': observed('A: B', [endpoint('x', 'X', 1.5, 1)])
  }));

  const changed = event(builder.finish(), 'price-changed', 'a/b');

  assert.equal(changed.since, '2026-11-17T10:22:00Z');
  assert.equal(changed.watcherOff, true);
});

test('without a check log, windows use the model previous observation', () => {
  const builder = new HistoryBuilder();

  builder.add(snapshot('2026-11-17T10:07:00Z', {
    'a/b': observed('A: B', [endpoint('x', 'X', 1, 1)])
  }));
  builder.add(snapshot('2026-11-17T11:07:00Z', {
    'a/b': observed('A: B', [endpoint('x', 'X', 1.5, 1)])
  }));

  const changed = event(builder.finish(), 'price-changed', 'a/b');

  assert.equal(changed.since, '2026-11-17T10:07:00Z');
  assert.deepEqual(changed.sources, ['openrouter-api', 'openrouter-api']);
  assert.equal(changed.watcherOff, undefined);
});

test('holds departures pending until a later observation confirms them after thirty minutes', () => {
  const builder = new HistoryBuilder();

  builder.add(snapshot('2026-11-17T00:03:00Z', {
    'moonshotai/kimi-k3': observed('MoonshotAI: Kimi K3', [
      endpoint('wafer', 'Wafer', 0.192, 16),
      endpoint('relace/fp4', 'Relace', 0.1824, 11),
      endpoint('sail-research/fp4', 'Sail Research', 0.2, 12)
    ])
  }));

  builder.add(snapshot('2026-11-17T00:06:00Z', {
    'moonshotai/kimi-k3': observed('MoonshotAI: Kimi K3', [
      endpoint('wafer', 'Wafer', 0.192, 16),
      endpoint('relace/fp4', 'Relace', 0.1824, 11)
    ])
  }));

  assert.deepEqual(builder.pendingModels(), ['moonshotai/kimi-k3']);

  builder.add(snapshot('2026-11-17T00:23:00Z', {
    'moonshotai/kimi-k3': observed('MoonshotAI: Kimi K3', [
      endpoint('wafer', 'Wafer', 0.192, 16),
      endpoint('relace/fp4', 'Relace', 0.1824, 11)
    ])
  }));

  let history = builder.finish();
  let left = event(history, 'left', 'moonshotai/kimi-k3',
    item => item.tag === 'sail-research/fp4');

  assert.equal(left.at, '2026-11-17T00:06:00Z');
  assert.equal(left.confirmed, false);

  const confirming = new HistoryBuilder();
  confirming.add(snapshot('2026-11-17T00:03:00Z', {
    'moonshotai/kimi-k3': observed('MoonshotAI: Kimi K3', [
      endpoint('wafer', 'Wafer', 0.192, 16),
      endpoint('relace/fp4', 'Relace', 0.1824, 11),
      endpoint('sail-research/fp4', 'Sail Research', 0.2, 12)
    ])
  }));
  confirming.add(snapshot('2026-11-17T00:06:00Z', {
    'moonshotai/kimi-k3': observed('MoonshotAI: Kimi K3', [
      endpoint('wafer', 'Wafer', 0.192, 16),
      endpoint('relace/fp4', 'Relace', 0.1824, 11)
    ])
  }));
  confirming.add(snapshot('2026-11-17T00:36:00Z', {
    'moonshotai/kimi-k3': observed('MoonshotAI: Kimi K3', [
      endpoint('wafer', 'Wafer', 0.192, 16),
      endpoint('relace/fp4', 'Relace', 0.1824, 11)
    ])
  }));

  history = confirming.finish();
  left = event(history, 'left', 'moonshotai/kimi-k3',
    item => item.tag === 'sail-research/fp4');

  assert.equal(left.confirmed, true);
  assert.deepEqual(confirming.pendingModels(), []);
});

test('a returning endpoint changes the earlier departure and hides its rejoin event', () => {
  const builder = new HistoryBuilder();

  builder.add(snapshot('2026-11-17T00:03:00Z', {
    'moonshotai/kimi-k3': observed('MoonshotAI: Kimi K3', [
      endpoint('sail-research/fp4', 'Sail Research', 0.2, 12),
      endpoint('relace/fp4', 'Relace', 0.1824, 11)
    ])
  }));
  builder.add(snapshot('2026-11-17T00:06:00Z', {
    'moonshotai/kimi-k3': observed('MoonshotAI: Kimi K3', [
      endpoint('relace/fp4', 'Relace', 0.1824, 11)
    ])
  }));
  builder.add(snapshot('2026-11-17T00:09:00Z', {
    'moonshotai/kimi-k3': observed('MoonshotAI: Kimi K3', [
      endpoint('sail-research/fp4', 'Sail Research', 0.2, 12),
      endpoint('relace/fp4', 'Relace', 0.1824, 11)
    ])
  }));

  const history = builder.finish();
  const left = event(history, 'left', 'moonshotai/kimi-k3',
    item => item.tag === 'sail-research/fp4');
  const joined = event(history, 'joined', 'moonshotai/kimi-k3',
    item => item.tag === 'sail-research/fp4' && item.at === '2026-11-17T00:09:00Z');

  assert.equal(left.confirmed, false);
  assert.equal(left.returned, true);
  assert.equal(joined.rejoined, true);
  assert.deepEqual(builder.pendingModels(), []);
});

test('pairs a pending same-provider departure with a new endpoint id', () => {
  const builder = new HistoryBuilder();

  builder.add(snapshot('2026-11-17T00:03:00Z', {
    'moonshotai/kimi-k3': observed('MoonshotAI: Kimi K3', [
      endpoint('sail-research/fp4', 'Sail Research', 0.2, 12),
      endpoint('relace/fp4', 'Relace', 0.1824, 11)
    ])
  }));
  builder.add(snapshot('2026-11-17T00:06:00Z', {
    'moonshotai/kimi-k3': observed('MoonshotAI: Kimi K3', [
      endpoint('relace/fp4', 'Relace', 0.1824, 11)
    ])
  }));
  builder.add(snapshot('2026-11-17T00:09:00Z', {
    'moonshotai/kimi-k3': observed('MoonshotAI: Kimi K3', [
      endpoint('sail-research/fp4/us', 'Sail Research', 0.2, 12),
      endpoint('relace/fp4', 'Relace', 0.1824, 11)
    ])
  }));

  const history = builder.finish();
  const left = event(history, 'left', 'moonshotai/kimi-k3',
    item => item.tag === 'sail-research/fp4');
  const joined = event(history, 'joined', 'moonshotai/kimi-k3',
    item => item.tag === 'sail-research/fp4/us');

  assert.equal(left.replacedBy, 'sail-research/fp4/us');
  assert.equal(joined.replaces, 'sail-research/fp4');
  assert.deepEqual(builder.pendingModels(), []);
});

test('catalogues produce listings and delistings, while seeds without catalogues do not', () => {
  const builder = new HistoryBuilder();

  builder.add(snapshot('2026-10-27T16:45:15Z', {
    'xiaomi/mimo-v2.6-pro': observed('Xiaomi: MiMo-V2.6-Pro', [
      endpoint('gmicloud/bf16', 'GMICloud', 0.3698, 0.7395)
    ])
  }, {
    source: 'archived-model-page',
    partial: true,
    modelCount: 1
  }));

  builder.add(snapshot('2026-11-16T09:05:12Z', {
    'z/old': observed('Old', [endpoint('old', 'Old')]),
    'z/new': observed('New', [
      endpoint('n1', 'N1', 1, 2),
      endpoint('n2', 'N2', 1.5, 3)
    ])
  }, {
    catalogue: ['z/new', 'z/old'],
    modelCount: 2
  }));

  builder.add(snapshot('2026-11-17T06:17:00Z', {
    'z/new': observed('New', [
      endpoint('n1', 'N1', 1, 2),
      endpoint('n2', 'N2', 1.5, 3)
    ])
  }, {
    catalogue: ['z/new'],
    modelCount: 1
  }));

  const history = builder.finish();

  assert.equal(history.events.some(item => item.type === 'model-listed' &&
    item.model === 'z/new' && item.at === '2026-11-16T09:05:12Z'), false);

  const delisted = event(history, 'model-delisted', 'z/old');
  assert.equal(delisted.at, '2026-11-17T06:17:00Z');
  assert.equal(delisted.since, '2026-11-16T09:05:12Z');

  assert.equal(history.events.some(item =>
    item.type === 'model-listed' &&
    item.model === 'xiaomi/mimo-v2.6-pro'
  ), false);

  assert.deepEqual([...builder.knownCatalogue()].sort(), ['z/new']);
});

test('a later catalogue lists newly observed models and latest full state is retained', () => {
  const builder = new HistoryBuilder();

  builder.add(snapshot('2026-11-16T09:05:12Z', {
    'z/solo': observed('Solo', [endpoint('solo', 'Solo', 1, 2)])
  }, {
    catalogue: ['z/solo'],
    modelCount: 1
  }));

  builder.add(snapshot('2026-11-17T06:17:00Z', {
    'z/solo': observed('Solo', [endpoint('solo', 'Solo', 1, 2)]),
    'z/new': observed('New', [
      endpoint('n1', 'N1', 1, 2),
      endpoint('n2', 'N2', 1.5, 3)
    ])
  }, {
    catalogue: ['z/new', 'z/solo'],
    modelCount: 2
  }));

  const history = builder.finish();
  const listed = event(history, 'model-listed', 'z/new');

  assert.equal(listed.endpoints, 2);
  assert.equal(listed.at, '2026-11-17T06:17:00Z');
  assert.equal(listed.since, '2026-11-16T09:05:12Z');
  assert.deepEqual(listed.sources, ['openrouter-api', 'openrouter-api']);
  assert.deepEqual(history.latestFull, {
    takenAt: '2026-11-17T06:17:00Z',
    source: 'openrouter-api'
  });
  assert.equal(history.models['z/new'].inLatestFull, true);
  assert.deepEqual(history.models['z/new'].latestFull, history.latestFull);
});

test('non-text outputs erase per-token prices before comparison; a video or speech join with no listed price says so', () => {
  const builder = new HistoryBuilder();

  builder.add(snapshot('2026-11-17T10:00:00Z', {
    'fal/video': observed('Fal: Video', [
      endpoint('video-a', 'Fal', 1, 2)
    ], {
      outputModalities: ['video']
    }),
    'fal/speech': observed('Fal: Speech', [
      endpoint('speech-a', 'Fal', 1, 2)
    ], {
      outputModalities: ['speech']
    })
  }));

  builder.add(snapshot('2026-11-17T11:00:00Z', {
    'fal/video': observed('Fal: Video', [
      endpoint('video-a', 'Fal', 10, 20),
      endpoint('video-b', 'Fal', 30, 40)
    ], {
      outputModalities: ['video']
    }),
    'fal/speech': observed('Fal: Speech', [
      endpoint('speech-a', 'Fal', 10, 20),
      endpoint('speech-b', 'Fal', 30, 40)
    ], {
      outputModalities: ['speech']
    })
  }));

  const history = builder.finish();
  const joined = event(history, 'joined', 'fal/video',
    item => item.tag === 'video-b');
  const speech = event(history, 'joined', 'fal/speech',
    item => item.tag === 'speech-b');

  assert.equal(history.events.some(item => item.type === 'price-changed'), false);
  assert.equal(joined.prompt, null);
  assert.equal(joined.completion, null);
  assert.deepEqual(joined.prices, []);
  assert.equal(joined.priceNotPerToken, undefined);
  assert.equal(eventSentence(joined), 'Fal (video-b) joined; price not listed (see OpenRouter)');
  assert.equal(speech.priceNotPerToken, undefined);
  assert.deepEqual(speech.prices, []);
  assert.equal(eventSentence(speech), 'Fal (speech-b) joined; price not listed (see OpenRouter)');
  assert.equal(history.models['fal/video'].latest.endpoints[0].prompt, null);
  assert.equal(history.models['fal/video'].latest.endpoints[0].completion, null);
  assert.deepEqual(history.models['fal/video'].outputModalities, ['video']);
});

test('uses the last successful model check in each change window', () => {
  function changedWith(checks) {
    const builder = new HistoryBuilder({ checks });
    builder.add(snapshot('2026-11-17T10:07:00Z', {
      'a/b': observed('A: B', [endpoint('x', 'X', 1, 1)])
    }));
    builder.add(snapshot('2026-11-17T11:07:00Z', {
      'a/b': observed('A: B', [endpoint('x', 'X', 1.5, 1)])
    }));
    return event(builder.finish(), 'price-changed', 'a/b');
  }

  let changed = changedWith([]);
  assert.deepEqual(
    { since: changed.since, sources: changed.sources, watcherOff: Boolean(changed.watcherOff) },
    {
      since: '2026-11-17T10:07:00Z',
      sources: ['openrouter-api', 'openrouter-api'],
      watcherOff: false
    }
  );

  changed = changedWith([
    { at: '2026-11-17T10:22:00Z', models: 1, errors: [] },
    { at: '2026-11-17T10:37:00Z', models: 1, errors: [] },
    { at: '2026-11-17T10:52:00Z', models: 1, errors: [] }
  ]);
  assert.equal(changed.since, '2026-11-17T10:52:00Z');
  assert.equal(changed.watcherOff, undefined);

  changed = changedWith([
    { at: '2026-11-17T10:22:00Z', models: 1, errors: [] },
    { at: '2026-11-17T10:37:00Z', models: 1, errors: [] },
    { at: '2026-11-17T10:52:00Z', models: 1, errors: ['a/b'] }
  ]);
  assert.equal(changed.since, '2026-11-17T10:37:00Z');
  assert.equal(changed.watcherOff, undefined);
});

test('keeps departures pending, records returns, and pairs endpoint changes', () => {
  const returning = new HistoryBuilder();

  returning.add(snapshot('2026-11-17T00:03:00Z', {
    'moonshotai/kimi-k3': observed('MoonshotAI: Kimi K3', [
      endpoint('wafer', 'Wafer', 0.192, 16),
      endpoint('relace/fp4', 'Relace', 0.1824, 11),
      endpoint('sail-research/fp4', 'Sail Research', 0.2, 12)
    ])
  }));
  returning.add(snapshot('2026-11-17T00:06:00Z', {
    'moonshotai/kimi-k3': observed('MoonshotAI: Kimi K3', [
      endpoint('wafer', 'Wafer', 0.192, 16),
      endpoint('relace/fp4', 'Relace', 0.1824, 11)
    ])
  }));
  returning.add(snapshot('2026-11-17T00:23:00Z', {
    'moonshotai/kimi-k3': observed('MoonshotAI: Kimi K3', [
      endpoint('wafer', 'Wafer', 0.192, 16),
      endpoint('relace/fp4', 'Relace', 0.1824, 11)
    ])
  }));

  let history = returning.finish();
  let left = event(history, 'left', 'moonshotai/kimi-k3',
    item => item.tag === 'sail-research/fp4');
  assert.equal(left.confirmed, false);
  assert.equal(
    eventSentence(left),
    'Sail Research (sail-research/fp4) missing at the last check; may come back'
  );

  returning.add(snapshot('2026-11-17T00:26:00Z', {
    'moonshotai/kimi-k3': observed('MoonshotAI: Kimi K3', [
      endpoint('wafer', 'Wafer', 0.192, 16),
      endpoint('relace/fp4', 'Relace', 0.1824, 11),
      endpoint('sail-research/fp4', 'Sail Research', 0.2, 12)
    ])
  }));

  history = returning.finish();
  left = event(history, 'left', 'moonshotai/kimi-k3',
    item => item.tag === 'sail-research/fp4');
  const rejoined = event(history, 'joined', 'moonshotai/kimi-k3',
    item => item.tag === 'sail-research/fp4' &&
      item.at === '2026-11-17T00:26:00Z');

  assert.equal(left.returned, true);
  assert.equal(
    eventSentence(left),
    'Sail Research (sail-research/fp4) was briefly unlisted and came back'
  );
  assert.equal(rejoined.rejoined, true);

  const replaced = new HistoryBuilder();
  replaced.add(snapshot('2026-11-17T00:03:00Z', {
    'moonshotai/kimi-k3': observed('MoonshotAI: Kimi K3', [
      endpoint('wafer', 'Wafer', 0.192, 16),
      endpoint('relace/fp4', 'Relace', 0.1824, 11),
      endpoint('sail-research/fp4', 'Sail Research', 0.2, 12)
    ])
  }));
  replaced.add(snapshot('2026-11-17T00:18:00Z', {
    'moonshotai/kimi-k3': observed('MoonshotAI: Kimi K3', [
      endpoint('wafer', 'Wafer', 0.192, 16),
      endpoint('relace/fp4', 'Relace', 0.1824, 11),
      endpoint('sail-research/fp4/us', 'Sail Research', 0.2, 12)
    ])
  }));

  history = replaced.finish();
  left = event(history, 'left', 'moonshotai/kimi-k3',
    item => item.tag === 'sail-research/fp4');
  const joined = event(history, 'joined', 'moonshotai/kimi-k3',
    item => item.tag === 'sail-research/fp4/us');

  assert.equal(left.replacedBy, 'sail-research/fp4/us');
  assert.equal(joined.replaces, 'sail-research/fp4');
  assert.equal(
    eventSentence(left),
    'Sail Research endpoint sail-research/fp4 replaced by sail-research/fp4/us'
  );
  assert.equal(
    eventSentence(joined),
    'Sail Research endpoint changed: sail-research/fp4 to sail-research/fp4/us, at $0.20 / $12.00 per M'
  );
});

test('covers check windows, including watcher gaps and failed reads', () => {
  const cases = [
    {
      checks: [],
      since: '2026-11-17T10:07:00Z',
      watcherOff: undefined
    },
    {
      checks: [
        { at: '2026-11-17T10:22:00Z', models: 1, errors: [] },
        { at: '2026-11-17T10:37:00Z', models: 1, errors: [] },
        { at: '2026-11-17T10:52:00Z', models: 1, errors: [] }
      ],
      since: '2026-11-17T10:52:00Z',
      watcherOff: undefined
    },
    {
      checks: [
        { at: '2026-11-17T10:22:00Z', models: 1, errors: [] }
      ],
      since: '2026-11-17T10:22:00Z',
      watcherOff: true
    },
    {
      checks: [
        { at: '2026-11-17T10:22:00Z', models: 1, errors: [] },
        { at: '2026-11-17T10:37:00Z', models: 1, errors: [] },
        { at: '2026-11-17T10:52:00Z', models: 1, errors: ['a/b'] }
      ],
      since: '2026-11-17T10:37:00Z',
      watcherOff: undefined
    }
  ];

  for (const example of cases) {
    const builder = new HistoryBuilder({ checks: example.checks });
    builder.add(snapshot('2026-11-17T10:07:00Z', {
      'a/b': observed('A: B', [endpoint('x', 'X', 1, 1)])
    }));
    builder.add(snapshot('2026-11-17T11:07:00Z', {
      'a/b': observed('A: B', [endpoint('x', 'X', 1.5, 1)])
    }));

    const changed = event(builder.finish(), 'price-changed', 'a/b');
    assert.equal(changed.since, example.since);
    assert.deepEqual(changed.sources, ['openrouter-api', 'openrouter-api']);
    assert.equal(changed.watcherOff, example.watcherOff);
  }
});

test('covers pending departure confirmation and replacement flags', () => {
  const builder = new HistoryBuilder();

  builder.add(snapshot('2026-11-17T00:03:00Z', {
    'moonshotai/kimi-k3': observed('MoonshotAI: Kimi K3', [
      endpoint('wafer', 'Wafer', 0.192, 16),
      endpoint('relace/fp4', 'Relace', 0.1824, 11),
      endpoint('sail-research/fp4', 'Sail Research', 0.2, 12)
    ])
  }));
  builder.add(snapshot('2026-11-17T00:06:00Z', {
    'moonshotai/kimi-k3': observed('MoonshotAI: Kimi K3', [
      endpoint('wafer', 'Wafer', 0.192, 16),
      endpoint('relace/fp4', 'Relace', 0.1824, 11)
    ])
  }));
  builder.add(snapshot('2026-11-17T00:23:00Z', {
    'moonshotai/kimi-k3': observed('MoonshotAI: Kimi K3', [
      endpoint('wafer', 'Wafer', 0.192, 16),
      endpoint('relace/fp4', 'Relace', 0.1824, 11)
    ])
  }));

  let history = builder.finish();
  let left = event(history, 'left', 'moonshotai/kimi-k3',
    item => item.tag === 'sail-research/fp4');
  assert.equal(left.confirmed, false);
  assert.equal(
    eventSentence(left),
    'Sail Research (sail-research/fp4) missing at the last check; may come back'
  );

  builder.add(snapshot('2026-11-17T00:36:00Z', {
    'moonshotai/kimi-k3': observed('MoonshotAI: Kimi K3', [
      endpoint('wafer', 'Wafer', 0.192, 16),
      endpoint('relace/fp4', 'Relace', 0.1824, 11)
    ])
  }));

  history = builder.finish();
  left = event(history, 'left', 'moonshotai/kimi-k3',
    item => item.tag === 'sail-research/fp4');
  assert.equal(left.confirmed, true);
  assert.equal(eventSentence(left), 'Sail Research (sail-research/fp4) left');
});

test('records every history window variant', () => {
  const examples = [
    {
      checks: [],
      since: '2026-11-17T10:07:00Z',
      watcherOff: undefined
    },
    {
      checks: [
        { at: '2026-11-17T10:22:00Z', models: 1, errors: [] },
        { at: '2026-11-17T10:37:00Z', models: 1, errors: [] },
        { at: '2026-11-17T10:52:00Z', models: 1, errors: [] }
      ],
      since: '2026-11-17T10:52:00Z',
      watcherOff: undefined
    },
    {
      checks: [
        { at: '2026-11-17T10:22:00Z', models: 1, errors: [] }
      ],
      since: '2026-11-17T10:22:00Z',
      watcherOff: true
    },
    {
      checks: [
        { at: '2026-11-17T10:22:00Z', models: 1, errors: [] },
        { at: '2026-11-17T10:37:00Z', models: 1, errors: [] },
        { at: '2026-11-17T10:52:00Z', models: 1, errors: ['a/b'] }
      ],
      since: '2026-11-17T10:37:00Z',
      watcherOff: undefined
    }
  ];

  for (const example of examples) {
    const builder = new HistoryBuilder({ checks: example.checks });
    builder.add(snapshot('2026-11-17T10:07:00Z', {
      'a/b': observed('A: B', [
        endpoint('x', 'X', 1, 1),
        endpoint('y', 'Y', 2, 2)
      ])
    }));
    builder.add(snapshot('2026-11-17T11:07:00Z', {
      'a/b': observed('A: B', [
        endpoint('x', 'X', 1.5, 1),
        endpoint('y', 'Y', 2, 2)
      ])
    }));

    const changed = event(builder.finish(), 'price-changed', 'a/b',
      item => item.tag === 'x');

    assert.deepEqual(
      {
        since: changed.since,
        sources: changed.sources,
        watcherOff: changed.watcherOff
      },
      {
        since: example.since,
        sources: ['openrouter-api', 'openrouter-api'],
        watcherOff: example.watcherOff
      }
    );
  }
});

test('keeps the departure event at its first missing observation', () => {
  const builder = new HistoryBuilder();

  builder.add(snapshot('2026-11-17T00:03:00Z', {
    'moonshotai/kimi-k3': observed('MoonshotAI: Kimi K3', [
      endpoint('wafer', 'Wafer', 0.192, 16),
      endpoint('relace/fp4', 'Relace', 0.1824, 11),
      endpoint('sail-research/fp4', 'Sail Research', 0.2, 12)
    ])
  }));
  builder.add(snapshot('2026-11-17T00:06:00Z', {
    'moonshotai/kimi-k3': observed('MoonshotAI: Kimi K3', [
      endpoint('wafer', 'Wafer', 0.192, 16),
      endpoint('relace/fp4', 'Relace', 0.1824, 11)
    ])
  }));
  builder.add(snapshot('2026-11-17T00:23:00Z', {
    'moonshotai/kimi-k3': observed('MoonshotAI: Kimi K3', [
      endpoint('wafer', 'Wafer', 0.192, 16),
      endpoint('relace/fp4', 'Relace', 0.1824, 11)
    ])
  }));

  let left = event(builder.finish(), 'left', 'moonshotai/kimi-k3',
    item => item.tag === 'sail-research/fp4');
  assert.deepEqual(
    {
      at: left.at,
      confirmed: left.confirmed,
      returned: left.returned,
      replacedBy: left.replacedBy
    },
    {
      at: '2026-11-17T00:06:00Z',
      confirmed: false,
      returned: undefined,
      replacedBy: undefined
    }
  );
  assert.equal(
    eventSentence(left),
    'Sail Research (sail-research/fp4) missing at the last check; may come back'
  );

  builder.add(snapshot('2026-11-17T00:36:00Z', {
    'moonshotai/kimi-k3': observed('MoonshotAI: Kimi K3', [
      endpoint('wafer', 'Wafer', 0.192, 16),
      endpoint('relace/fp4', 'Relace', 0.1824, 11)
    ])
  }));

  left = event(builder.finish(), 'left', 'moonshotai/kimi-k3',
    item => item.tag === 'sail-research/fp4');
  assert.deepEqual(
    { at: left.at, confirmed: left.confirmed },
    { at: '2026-11-17T00:06:00Z', confirmed: true }
  );
  assert.equal(eventSentence(left), 'Sail Research (sail-research/fp4) left');
});

test('uses the previous observation window when snapshots are days apart', () => {
  const builder = new HistoryBuilder();

  builder.add(snapshot('2026-11-14T10:07:00Z', {
    'a/b': observed('A: B', [endpoint('x', 'X', 1, 1)])
  }));
  builder.add(snapshot('2026-11-17T11:07:00Z', {
    'a/b': observed('A: B', [endpoint('x', 'X', 1.5, 1)])
  }));

  const changed = event(builder.finish(), 'price-changed', 'a/b');

  assert.deepEqual(
    {
      since: changed.since,
      sources: changed.sources,
      watcherOff: changed.watcherOff
    },
    {
      since: '2026-11-14T10:07:00Z',
      sources: ['openrouter-api', 'openrouter-api'],
      watcherOff: undefined
    }
  );
});

// Change windows, verbatim. history.mjs produces each window (since, sources,
// watcherOff); the "when" text is the feed's, built from those times.
const CHANGE_WINDOWS = `-- no check log: since 2026-11-17T10:07:00Z sources ["openrouter-api","openrouter-api"] watcherOff false
   when: Between the snapshots of Nov 17, 10:07 UTC and Nov 17, 11:07 UTC.
-- checks every 15 minutes: since 2026-11-17T10:52:00Z sources ["openrouter-api","openrouter-api"] watcherOff false
   when: Between the snapshots of Nov 17, 10:52 UTC and Nov 17, 11:07 UTC.
-- last check 10:22 then nothing (watcher off): since 2026-11-17T10:22:00Z sources ["openrouter-api","openrouter-api"] watcherOff true
   when: Between the snapshots of Nov 17, 10:22 UTC and Nov 17, 11:07 UTC.
-- 10:52 check failed for a/b: since 2026-11-17T10:37:00Z sources ["openrouter-api","openrouter-api"] watcherOff false
   when: Between the snapshots of Nov 17, 10:37 UTC and Nov 17, 11:07 UTC.
-- two days apart: Between Nov 14 and Nov 17 (no snapshot in between).`.split('\n');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function utcDay(iso) {
  const date = new Date(iso);
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

function utcMinute(iso) {
  return `${utcDay(iso)}, ${iso.slice(11, 16)} UTC`;
}

test('produces the change windows verbatim', () => {
  function changedWith(checks, first = '2026-11-17T10:07:00Z') {
    const builder = new HistoryBuilder({ checks });
    builder.add(snapshot(first, {
      'a/b': observed('A: B', [endpoint('x', 'X', 1, 1)])
    }));
    builder.add(snapshot('2026-11-17T11:07:00Z', {
      'a/b': observed('A: B', [endpoint('x', 'X', 1.5, 1)])
    }));
    return event(builder.finish(), 'price-changed', 'a/b');
  }

  const every15 = [
    { at: '2026-11-17T10:22:00Z', models: 1, errors: [] },
    { at: '2026-11-17T10:37:00Z', models: 1, errors: [] },
    { at: '2026-11-17T10:52:00Z', models: 1, errors: [] }
  ];
  const cases = [
    { label: 'no check log', checks: [] },
    { label: 'checks every 15 minutes', checks: every15 },
    { label: 'last check 10:22 then nothing (watcher off)', checks: every15.slice(0, 1) },
    {
      label: '10:52 check failed for a/b',
      checks: [...every15.slice(0, 2), { ...every15[2], errors: ['a/b'] }]
    }
  ];

  cases.forEach(({ label, checks }, i) => {
    const changed = changedWith(checks);
    assert.equal(
      CHANGE_WINDOWS[i * 2],
      `-- ${label}: since ${changed.since} sources ${JSON.stringify(changed.sources)} watcherOff ${Boolean(changed.watcherOff)}`
    );
    assert.ok(CHANGE_WINDOWS[i * 2 + 1].includes(
      `of ${utcMinute(changed.since)} and ${utcMinute(changed.at)}.`
    ));
  });

  const apart = changedWith([], '2026-11-14T10:07:00Z');
  assert.equal(
    CHANGE_WINDOWS[8],
    `-- two days apart: Between ${utcDay(apart.since)} and ${utcDay(apart.at)} (no snapshot in between).`
  );
});

// Departures, returns and replacements, verbatim. history.mjs produces each event's time, type and
// departure flags; the sentences are events.mjs's, the pills and item titles the feed's.
const DEPARTURES = `-- gone 17 minutes (00:03 -> 00:06, 00:08, 00:23)
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
  item 2026-11-17T00:18:00Z: Endpoint changed: Sail Research (sail-research/fp4/us) on Kimi K3 (moonshotai/kimi-k3) · sail-research/fp4 to sail-research/fp4/us`.split('\n');

test('produces the events and departure flags of departures, returns and replacements verbatim', () => {
  const KIMI = 'moonshotai/kimi-k3';
  const wafer = endpoint('wafer', 'Wafer', 0.192, 16);
  const relace = endpoint('relace/fp4', 'Relace', 0.1824, 11);
  const sail = endpoint('sail-research/fp4', 'Sail Research', 0.2, 12);
  const sailUs = endpoint('sail-research/fp4/us', 'Sail Research', 0.2, 12);

  function build(observations) {
    const builder = new HistoryBuilder();
    for (const [at, endpoints] of observations) {
      builder.add(snapshot(at, { [KIMI]: observed('MoonshotAI: Kimi K3', endpoints) }));
    }
    return builder.finish();
  }

  function line(e) {
    const flags = {};
    for (const key of ['confirmed', 'returned', 'rejoined', 'replacedBy', 'replaces']) {
      if (e[key] !== undefined) flags[key] = e[key];
    }
    return `  ${e.at} ${e.type} ${JSON.stringify(flags)} | ${eventSentence(e)} | `;
  }

  function assertLine(expected, e) {
    assert.ok(expected.startsWith(line(e)), `${line(e)}\nis not the start of\n${expected}`);
  }

  const sailLeft = item => item.tag === 'sail-research/fp4';
  const gone = [
    ['2026-11-17T00:03:00Z', [wafer, relace, sail]],
    ['2026-11-17T00:06:00Z', [wafer, relace]],
    ['2026-11-17T00:08:00Z', [wafer, relace]],
    ['2026-11-17T00:23:00Z', [wafer, relace]]
  ];

  assert.equal(DEPARTURES[0], '-- gone 17 minutes (00:03 -> 00:06, 00:08, 00:23)');
  let left = event(build(gone), 'left', KIMI, sailLeft);
  assertLine(DEPARTURES[1], left);
  assert.ok(DEPARTURES[2].startsWith(`  item ${left.at}: `));

  assert.equal(DEPARTURES[3], '-- gone 30 minutes (plus 00:36)');
  left = event(build([...gone, ['2026-11-17T00:36:00Z', [wafer, relace]]]), 'left', KIMI, sailLeft);
  assertLine(DEPARTURES[4], left);
  assert.ok(DEPARTURES[5].startsWith(`  item ${left.at}: `));

  assert.equal(DEPARTURES[6], '-- back at the next check');
  let history = build([
    ['2026-11-17T00:03:00Z', [wafer, relace, sail]],
    ['2026-11-17T00:06:00Z', [wafer, relace]],
    ['2026-11-17T00:09:00Z', [wafer, relace, sail]]
  ]);
  assertLine(DEPARTURES[7], event(history, 'joined', KIMI, sailLeft));
  left = event(history, 'left', KIMI, sailLeft);
  assertLine(DEPARTURES[8], left);
  assert.ok(DEPARTURES[9].startsWith(`  item ${left.at}: `));

  assert.equal(DEPARTURES[10], '-- back under a new endpoint id');
  history = build([
    ['2026-11-17T00:03:00Z', [wafer, relace, sail]],
    ['2026-11-17T00:18:00Z', [wafer, relace, sailUs]]
  ]);
  assertLine(DEPARTURES[11], event(history, 'left', KIMI, sailLeft));
  const joined = event(history, 'joined', KIMI, item => item.tag === 'sail-research/fp4/us');
  assertLine(DEPARTURES[12], joined);
  // The cheapest-changed event is events.mjs's; with the caption's pools Relace stays
  // cheapest at $11, so history's part here is only the observation time.
  assert.ok(DEPARTURES[13].startsWith(`  ${joined.at} cheapest-changed {} | `));
  assert.ok(DEPARTURES[14].startsWith(`  item ${joined.at}: `));
});
