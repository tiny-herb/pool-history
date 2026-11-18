import {
  blended,
  cheapest,
  priciest,
  spreadOf,
  priceRanges
} from './rules.mjs';
import { observed } from './snapshot.mjs';
import {
  diffModel,
  priceMoves,
  priceDirection,
  movesMajor,
  listedPrices
} from './events.mjs';
import { perTokenPriced, listedPriceKind } from './model-types.mjs';

export const CHECK_GAP_MINUTES = 20;
export const LEFT_CONFIRM_MINUTES = 30;

const CHECK_GAP_MS = CHECK_GAP_MINUTES * 60 * 1000;
const LEFT_CONFIRM_MS = LEFT_CONFIRM_MINUTES * 60 * 1000;

const numeric = value => typeof value === 'number' && Number.isFinite(value);

export function uptimeOf(record) {
  if (numeric(record?.uptime1d)) return record.uptime1d;
  if (numeric(record?.uptimePage)) return record.uptimePage;
  return null;
}

function timeOf(value) {
  return new Date(value).getTime();
}

function cloneEndpoint(endpoint, erasePrices) {
  const copy = { ...endpoint };
  if (erasePrices) {
    copy.prompt = null;
    copy.completion = null;
  }
  return copy;
}

function normalizedEndpoints(entry, outputModalities) {
  const outputs = Array.isArray(entry.outputModalities)
    ? entry.outputModalities
    : outputModalities;

  const erasePrices = Array.isArray(outputs) && !perTokenPriced(outputs);
  return {
    endpoints: (entry.endpoints || []).map(endpoint =>
      cloneEndpoint(endpoint, erasePrices)
    ),
    priceNotPerToken: erasePrices
  };
}

// A price a snapshot did not record (one taken before prices other than per token were kept, or
// one whose price call failed) is unknown, not removed: the endpoint keeps the prices last seen
// on the same endpoint id, so no change is read into the gap.
function carryPrices(endpoints, previous) {
  const before = new Map((previous || []).map(endpoint => [endpoint.tag, endpoint]));
  return endpoints.map(endpoint => {
    const last = before.get(endpoint.tag)?.prices;
    return endpoint.prices || !last ? endpoint : { ...endpoint, prices: last };
  });
}

function hasPrices(prices) {
  return Boolean(prices) && Object.keys(prices).length > 0;
}

// A join on a model priced other than per token names the endpoint's own listed prices, or
// else the model's; an empty list says OpenRouter lists none.
function priceJoins(events, endpoints, modelPrices) {
  for (const event of events) {
    if (event.type !== 'joined') continue;
    const own = endpoints.find(endpoint => endpoint.tag === event.tag)?.prices;
    if (hasPrices(own)) {
      event.prices = listedPrices(own);
      event.pricesFrom = 'endpoint';
    } else if (hasPrices(modelPrices)) {
      event.prices = listedPrices(modelPrices);
      event.pricesFrom = 'model';
    } else {
      event.prices = [];
    }
  }
}

function modelPriceEvents(before, after) {
  const moves = priceMoves(before, after);
  if (moves.length === 0) return [];
  const direction = priceDirection({ moves });
  return [{
    type: 'price-changed',
    moves,
    change: null,
    direction,
    up: direction === 'up',
    major: movesMajor(moves)
  }];
}

