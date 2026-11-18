import test from "node:test";
import assert from "node:assert/strict";
import {
  partialSnapshot,
  nextRun,
  scrub,
  stopper,
} from "../src/watch.mjs";

test("partialSnapshot keeps the complete sorted catalogue and selected models", () => {
  const snapshot = {
    takenAt: "2026-11-17T16:37:00Z",
    source: "openrouter-api",
    partial: false,
    note: null,
    modelCount: 4,
    catalogue: [
      "z/solo",
      "deepseek/deepseek-v3.2",
      "z/broken",
      "xiaomi/mimo-v2.6-pro",
    ],
    models: {
      "z/solo": {
        name: "Solo",
        listed: { prompt: 1, completion: 2 },
        endpoints: [],
      },
      "deepseek/deepseek-v3.2": {
        name: "DeepSeek: DeepSeek V3.2",
        listed: { prompt: 1, completion: 2 },
        endpoints: [],
      },
      "z/broken": {
        name: "Broken",
        listed: null,
        error: "down",
      },
      "xiaomi/mimo-v2.6-pro": {
        name: "Xiaomi: MiMo-V2.6-Pro",
        listed: null,
        endpoints: [],
      },
    },
  };

  const result = partialSnapshot(snapshot, [
    "z/solo",
    "xiaomi/mimo-v2.6-pro",
  ]);

  assert.deepEqual(result, {
    takenAt: "2026-11-17T16:37:00Z",
    source: "openrouter-api",
    partial: true,
    note: null,
    modelCount: 4,
    catalogue: [
      "deepseek/deepseek-v3.2",
      "xiaomi/mimo-v2.6-pro",
      "z/broken",
      "z/solo",
    ],
    models: {
      "xiaomi/mimo-v2.6-pro": {
        name: "Xiaomi: MiMo-V2.6-Pro",
        listed: null,
        endpoints: [],
      },
      "z/solo": {
        name: "Solo",
        listed: { prompt: 1, completion: 2 },
        endpoints: [],
      },
    },
  });

  assert.equal(result.partial, true);
  // Kept models stay in the snapshot's order.
  assert.deepEqual(Object.keys(result.models), [
    "z/solo",
    "xiaomi/mimo-v2.6-pro",
  ]);
});

test("partialSnapshot derives and sorts catalogue ids when catalogue is absent", () => {
  const snapshot = {
    takenAt: "2026-11-17T16:37:00Z",
    source: "openrouter-api",
    partial: false,
    note: null,
    modelCount: 3,
    models: {
      "z/c": {
        name: "C",
        listed: null,
        endpoints: [],
      },
      "a/a": {
        name: "A",
        listed: null,
        endpoints: [],
      },
      "b/b": {
        name: "B",
        listed: null,
        error: "failed",
      },
    },
  };

  const result = partialSnapshot(snapshot, []);

  assert.equal(result.partial, true);
  assert.deepEqual(result.catalogue, ["a/a", "b/b", "z/c"]);
  assert.deepEqual(result.models, {});
});

test("partialSnapshot does not mutate its input", () => {
  const snapshot = {
    takenAt: "2026-11-17T16:37:00Z",
    source: "openrouter-api",
    partial: false,
    note: null,
    modelCount: 1,
    catalogue: ["a/b"],
    models: {
      "a/b": {
        name: "A: B",
        listed: null,
        endpoints: [],
      },
    },
  };

  const before = structuredClone(snapshot);
  const result = partialSnapshot(snapshot, ["a/b"]);

  assert.deepEqual(snapshot, before);
  assert.notEqual(result, snapshot);
  assert.notEqual(result.models, snapshot.models);
});

test("nextRun schedules strictly after now on the next matching minute", () => {
  assert.equal(
    nextRun(new Date("2026-11-16T19:06:42Z"), 15).toISOString(),
    "2026-11-16T19:07:00.000Z",
  );

  assert.equal(
    nextRun(new Date("2026-11-16T19:07:00Z"), 15).toISOString(),
    "2026-11-16T19:22:00.000Z",
  );

  assert.equal(
    nextRun(new Date("2026-11-16T23:52:30Z"), 15).toISOString(),
    "2026-11-17T00:07:00.000Z",
  );

  assert.equal(
    nextRun(new Date("2026-11-16T19:08:00Z"), 5).toISOString(),
    "2026-11-16T19:12:00.000Z",
  );

  assert.equal(
    nextRun(new Date("2026-11-16T19:06:00Z"), 1).toISOString(),
    "2026-11-16T19:07:00.000Z",
  );
});

test("scrub replaces every occurrence of each defined secret", () => {
  assert.equal(
    scrub(
      "token=abc123 key=xyz abc123 xyz abc123",
      ["abc123", "xyz"],
    ),
    "token=[redacted] key=[redacted] [redacted] [redacted] [redacted]",
  );
});

test("scrub ignores undefined and empty secrets", () => {
  assert.equal(
    scrub("nothing should change", [undefined, "", null]),
    "nothing should change",
  );
});

test("scrub handles secrets containing regular-expression characters", () => {
  assert.equal(
    scrub(
      "a.$[x] a.$[x] a\\b",
      ["a.$[x]", "a\\b"],
    ),
    "[redacted] [redacted] [redacted]",
  );
});

test("stopper request is idempotent", () => {
  const exits = [];
  const logs = [];
  const control = stopper({
    exit: (code) => exits.push(code),
    log: (...args) => logs.push(args.join(" ")),
  });

  control.request();
  control.request();

  assert.deepEqual(exits, [0, 130]);
  assert.deepEqual(logs, ['watch stopped']);
});

test("stopper track waits for a promise and returns its result", async () => {
  const control = stopper({
    exit: () => {},
    log: () => {},
  });

  let resolve;
  const pending = new Promise((r) => {
    resolve = r;
  });

  const tracked = control.track(pending);
  let finished = false;
  tracked.then(() => {
    finished = true;
  });

  await Promise.resolve();
  assert.equal(finished, false);

  resolve("done");
  assert.equal(await tracked, "done");
});

test("stopper run returns the wrapped result", async () => {
  const control = stopper({
    exit: () => {},
    log: () => {},
  });

  assert.equal(
    await control.run(async () => "ok"),
    "ok",
  );
});

test("stopper run propagates rejection", async () => {
  const control = stopper({
    exit: () => {},
    log: () => {},
  });

  await assert.rejects(
    control.run(async () => {
      throw new Error("boom");
    }),
    { message: "boom" },
  );
});

test("stopper run waits for tracked work before resolving", async () => {
  const control = stopper({
    exit: () => {},
    log: () => {},
  });

  let release;
  const tracked = new Promise((resolve) => {
    release = resolve;
  });
  control.track(tracked);

  const result = control.run(async () => "round");
  let settled = false;
  result.then(() => {
    settled = true;
  });

  await Promise.resolve();
  assert.equal(settled, false);

  release();
  assert.equal(await result, "round");
});
