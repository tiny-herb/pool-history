import test from "node:test";
import assert from "node:assert/strict";

import {
  partialSnapshot,
  nextRun,
  scrub,
  stopper,
} from "../src/watch.mjs";

const snapshot = {
  takenAt: "2026-11-17T16:37:00Z",
  source: "openrouter-api",
  partial: false,
  note: null,
  modelCount: 4,
  models: {
    "z/solo": {
      name: "Solo",
      listed: { prompt: 1, completion: 2 },
      endpoints: [
        {
          tag: "solo",
          provider: "Solo",
          prompt: 1,
          completion: 2,
          discount: 0,
          context: 1048576,
          quantization: "fp8",
          status: 0,
          uptime30m: 100,
          uptime1d: 100,
          uptimePage: null,
          latency30m: null,
          throughput30m: null,
        },
      ],
    },
    "a/model": {
      name: "A model",
      listed: null,
      endpoints: [],
    },
    "z/broken": {
      name: "Broken",
      listed: null,
      error: "GET https://openrouter.ai/api/v1/models/z/broken/endpoints returned HTTP 503: down",
    },
    "b/model": {
      name: "B model",
      listed: { prompt: 0.5, completion: 1 },
      endpoints: [
        {
          tag: "b",
          provider: "B",
          prompt: 0.5,
          completion: 1,
          discount: 0,
          context: null,
          quantization: null,
          status: null,
          uptime30m: null,
          uptime1d: null,
          uptimePage: null,
          latency30m: null,
          throughput30m: null,
        },
      ],
    },
  },
};

test("partialSnapshot marks the snapshot partial, sorts the catalogue, and keeps only requested models", () => {
  const result = partialSnapshot(snapshot, ["z/solo", "a/model"]);

  assert.deepEqual(result, {
    takenAt: "2026-11-17T16:37:00Z",
    source: "openrouter-api",
    partial: true,
    note: null,
    modelCount: 4,
    catalogue: ["a/model", "b/model", "z/broken", "z/solo"],
    models: {
      "a/model": {
        name: "A model",
        listed: null,
        endpoints: [],
      },
      "z/solo": {
        name: "Solo",
        listed: { prompt: 1, completion: 2 },
        endpoints: [
          {
            tag: "solo",
            provider: "Solo",
            prompt: 1,
            completion: 2,
            discount: 0,
            context: 1048576,
            quantization: "fp8",
            status: 0,
            uptime30m: 100,
            uptime1d: 100,
            uptimePage: null,
            latency30m: null,
            throughput30m: null,
          },
        ],
      },
    },
  });
});

test("partialSnapshot does not mutate the source snapshot or model order", () => {
  const before = structuredClone(snapshot);

  partialSnapshot(snapshot, ["b/model"]);

  assert.deepEqual(snapshot, before);
  assert.deepEqual(Object.keys(snapshot.models), [
    "z/solo",
    "a/model",
    "z/broken",
    "b/model",
  ]);
});

test("partialSnapshot can contain no models when only the catalogue changed", () => {
  const result = partialSnapshot(snapshot, []);

  assert.equal(result.partial, true);
  assert.deepEqual(result.catalogue, [
    "a/model",
    "b/model",
    "z/broken",
    "z/solo",
  ]);
  assert.deepEqual(result.models, {});
  assert.equal(result.modelCount, 4);
});

test("nextRun selects the next strictly-future matching minute", () => {
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
});

test("scrub replaces every occurrence of each secret", () => {
  assert.equal(
    scrub(
      "Authorization: Bearer secret-key; token=secret-key; other=another-secret",
      ["secret-key", "another-secret"],
    ),
    "Authorization: Bearer [redacted]; token=[redacted]; other=[redacted]",
  );
});

test("scrub leaves ordinary text unchanged and ignores missing secrets", () => {
  assert.equal(
    scrub("check failed: network timeout", [undefined, "", "not-present"]),
    "check failed: network timeout",
  );
});

test("stopper requests exit immediately when idle", () => {
  const exits = [];
  const logs = [];

  const control = stopper({
    exit: (code) => exits.push(code),
    log: (...args) => logs.push(args.join(" ")),
  });

  control.request();

  assert.deepEqual(exits, [0]);
  assert.deepEqual(logs, ["watch stopped"]);
});

test("stopper runs an in-progress operation to completion after a stop request", async () => {
  const exits = [];
  const logs = [];
  let finished = false;

  const control = stopper({
    exit: (code) => exits.push(code),
    log: (...args) => logs.push(args.join(" ")),
  });

  const result = await control.run(async () => {
    control.request();
    await Promise.resolve();
    finished = true;
    return 42;
  });

  assert.equal(result, 42);
  assert.equal(finished, true);
  assert.deepEqual(exits, [0]);
  assert.deepEqual(logs, ["stopping after this run (Ctrl+C again to stop now)", "watch stopped"]);
});

test("stopper.track returns the original promise result", async () => {
  const control = stopper({
    exit: () => {},
    log: () => {},
  });

  const promise = Promise.resolve("done");

  assert.equal(await control.track(promise), "done");
});
