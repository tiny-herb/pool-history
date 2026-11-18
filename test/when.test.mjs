import test from 'node:test';
import assert from 'node:assert/strict';

import { fmtWhen, whenHtml } from '../src/when.mjs';

test('fmtWhen formats UTC text without the year', () => {
  assert.equal(fmtWhen('2026-11-16T19:06:00Z'), 'Nov 16, 19:06 UTC');
  assert.equal(fmtWhen('2026-11-17T06:07:00Z'), 'Nov 17, 06:07 UTC');
});

test('whenHtml uses the datetime style by default', () => {
  assert.equal(
    whenHtml('2026-11-17T06:07:00Z'),
    '<time datetime="2026-11-17T06:07:00Z" data-local="datetime" title="Nov 17, 06:07 UTC">Nov 17, 06:07 UTC</time>',
  );
});

// The UTC text stays in `title` for every style; only the shown text changes.
test('whenHtml formats the date style and keeps the full UTC text in title', () => {
  assert.equal(
    whenHtml('2026-11-17T06:07:00Z', 'date'),
    '<time datetime="2026-11-17T06:07:00Z" data-local="date" title="Nov 17, 06:07 UTC">Nov 17</time>',
  );
});

test('whenHtml formats the time style and keeps the full UTC text in title', () => {
  assert.equal(
    whenHtml('2026-11-17T06:07:00Z', 'time'),
    '<time datetime="2026-11-17T06:07:00Z" data-local="time" title="Nov 17, 06:07 UTC">06:07 UTC</time>',
  );
});

test('whenHtml formats the day style and keeps the full UTC text in title', () => {
  assert.equal(
    whenHtml('2026-11-17T06:07:00Z', 'day'),
    '<time datetime="2026-11-17T06:07:00Z" data-local="day" title="Nov 17, 06:07 UTC">Tue, Nov 17</time>',
  );
});

test('whenHtml holds the two times of a two-day window verbatim', () => {
  const window ='<p class="feed-when">Between <time datetime="2026-11-14T10:07:00Z" data-local="date" title="Nov 14, 10:07 UTC">Nov 14</time> and <time datetime="2026-11-17T11:07:00Z" data-local="date" title="Nov 17, 11:07 UTC">Nov 17</time> (no snapshot in between).</p>';

  assert.ok(window.includes(whenHtml('2026-11-14T10:07:00Z', 'date')));
  assert.ok(window.includes(whenHtml('2026-11-17T11:07:00Z', 'date')));
});

test('whenHtml preserves the supplied ISO string in datetime', () => {
  const iso = '2026-11-16T19:06:00Z';

  assert.equal(
    whenHtml(iso, 'datetime'),
    '<time datetime="2026-11-16T19:06:00Z" data-local="datetime" title="Nov 16, 19:06 UTC">Nov 16, 19:06 UTC</time>',
  );
});
