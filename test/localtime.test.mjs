import test from 'node:test';
import assert from 'node:assert/strict';

import { localText, localizeTimes } from '../src/assets/localtime.js';

const iso = '2026-11-17T16:37:00Z';

test('localText formats every sample locale and time zone', () => {
  const examples = [
    ['datetime', 'en-US', 'America/Chicago', 'Nov 17, 10:37 AM CST'],
    ['date', 'en-US', 'America/Chicago', 'Nov 17'],
    ['time', 'en-US', 'America/Chicago', '10:37 AM'],
    ['day', 'en-US', 'America/Chicago', 'Tue, Nov 17'],

    ['datetime', 'en-GB', 'Europe/London', '17 Nov, 16:37 GMT'],
    ['date', 'en-GB', 'Europe/London', '17 Nov'],
    ['time', 'en-GB', 'Europe/London', '16:37'],
    ['day', 'en-GB', 'Europe/London', 'Tue 17 Nov'],

    ['datetime', 'de-DE', 'Europe/Berlin', '17. Nov., 17:37 MEZ'],
    ['date', 'de-DE', 'Europe/Berlin', '17. Nov.'],
    ['time', 'de-DE', 'Europe/Berlin', '17:37'],
    ['day', 'de-DE', 'Europe/Berlin', 'Di., 17. Nov.'],

    ['datetime', 'en-US', 'Asia/Tokyo', 'Nov 18, 1:37 AM GMT+9'],
    ['date', 'en-US', 'Asia/Tokyo', 'Nov 18'],
    ['time', 'en-US', 'Asia/Tokyo', '1:37 AM'],
    ['day', 'en-US', 'Asia/Tokyo', 'Wed, Nov 18'],
  ];

  for (const [style, locale, timeZone, expected] of examples) {
    assert.equal(localText(iso, style, locale, timeZone), expected);
  }
});

test('localText uses datetime as the default style', () => {
  assert.equal(
    localText(iso, undefined, 'en-US', 'America/Chicago'),
    'Nov 17, 10:37 AM CST',
  );
});

test('localText returns null for an invalid date', () => {
  assert.equal(localText('not a date', 'datetime', 'en-US', 'UTC'), null);
  assert.equal(localText('2026-02-30T16:37:00Z', 'date', 'en-US', 'UTC'), null);
});

test('localizeTimes rewrites every matching time and leaves invalid times alone', () => {
  const nodes = [
    {
      datetime: iso,
      style: 'datetime',
      textContent: 'Nov 17, 16:37 UTC',
      getAttribute(name) {
        return name === 'datetime'
          ? this.datetime
          : name === 'data-local'
            ? this.style
            : null;
      },
    },
    {
      datetime: iso,
      style: 'date',
      textContent: 'Nov 17 UTC',
      getAttribute(name) {
        return name === 'datetime'
          ? this.datetime
          : name === 'data-local'
            ? this.style
            : null;
      },
    },
    {
      datetime: iso,
      style: 'time',
      textContent: '16:37 UTC',
      getAttribute(name) {
        return name === 'datetime'
          ? this.datetime
          : name === 'data-local'
            ? this.style
            : null;
      },
    },
    {
      datetime: iso,
      style: 'day',
      textContent: 'Tue, Nov 17',
      getAttribute(name) {
        return name === 'datetime'
          ? this.datetime
          : name === 'data-local'
            ? this.style
            : null;
      },
    },
    {
      datetime: 'not a date',
      style: 'datetime',
      textContent: 'not a date',
      getAttribute(name) {
        return name === 'datetime'
          ? this.datetime
          : name === 'data-local'
            ? this.style
            : null;
      },
    },
  ];

  const root = {
    querySelectorAll(selector) {
      assert.equal(selector, 'time[datetime][data-local]');
      return nodes;
    },
  };

  localizeTimes(root);

  assert.deepEqual(
    nodes.map((node) => node.textContent),
    [
      'Nov 17, 16:37 UTC',
      'Nov 17',
      '16:37',
      'Tue, Nov 17',
      'not a date',
    ],
  );
});
