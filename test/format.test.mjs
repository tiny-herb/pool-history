import test from 'node:test';
import assert from 'node:assert/strict';

import {
  perMillion,
  fmtUsdPerM,
  fmtMultiple,
  nearOne,
  fmtVsCheapest,
  fmtCount,
  fmtInt
} from '../src/format.mjs';

test('perMillion converts per-token prices to per-million prices', () => {
  assert.equal(perMillion(0), 0);
  assert.equal(perMillion('0'), 0);
  assert.equal(perMillion('0.0000035'), 3.5);
  assert.equal(perMillion('0.00000032625'), 0.32625);
  assert.equal(perMillion(0.0000006525), 0.6525);
});

test('perMillion supplies the per-M prices of the GMICloud endpoint of xiaomi/mimo-v2.6-pro', () => {
  const example = '{"tag":"gmicloud/bf16","provider":"GMICloud","prompt":0.32625,"completion":0.6525,"discount":0.25,"context":1050000,"quantization":"bf16","status":0,"uptime30m":100,"uptime1d":100,"uptimePage":null,"latency30m":null,"throughput30m":null}';
  const record = JSON.parse(example);

  assert.equal(perMillion('0.00000032625'), record.prompt);
  assert.equal(perMillion('0.0000006525'), record.completion);
});

test('fmtUsdPerM matches the expected price formats', () => {
  const cases = [
    [0, 'free'],
    [0.0000035, '$0.0000035'],
    [0.0507, '$0.0507'],
    [0.051, '$0.051'],
    [0.0699, '$0.0699'],
    [0.1, '$0.10'],
    [0.326, '$0.326'],
    [0.3698, '$0.37'],
    [0.91, '$0.91'],
    [1, '$1.00'],
    [1.22, '$1.22'],
    [4, '$4.00'],
    [12.5, '$12.50'],
    [13.65, '$13.65'],
    [120, '$120.00'],
    [0.0154, '$0.0154'],
    [0.035, '$0.035'],
    [0.07, '$0.07'],
    [0.155, '$0.155'],
    [0.9995, '$1.00'],
    [123.456, '$123.46'],
    [null, '$?']
  ];

  for (const [input, expected] of cases) {
    assert.equal(fmtUsdPerM(input), expected, `fmtUsdPerM(${input})`);
  }
});

test('fmtMultiple matches the expected multiple formats', () => {
  const cases = [
    [1, '1x'],
    [1.02, '1.02x'],
    [0.97, '0.97x'],
    [1.4, '1.4x'],
    [3.79, '3.8x'],
    [0.78, '0.78x'],
    [9.96, '10x'],
    [10, '10x'],
    [12.3, '12x'],
    [129.4, '129x'],
    [0.78, '0.78x'],
    [1.004, '1.00x'],
    [1.05, '1.1x'],
    [3.75, '3.8x'],
    [12.26, '12x'],
    [20.4, '20x'],
    [null, null]
  ];

  for (const [input, expected] of cases) {
    assert.equal(
      fmtMultiple(input),
      expected,
      `fmtMultiple(${String(input)})`
    );
  }

  assert.equal(fmtMultiple(Number.NaN), null);
  assert.equal(fmtMultiple(Infinity), null);
});

test('nearOne identifies ratios within five percent of one', () => {
  assert.equal(nearOne(1), true);
  assert.equal(nearOne(1.004), true);
  assert.equal(nearOne(1.02), true);
  assert.equal(nearOne(0.97), true);
  assert.equal(nearOne(1.05), false);
  assert.equal(nearOne(0.94), false);
});

test('fmtVsCheapest matches the expected comparison formats', () => {
  const cases = [
    [1, '1x the cheapest'],
    [1.004, 'less than 1% above the cheapest'],
    [1.02, '2% above the cheapest'],
    [0.97, '3% below the cheapest'],
    [1.4, '1.4x the cheapest'],
    [3.8, '3.8x the cheapest'],
    [13, '13x the cheapest'],
    [0.78, '0.78x the cheapest']
  ];

  for (const [input, expected] of cases) {
    assert.equal(fmtVsCheapest(input), expected);
  }

  assert.equal(
    fmtVsCheapest(1.02, 'the lowest-priced endpoint'),
    '2% above the lowest-priced endpoint'
  );
});

test('fmtCount matches OpenRouter request and token abbreviations', () => {
  const cases = [
    [999, '999'],
    [6430, '6.4K'],
    [13000, '13K'],
    [114026, '114K'],
    [115026, '115K'],
    [1250000, '1.3M'],
    [3200000000, '3.2B'],
    [512000000, '512M'],
    [834000000000, '834B'],
    [3200000000000, '3.2T'],
    [61200000000000, '61.2T']
  ];

  for (const [input, expected] of cases) {
    assert.equal(fmtCount(input), expected, `fmtCount(${input})`);
  }
});

test('fmtInt formats integers and represents unknown values with a dash', () => {
  assert.equal(fmtInt(null), '-');
  assert.equal(fmtInt(0), '0');
  assert.equal(fmtInt(1), '1');
  assert.equal(fmtInt(999), '999');
  assert.equal(fmtInt(1000), '1,000');
  assert.equal(fmtInt(1234567), '1,234,567');
});
