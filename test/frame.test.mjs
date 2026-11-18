import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CARD_COLOR,
  SPACER,
  modelFooter,
  col,
  rows,
  frame,
} from '../src/frame.mjs';

test('CARD_COLOR is the Volt colour', () => {
  assert.equal(CARD_COLOR, 0xC8FF00);
});

test('SPACER is an inline zero-width-space field', () => {
  assert.deepEqual(SPACER, {
    name: '\u200B',
    value: '\u200B',
    inline: true,
  });
});

test('modelFooter includes the prices note by default', () => {
  assert.equal(
    modelFooter('x/m'),
    'Model id: x/m · Prices in USD per million tokens (/M)',
  );
});

test('modelFooter can omit the prices note', () => {
  assert.equal(modelFooter('x/m', { prices: false }), 'Model id: x/m');
});

test('col joins non-empty lines and is inline', () => {
  assert.deepEqual(col('Name', ['one', null, '', 'two']), {
    name: 'Name',
    value: 'one\ntwo',
    inline: true,
  });
});

test('col accepts a single string', () => {
  assert.deepEqual(col('Name', 'one'), {
    name: 'Name',
    value: 'one',
    inline: true,
  });
});

test('col uses an en dash when all lines are empty', () => {
  assert.deepEqual(col('Name', [null, '', null]), {
    name: 'Name',
    value: '–',
    inline: true,
  });
});

test('col uses an en dash for an empty string', () => {
  assert.deepEqual(col('Name', ''), {
    name: 'Name',
    value: '–',
    inline: true,
  });
});

test('rows removes false and null fields', () => {
  const a = { name: 'A', value: '1', inline: true };
  const b = { name: 'B', value: '2', inline: true };

  assert.deepEqual(rows([a, false, null, b]), [a, b]);
});

test('rows pads every non-final row to three inline fields', () => {
  const a = { name: 'A', value: '1', inline: true };
  const b = { name: 'B', value: '2', inline: true };
  const c = { name: 'C', value: '3', inline: true };

  assert.deepEqual(rows([a, b], [c]), [
    a,
    b,
    SPACER,
    c,
  ]);
});

test('rows pads a short first row with spacers', () => {
  const a = { name: 'A', value: '1', inline: true };
  const b = { name: 'B', value: '2', inline: true };
  const c = { name: 'C', value: '3', inline: true };
  const d = { name: 'D', value: '4', inline: true };

  assert.deepEqual(rows([a], [b, c, d]), [
    a,
    SPACER,
    SPACER,
    b,
    c,
    d,
  ]);
});

test('rows does not pad the final row', () => {
  const a = { name: 'A', value: '1', inline: true };
  const b = { name: 'B', value: '2', inline: true };

  assert.deepEqual(rows([a, b]), [a, b]);
});

test('rows supports a complete first row without padding', () => {
  const fields = [
    { name: 'A', value: '1', inline: true },
    { name: 'B', value: '2', inline: true },
    { name: 'C', value: '3', inline: true },
  ];

  assert.deepEqual(rows(fields), fields);
});

test('frame builds the minimal embed and leaves description absent', () => {
  assert.deepEqual(frame({}), {
    color: 13172480,
    fields: [],
  });
});

test('frame wraps author and footer and preserves embed field order', () => {
  assert.deepEqual(frame({
    author: '📝 Text model · Price increase',
    title: 'Model name',
    url: 'https://openrouter.ai/x%2Fy',
    description: 'One summary sentence',
    fields: [
      { name: 'Prices', value: '$1.00 / $2.00 per M' },
    ],
    footer: 'Model id: x/y',
    timestamp: '2026-11-17T16:37:00Z',
  }), {
    color: 13172480,
    author: { name: '📝 Text model · Price increase' },
    title: 'Model name',
    url: 'https://openrouter.ai/x%2Fy',
    description: 'One summary sentence',
    fields: [
      { name: 'Prices', value: '$1.00 / $2.00 per M' },
    ],
    footer: { text: 'Model id: x/y' },
    timestamp: '2026-11-17T16:37:00Z',
  });
});

test('frame omits undefined optional parts', () => {
  assert.deepEqual(frame({
    author: undefined,
    title: undefined,
    url: undefined,
    description: undefined,
    footer: undefined,
    timestamp: undefined,
    fields: [],
  }), {
    color: 13172480,
    fields: [],
  });
});

test('frame retains an explicitly supplied empty fields array', () => {
  assert.deepEqual(frame({ fields: [] }), {
    color: 13172480,
    fields: [],
  });
});

test('frame cuts a title longer than 256 characters to 255 plus an ellipsis', () => {
  const title = 'a'.repeat(300);

  const result = frame({ title });

  assert.equal(result.title.length, 256);
  assert.equal(result.title, `${'a'.repeat(255)}…`);
});

test('frame does not cut a title of exactly 256 characters', () => {
  const title = 'a'.repeat(256);

  assert.equal(frame({ title }).title, title);
});

test('frame cuts an author, description and footer past Discord limits', () => {
  assert.equal(frame({ author: 'a'.repeat(300) }).author.name, `${'a'.repeat(255)}…`);
  assert.equal(frame({ description: 'd'.repeat(5000) }).description, `${'d'.repeat(4095)}…`);
  assert.equal(frame({ footer: 'f'.repeat(3000) }).footer.text, `${'f'.repeat(2047)}…`);
});

test('frame cuts a field name past 256 characters and leaves the value to the caller', () => {
  const [field] = frame({ fields: [{ name: 'n'.repeat(300), value: 'v'.repeat(2000), inline: true }] }).fields;

  assert.deepEqual(field, { name: `${'n'.repeat(255)}…`, value: 'v'.repeat(2000), inline: true });
});

test('frame keeps at most 25 fields', () => {
  const fields = Array.from({ length: 30 }, (_, i) => ({ name: `F${i}`, value: 'x' }));

  assert.deepEqual(frame({ fields }).fields, fields.slice(0, 25));
});

test('frame shortens the description when the rest alone passes 6,000 characters', () => {
  const result = frame({ author: 'a'.repeat(256), title: 't'.repeat(256), description: 'd'.repeat(4096), footer: 'f'.repeat(2048) });
  const total = result.author.name.length + result.title.length + result.description.length + result.footer.text.length;

  assert.equal(total, 6000);
  assert.ok(result.description.endsWith('…'));
});

test('frame accepts all supported optional values together', () => {
  const fields = [
    { name: 'A', value: '1', inline: true },
    { name: 'Details', value: ' explanation' },
  ];

  assert.deepEqual(frame({
    author: 'Catch-up · not posted at the time',
    title: '5 changes on 2 models',
    url: 'https://example.test/events',
    description: 'At <t:1763397420:f>',
    fields,
    footer: 'Model id: x/m · Prices in USD per million tokens (/M)',
    timestamp: '2026-11-17T16:37:00Z',
  }), {
    color: 13172480,
    author: { name: 'Catch-up · not posted at the time' },
    title: '5 changes on 2 models',
    url: 'https://example.test/events',
    description: 'At <t:1763397420:f>',
    fields,
    footer: {
      text: 'Model id: x/m · Prices in USD per million tokens (/M)',
    },
    timestamp: '2026-11-17T16:37:00Z',
  });
});