function seriesPoint(takenAt, source, endpoints, modelPrices) {
  const priced = cheapest(endpoints);
  const cheapestEndpoint = priced[0] || null;
  const priciestEndpoint = priciest(endpoints);
  const uptimes = {};
  let minUptime = null;

  for (const endpoint of endpoints) {
    const uptime = uptimeOf(endpoint);
    uptimes[endpoint.tag] = uptime;
    if (uptime !== null && (minUptime === null || uptime < minUptime)) {
      minUptime = uptime;
    }
  }

  const prices = {};
  for (const endpoint of endpoints) {
    prices[endpoint.tag] = {
      provider: endpoint.provider,
      prompt: numeric(endpoint.prompt) ? endpoint.prompt : null,
      completion: numeric(endpoint.completion) ? endpoint.completion : null,
      discount: numeric(endpoint.discount) ? endpoint.discount : null,
      quantization: endpoint.quantization ?? null,
      ...(endpoint.prices ? { listed: endpoint.prices } : {})
    };
  }

  const spread = spreadOf(endpoints);

  return {
    takenAt,
    source,
    endpoints: endpoints.length,
    providers: new Set(endpoints.map(endpoint => endpoint.provider)).size,
    cheapest: cheapestEndpoint ? blended(cheapestEndpoint) : null,
    cheapestPrompt: cheapestEndpoint && numeric(cheapestEndpoint.prompt)
      ? cheapestEndpoint.prompt
      : null,
    cheapestCompletion: cheapestEndpoint && numeric(cheapestEndpoint.completion)
      ? cheapestEndpoint.completion
      : null,
    cheapestTags: priced.map(endpoint => endpoint.tag),
    priciestTag: priciestEndpoint ? priciestEndpoint.tag : null,
    spread: spread.spread,
    mixedFree: spread.mixedFree,
    ranges: priceRanges(endpoints),
    minUptime,
    uptime: uptimes,
    prices,
    tags: endpoints.map(endpoint => endpoint.tag),
    ...(modelPrices ? { modelPrices } : {})
  };
}

function latestOf(snapshot, entry, endpoints, modelPrices) {
  return {
    takenAt: snapshot.takenAt,
    source: snapshot.source,
    listed: entry.listed ?? null,
    endpoints,
    ...(modelPrices ? { modelPrices } : {})
  };
}

function newModel(id, entry, snapshot, endpoints, modelPrices) {
  const name = String(entry.name || '').trim() || id;
  return {
    slug: id,
    name,
    series: [],
    events: [],
    latest: latestOf(snapshot, entry, endpoints, modelPrices),
    everMulti: false,
    firstSeen: {
      takenAt: snapshot.takenAt,
      source: snapshot.source
    },
    lastChange: null,
    outputModalities: Array.isArray(entry.outputModalities)
      ? [...entry.outputModalities]
      : null,
    inputModalities: Array.isArray(entry.inputModalities)
      ? [...entry.inputModalities]
      : null
  };
}

export class HistoryBuilder {
  constructor({ checks = [] } = {}) {
    this.models = {};
    this.snapshots = [];
    this.checks = [...checks].sort((a, b) =>
      String(a.at).localeCompare(String(b.at))
    );

    this._lastTakenAt = null;
    this._catalogue = null;
    this._catalogueHead = null;
    this._latestFull = null;
    this._latestFullObserved = new Set();
    this._pending = new Map();
  }

  pendingModels() {
    return [...this._pending.entries()]
      .filter(([, pending]) => pending.length > 0)
      .map(([id]) => id)
      .sort();
  }

  knownCatalogue() {
    return this._catalogue ? new Set(this._catalogue) : null;
  }

  _window(model, previous, at, source) {
    let selected = null;
    let lastBefore = null;

    for (const check of this.checks) {
      if (String(check.at) >= String(at)) break;
      lastBefore = check;

      if (
        String(check.at) >= String(previous.takenAt) &&
        (!Array.isArray(check.errors) || !check.errors.includes(model))
      ) {
        selected = check;
      }
    }

    const result = selected
      ? {
          since: selected.at,
          sources: ['openrouter-api', source]
        }
      : {
          since: previous.takenAt,
          sources: [previous.source, source]
        };

    if (
      selected &&
      lastBefore === selected &&
      timeOf(at) - timeOf(selected.at) > CHECK_GAP_MS
    ) {
      result.watcherOff = true;
    }

    return result;
  }

