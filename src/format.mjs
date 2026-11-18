export function perMillion(perToken) {
  const n = Number(perToken);
  if (!Number.isFinite(n)) return NaN;
  return Number((n * 1e6).toPrecision(12));
}

export function fmtUsdPerM(x) {
  if (x === null || !Number.isFinite(Number(x))) return '$?';

  const n = Number(x);
  if (n === 0) return 'free';

  if (n >= 1) return `$${n.toFixed(2)}`;

  let text = Number(n.toPrecision(3)).toString();

  if (Number(text) >= 1) return `$${Number(text).toFixed(2)}`;

  if (text.includes('e')) {
    text = n.toFixed(Math.max(2, 12));
    text = text.replace(/0+$/, '').replace(/\.$/, '');
  }

  const dot = text.indexOf('.');
  const decimals = dot < 0 ? 0 : text.length - dot - 1;
  if (decimals < 2) text += '0'.repeat(2 - decimals);

  return `$${text}`;
}

// A price OpenRouter lists other than per token: { unit, usd }, `unit` a key of PRICE_UNITS and
// `usd` US dollars per that unit (per million tokens for the token units), with `detail` naming
// the listed variant (a resolution, a mode) when there is one. A price key the parsers do not
// know is kept as { unit: null, value } with the number as listed and shown under its own key.
export const PRICE_UNITS = {
  'input-text-tokens': 'per million input text tokens',
  'input-image-tokens': 'per million input image tokens',
  'output-image-tokens': 'per million output image tokens',
  'video-tokens': 'per million video tokens',
  image: 'per image',
  'input-image': 'per input image',
  'reference-image': 'per reference image',
  'output-megapixel': 'per output megapixel',
  'input-megapixel': 'per input megapixel',
  'input-tokens': 'per million input tokens',
  'output-tokens': 'per million output tokens',
  'cached-input-tokens': 'per million cached input tokens',
  'input-audio-tokens': 'per million input audio tokens',
  request: 'per request',
  second: 'per second',
  'second-with-audio': 'per second with audio',
  'second-without-audio': 'per second without audio',
  'video-minimum': 'minimum per video'
};

// A listed price of 0 is a price OpenRouter states, so it reads $0.00, not "free".
export function fmtUsd(x) {
  return Number(x) === 0 ? '$0.00' : fmtUsdPerM(x);
}

function known(price) {
  return Boolean(price) && Object.hasOwn(PRICE_UNITS, price.unit);
}

// A number as listed, in plain decimals: 0.00000062, not 6.2e-7.
export function asListed(value) {
  if (typeof value !== 'number' || !String(value).includes('e')) return value;
  return value.toLocaleString('en-US', { maximumSignificantDigits: 15, useGrouping: false });
}

// `$0.40 per second with audio (4K)`; an unknown key: `reference_images 0.04 (as listed)`.
export function fmtListedPrice(key, price) {
  if (!known(price)) return `${key} ${asListed(price?.value)} (as listed)`;
  const detail = price.detail ? ` (${price.detail})` : '';
  return `${fmtUsd(price.usd)} ${PRICE_UNITS[price.unit]}${detail}`;
}

// A move { key, unit, detail, from, to, change }: `$0.40 to $0.50 per second with audio (4K, +25%)`.
// A null side is a price the list does not give: `$0.08 per million input tokens, now listed`,
// `$0.08 per million input tokens, no longer listed`.
export function fmtPriceMove(move) {
  if (move.from === null || move.to === null) {
    const listed = move.from ?? move.to;
    const price = fmtListedPrice(move.key, { unit: move.unit, detail: move.detail, usd: listed, value: listed });
    return `${price}, ${move.from === null ? 'now listed' : 'no longer listed'}`;
  }
  const pct = Number.isFinite(move.change) ? Math.round(move.change * 100) : null;
  const change = pct === null ? null : `${pct >= 0 ? '+' : ''}${pct}%`;
  if (!known(move)) {
    return `${move.key} ${asListed(move.from)} to ${asListed(move.to)} (${[change, 'as listed'].filter(Boolean).join(', ')})`;
  }
  const notes = [move.detail, change].filter(Boolean).join(', ');
  return `${fmtUsd(move.from)} to ${fmtUsd(move.to)} ${PRICE_UNITS[move.unit]}${notes ? ` (${notes})` : ''}`;
}

function significant(n, digits = 2) {
  if (!Number.isFinite(n)) return null;
  let text = Number(n.toPrecision(digits)).toString();

  if (text.includes('e')) {
    const places = Math.max(0, digits - 1 - Math.floor(Math.log10(Math.abs(n))));
    text = n.toFixed(places);
  }

  return text;
}

export function nearOne(r) {
  return Number.isFinite(r) && Math.abs(r - 1) < 0.05;
}

export function fmtMultiple(r) {
  if (!Number.isFinite(r)) return null;
  if (r === 1) return '1x';
  if (r >= 10) return `${Math.round(r)}x`;
  if (nearOne(r)) {
    return `${r.toFixed(2)}x`;
  }
  return `${significant(r, 2)}x`;
}

export function fmtVsCheapest(r, what = 'the cheapest') {
  if (!Number.isFinite(r)) return null;
  if (r === 1) return `1x ${what}`;

  if (nearOne(r)) {
    const percent = Math.round(Math.abs(r - 1) * 100);
    const amount = percent < 1 ? `less than 1%` : `${percent}%`;
    return r > 1
      ? `${amount} above ${what}`
      : `${amount} below ${what}`;
  }

  return `${fmtMultiple(r)} ${what}`;
}

export function fmtCount(n) {
  if (!Number.isFinite(n)) return '-';

  const abs = Math.abs(n);
  const units = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K']
  ];

  for (const [size, suffix] of units) {
    if (abs >= size) {
      const value = n / size;
      const rounded = suffix === 'T'
        ? value.toFixed(1)
        : value < 10
          ? value.toFixed(1)
          : Math.round(value).toString();
      return `${Number(rounded)}${suffix}`;
    }
  }

  return Math.round(n).toString();
}

export function fmtInt(n) {
  if (n === null || !Number.isFinite(Number(n))) return '-';
  return Math.trunc(Number(n)).toLocaleString('en-US');
}
