import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const cssPath = fileURLToPath(new URL('../src/assets/style.css', import.meta.url));
const css = await readFile(cssPath, 'utf8');

function ruleFor(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[}\\s,])${escaped}(?:[\\s.#:[>,]|$)`);
}

function hasClass(name) {
  return ruleFor(`.${name}`).test(css);
}

function token(name) {
  return css.match(new RegExp(`--${name}\\s*:\\s*([^;]+);`))?.[1].trim();
}

// The value a top-level rule gives a property, with var(--token) resolved
// against the token's declaration, so a rule may use the token or the literal.
function declared(selector, property) {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [, selectors, body] of bare.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (!selectors.split(',').map(s => s.trim()).includes(selector)) continue;
    const value = body.match(new RegExp(`(?:^|[;\\s])${property}\\s*:\\s*([^;]+)`))?.[1].trim();
    if (value) return value.replace(/var\(--([\w-]+)\)/g, (whole, name) => token(name) ?? whole);
  }
  return undefined;
}

test('style.css is non-empty and contains no imports', () => {
  assert.ok(css.trim().length > 0);
  assert.doesNotMatch(css, /@import\b/i);
});

test('the stylesheet defines the required design tokens', () => {
  for (const colour of [
    '#03080a',
    '#fcfcfe',
    '#7624f4',
    '#c8ff00',
    '#035ade',
    '#00bf6f',
    '#ff2d55',
    '#e5a000',
  ]) {
    assert.match(css, new RegExp(colour.replace('#', '\\#'), 'i'));
  }

  assert.match(css, /light-dark\s*\(/);
  assert.match(css, /color-scheme\s*:\s*dark\s+light/);
  assert.match(declared('body', 'font-family') ?? '', /Plus Jakarta Sans/i);
  assert.match(declared('code', 'font-family') ?? '', /Geist Mono/i);
});

test('light and dark theme overrides are defined', () => {
  assert.match(css, /:root\s*\{/);
  assert.match(css, /:root\s*\[\s*data-theme\s*=\s*["']light["']\s*\]/);
  assert.match(css, /:root\s*\[\s*data-theme\s*=\s*["']dark["']\s*\]/);
});

test('the site shell and navigation classes are styled', () => {
  for (const name of [
    'skip',
    'topnav',
    'topnav-inner',
    'brand',
    'brand-mark',
    'brand-or',
    'topnav-links',
    'theme-switch',
    'theme-nav',
    'theme-footer',
    'btn',
    'btn-ghost',
    'btn-outline',
    'active',
    'site-footer',
    'footer-inner',
  ]) {
    assert.equal(hasClass(name), true, `missing rule for .${name}`);
  }

  assert.match(css, /\.topnav\b[^{}]*\{[^}]*position\s*:\s*sticky/i);
});

test('page layout and header classes are styled', () => {
  for (const name of [
    'page-header',
    'page-title',
    'subtitle',
    'meta',
    'section-head',
    'section-title',
    'section-intro',
    'key',
    'hero-actions',
    'arrow-link',
    'card',
    'empty',
    'fixes',
    'fixes-title',
    'faint',
    'more',
  ]) {
    assert.equal(hasClass(name), true, `missing rule for .${name}`);
  }

  assert.match(css, /\.card\b[^{}]*\{[^}]*border/i);
  assert.equal(declared('.card', 'border-radius'), '8px');
});

test('no stat strip rules remain', () => {
  // The front page has no strip of stat cards, so the stylesheet has no rules for one.
  assert.doesNotMatch(css, /\.stat-/);
  assert.equal(token('text-display'), undefined);
});

test('event and feed layouts are styled', () => {
  for (const name of [
    'event-card',
    'day',
    'events',
    'event',
    'event-body',
    'what',
    'window',
    'feed-item',
    'feed-head',
    'feed-title',
    'feed-events',
    'feed-when',
    'feed-links',
    'feed-fields',
  ]) {
    assert.equal(hasClass(name), true, `missing rule for .${name}`);
  }

  assert.match(css, /\.pill\b[^{}]*\{[^}]*height\s*:\s*22px/i);
  assert.match(css, /\.pill\b[^{}]*\{[^}]*border/i);
});

test('all required pill tones and event modifiers are styled', () => {
  for (const name of [
    'pill-neutral',
    'pill-warning',
    'pill-negative',
    'pill-positive',
    'pill-info',
    'joined',
    'left',
    'price-changed',
    'quantization-changed',
    'cheapest-changed',
    'spread-crossed',
    'model-listed',
    'model-delisted',
    'pool-empty',
    'major',
    'expensive',
  ]) {
    assert.equal(hasClass(name), true, `missing rule for .${name}`);
  }
});

test('links, code, accessibility helpers, and tables are styled', () => {
  for (const name of [
    'ext',
    'model',
    'sr-only',
    'table-wrap',
    'data-table',
    'mono',
  ]) {
    assert.equal(hasClass(name), true, `missing rule for .${name}`);
  }

  assert.match(css, /\.sr-only\b[^{}]*\{[^}]*clip/i);
  assert.match(css, /\.data-table\b/i);
});

// The longest pill label render.mjs can make; the pill column must hold it.
const LONGEST_PILL = 'not listed · unconfirmed';

function px(length) {
  const m = /^([\d.]+)(rem|px)$/.exec(length);
  assert.ok(m, `${length} is a fixed length`);
  return Number(m[1]) * (m[2] === 'rem' ? 16 : 1);
}

function mediaBlock(query) {
  const start = css.indexOf(`@media (${query}) {`);
  assert.notEqual(start, -1, `missing @media (${query})`);
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    if (css[i] === '}' && (depth -= 1) === 0) return css.slice(start, i + 1);
  }
  return '';
}

test('event rows are a three-column grid with a fixed pill column, so text starts at one x', () => {
  assert.equal(declared('.event', 'display'), 'grid');
  assert.equal(declared('.event', 'align-items'), 'baseline');
  const tracks = declared('.event', 'grid-template-columns')
    .match(/minmax\([^)]*\)|[^\s]+/g);
  assert.equal(tracks.length, 3, `three tracks, got ${tracks.join(' | ')}`);
  // Time and pill tracks are fixed lengths; the pill track holds the longest
  // label (12px/600 measured 5.7px a character in Plus Jakarta Sans and Arial,
  // plus 20px padding and a 1px border each side).
  px(tracks[0]);
  assert.ok(px(tracks[1]) >= LONGEST_PILL.length * 6 + 22, `pill track ${tracks[1]} too narrow`);
  assert.equal(tracks[2], 'minmax(0, 1fr)');
  // The pill keeps its natural width at the start of its column and never wraps.
  assert.equal(declared('.event > .pill', 'justify-self'), 'start');
  assert.match(css, /\.pill\s*\{[^}]*white-space\s*:\s*nowrap/);
  // The model id is the row's subject, on its own line above the sentence.
  assert.equal(declared('.event-body > .model', 'display'), 'block');
  assert.equal(declared('.event-body', 'min-width'), '0');
});

test('a fold\'s summary is a plain event row that opens in place, with a marker that turns when open', () => {
  assert.equal(declared('.fold > details > summary', 'list-style'), 'none');
  assert.equal(declared('.fold > details > summary', 'cursor'), 'pointer');
  assert.equal(declared('.fold > details > summary::-webkit-details-marker', 'display'), 'none');
  assert.equal(declared('.fold > details > summary:focus-visible', 'outline-offset'), '-2px');
  assert.match(declared('.fold > details > summary .what::after', 'transform'), /rotate\(-45deg\)/);
  assert.match(declared('.fold > details[open] > summary .what::after', 'transform'), /rotate\(45deg\)/);
  assert.equal(declared('.fold > details > .events', 'background'), token('muted'));
  // No rule pads or indents the fold, so its rows keep the event rows' left edges.
  for (const selector of ['.fold', '.fold > details', '.fold > details > summary', '.fold > details > .events']) {
    for (const property of ['padding', 'padding-left', 'margin', 'margin-left']) {
      assert.equal(declared(selector, property), undefined, `${selector} ${property}`);
    }
  }
});

test('feed rows hang the pill in the same fixed column as the event rows', () => {
  assert.match(css, /\.feed-events li\s*\{[^}]*padding\s*:[^;]*var\(--event-pill-col\)/);
  assert.match(css, /\.feed-events \.pill\s*\{[^}]*float\s*:\s*left[^}]*margin-left\s*:[^;]*var\(--event-pill-col\)/);
});

test('under 640px the time and pill share a line above full-width text', () => {
  const narrow = mediaBlock('max-width: 640px');
  assert.match(narrow, /\.event\s*\{[^}]*grid-template-columns\s*:\s*var\(--event-time-col\)\s+minmax\(0,\s*1fr\)/);
  assert.match(narrow, /\.event-body\s*\{[^}]*grid-column\s*:\s*1\s*\/\s*-1/);
  assert.match(narrow, /\.feed-events li\s*\{[^}]*padding-left\s*:\s*0/);
  assert.match(narrow, /\.feed-events \.pill\s*\{[^}]*float\s*:\s*none/);
  // No other breakpoint turns the rows back into flex rows.
  assert.doesNotMatch(css, /\.event\s*\{[^}]*flex-wrap/);
});

test('responsive navigation and content rules are present', () => {
  assert.match(css, /@media\s*\([^)]*(?:max-width|min-width)[^)]*\)/i);
  assert.match(css, /768px/);
  assert.equal(declared('.topnav', 'height'), '56px');
});