  _stamp(events, model, previous, snapshot, priceNotPerToken) {
    const window = this._window(
      model,
      previous,
      snapshot.takenAt,
      snapshot.source
    );

    for (const event of events) {
      event.model = model;
      event.at = snapshot.takenAt;
      event.since = window.since;
      event.sources = window.sources;
      if (window.watcherOff) event.watcherOff = true;
      if (priceNotPerToken) event.priceNotPerToken = true;
    }
  }

  _reconcilePending(modelId, endpoints, at) {
    const pending = this._pending.get(modelId) || [];
    if (pending.length === 0) return { pending: [], returned: new Set() };

    const present = new Set(endpoints.map(endpoint => endpoint.tag));
    const stillOpen = [];
    const returned = new Set();

    for (const item of pending) {
      if (present.has(item.tag)) {
        item.event.returned = true;
        returned.add(item.tag);
      } else if (timeOf(at) - timeOf(item.event.at) >= LEFT_CONFIRM_MS) {
        item.event.confirmed = true;
      } else {
        stillOpen.push(item);
      }
    }

    if (stillOpen.length > 0) this._pending.set(modelId, stillOpen);
    else this._pending.delete(modelId);

    return { pending: stillOpen, returned };
  }

  _pairDepartures(modelId, events, openPending, returned) {
    const joins = events.filter(event => event.type === 'joined');
    const departures = events.filter(event => event.type === 'left');
    const newPending = [];

    for (const departure of departures) {
      departure.confirmed = false;
    }

    for (const join of joins) {
      if (returned.has(join.tag)) {
        join.rejoined = true;
        continue;
      }

      let matched = openPending.find(item =>
        item.provider === join.provider && item.tag !== join.tag
      );

      if (matched) {
        const index = openPending.indexOf(matched);
        openPending.splice(index, 1);
      } else {
        const departure = departures.find(event =>
          !event.replacedBy &&
          event.provider === join.provider &&
          event.tag !== join.tag
        );
        if (departure) matched = { event: departure, tag: departure.tag, provider: departure.provider };
      }

      if (matched) {
        matched.event.replacedBy = join.tag;
        join.replaces = matched.tag;
      }
    }

    for (const departure of departures) {
      if (!departure.replacedBy) {
        newPending.push({
          event: departure,
          tag: departure.tag,
          provider: departure.provider
        });
      }
    }

    const combined = [...openPending, ...newPending];
    if (combined.length > 0) this._pending.set(modelId, combined);
    else this._pending.delete(modelId);
  }

  _recordEvents(model, events) {
    if (events.length === 0) return;
    model.events = [...events, ...model.events];
    model.lastChange = events[events.length - 1].at;
  }

  _catalogueFor(snapshot) {
    if (Array.isArray(snapshot.catalogue)) return new Set(snapshot.catalogue);
    if (snapshot.partial === false) return new Set(Object.keys(snapshot.models || {}));
    return null;
  }

  _foldCatalogue(snapshot) {
    const catalogue = this._catalogueFor(snapshot);
    if (!catalogue) return;

    if (this._catalogue && this._catalogueHead) {
      for (const id of this._catalogue) {
        if (catalogue.has(id) || !this.models[id]) continue;

        const event = { type: 'model-delisted' };
        this._stamp(
          [event],
          id,
          this._catalogueHead,
          snapshot,
          false
        );
        this._recordEvents(this.models[id], [event]);
      }

      for (const [id, entry] of Object.entries(snapshot.models || {})) {
        if (
          this._catalogue.has(id) ||
          !observed(entry) ||
          !this.models[id]
        ) {
          continue;
        }

        const event = {
          type: 'model-listed',
          endpoints: entry.endpoints.length
        };
        this._stamp(
          [event],
          id,
          this._catalogueHead,
          snapshot,
          false
        );
        this._recordEvents(this.models[id], [event]);
      }
    }

    this._catalogue = catalogue;
    this._catalogueHead = {
      takenAt: snapshot.takenAt,
      source: snapshot.source
    };
  }

