import {
  readFile as fsReadFile,
  writeFile,
  rename,
  unlink
} from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';

export const DAILY_LIMIT_USD = 2;
export const UNKNOWN_COST_USD = 0.001;

export function createLimits(path, {
  now = () => new Date(),
  read = (p) => fsReadFile(p, 'utf8')
} = {}) {
  let queue = Promise.resolve();
  // `known`: the state this process last loaded or saved. `pending`: spending not yet
  // in the file (a read or a save failed), counted in every check until a save lands.
  let known = null;
  let pending = { day: null, usd: 0 };
  let sequence = 0;

  const enqueue = (operation) => {
    const result = queue.then(operation, operation);
    queue = result.catch(() => {});
    return result;
  };

  const dayNow = () => now().toISOString().slice(0, 10);

  const validState = (value) =>
    value &&
    typeof value === 'object' &&
    typeof value.day === 'string' &&
    Number.isFinite(value.spentUsd) &&
    value.spentUsd >= 0;

  const rounded = (value) =>
    Math.round((value + Number.EPSILON) * 1e12) / 1e12;

  async function load() {
    try {
      const text = await read(path);
      let value;
      try {
        value = JSON.parse(text);
      } catch {
        value = null;
      }

      if (!validState(value)) {
        return {
          state: { day: dayNow(), spentUsd: 0 },
          available: true,
          fresh: true
        };
      }

      return {
        state: value,
        available: true,
        fresh: false
      };
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return {
          state: { day: dayNow(), spentUsd: 0 },
          available: true,
          fresh: true
        };
      }

      return { state: null, available: false, fresh: false };
    }
  }

  async function save(state) {
    const temporary = join(
      dirname(path),
      `.${basename(path)}.${process.pid}.${sequence++}.tmp`
    );

    try {
      await writeFile(temporary, JSON.stringify(state, null, 2), 'utf8');
      await rename(temporary, path);
    } catch (error) {
      try {
        await unlink(temporary);
      } catch {
        // The original write error is the useful one.
      }
      throw error;
    }
  }

  // Saves `state` (which holds every pending cost); a failed save keeps them pending.
  async function settle(state) {
    try {
      await save(state);
      known = state;
      pending = { day: state.day, usd: 0 };
    } catch {
      // Kept in memory; the next take or spend tries again.
    }
  }

  // The day's spend: the file (else the last state known) plus what is pending.
  // A file dated later than the clock keeps its day and spend.
  // `readable` is false when the file could not be read; `state` is null when
  // nothing is known at all.
  async function refresh({ write = false } = {}) {
    const loaded = await load();
    if (loaded.available) known = loaded.state;
    const today = dayNow();
    const day = known && known.day > today ? known.day : today;
    if (pending.day !== day) pending = { day, usd: 0 };

    if (!known) return { readable: false, state: null };

    const base = known.day === day ? known.spentUsd : 0;
    const state = { day, spentUsd: rounded(base + pending.usd) };

    if (
      write &&
      loaded.available &&
      (loaded.fresh || pending.usd > 0 || known.day !== day)
    ) {
      await settle(state);
    }

    return { readable: loaded.available, state };
  }

  async function take() {
    return enqueue(async () => {
      const { state } = await refresh({ write: true });
      if (!state) return { ok: false, reason: 'unavailable' };
      return state.spentUsd >= DAILY_LIMIT_USD
        ? { ok: false, reason: 'daily' }
        : { ok: true };
    });
  }

  async function spend(usd) {
    if (!(typeof usd === 'number' && Number.isFinite(usd) && usd > 0)) {
      return enqueue(async () => {});
    }

    return enqueue(async () => {
      const { readable, state } = await refresh();
      pending = { day: pending.day, usd: rounded(pending.usd + usd) };
      if (readable) {
        await settle({ day: state.day, spentUsd: rounded(state.spentUsd + usd) });
      }
    });
  }

  async function canSpend() {
    return enqueue(async () => {
      const { state } = await refresh();
      return Boolean(state) && state.spentUsd < DAILY_LIMIT_USD;
    });
  }

  return { take, spend, canSpend };
}