  add(snapshot) {
    if (
      this._lastTakenAt !== null &&
      String(snapshot.takenAt) < String(this._lastTakenAt)
    ) {
      throw new Error(
        `snapshots must be added in time order: ${snapshot.takenAt} came after ${this._lastTakenAt}`
      );
    }

    this._lastTakenAt = snapshot.takenAt;
    this.snapshots.push({
      takenAt: snapshot.takenAt,
      source: snapshot.source,
      partial: snapshot.partial,
      modelCount: snapshot.modelCount
    });

    if (snapshot.partial === false) {
      this._latestFull = {
        takenAt: snapshot.takenAt,
        source: snapshot.source
      };
      this._latestFullObserved = new Set(
        Object.entries(snapshot.models || {})
          .filter(([, entry]) => observed(entry))
          .map(([id]) => id)
      );
    }

    for (const [id, entry] of Object.entries(snapshot.models || {})) {
      if (!observed(entry)) continue;

      const old = this.models[id];
      const outputs = Array.isArray(entry.outputModalities)
        ? entry.outputModalities
        : old?.outputModalities;
      const normalized = normalizedEndpoints(entry, outputs);
      const priceKind = listedPriceKind(outputs);
      const endpoints = priceKind
        ? carryPrices(normalized.endpoints, old?.latest.endpoints)
        : normalized.endpoints;
      const modelPrices = priceKind
        ? entry.prices ?? old?.latest.modelPrices
        : undefined;

      if (!old) {
        const model = newModel(id, entry, snapshot, endpoints, modelPrices);
        model.series.push(seriesPoint(snapshot.takenAt, snapshot.source, endpoints, modelPrices));
        model.everMulti = endpoints.length >= 2;
        this.models[id] = model;
        continue;
      }

      if (Array.isArray(entry.outputModalities)) {
        old.outputModalities = [...entry.outputModalities];
      }
      if (Array.isArray(entry.inputModalities)) {
        old.inputModalities = [...entry.inputModalities];
      }

      const previous = {
        takenAt: old.latest.takenAt,
        source: old.latest.source
      };
      const previousEndpoints = old.latest.endpoints;
      const reconciled = this._reconcilePending(id, endpoints, snapshot.takenAt);
      const events = diffModel(previousEndpoints, endpoints);
      if (priceKind) {
        priceJoins(events, endpoints, modelPrices);
        events.push(...modelPriceEvents(old.latest.modelPrices, modelPrices));
      }

      this._stamp(
        events,
        id,
        previous,
        snapshot,
        normalized.priceNotPerToken && !priceKind
      );
      this._pairDepartures(
        id,
        events,
        reconciled.pending,
        reconciled.returned
      );

      old.series.push(seriesPoint(snapshot.takenAt, snapshot.source, endpoints, modelPrices));
      old.latest = latestOf(snapshot, entry, endpoints, modelPrices);
      old.everMulti ||= endpoints.length >= 2;
      this._recordEvents(old, events);
    }

    this._foldCatalogue(snapshot);
  }

  finish() {
    for (const model of Object.values(this.models)) {
      model.inLatestFull = this._latestFull
        ? this._latestFullObserved.has(model.slug)
        : true;
      model.latestFull = this._latestFull
        ? { ...this._latestFull }
        : null;
    }

    const events = Object.values(this.models)
      .flatMap(model => model.events)
      .sort((a, b) => {
        const byTime = String(b.at).localeCompare(String(a.at));
        if (byTime !== 0) return byTime;
        return String(a.model).localeCompare(String(b.model));
      });

    return {
      takenAt: this._lastTakenAt,
      latestFull: this._latestFull ? { ...this._latestFull } : null,
      snapshots: this.snapshots,
      models: this.models,
      events
    };
  }
}
