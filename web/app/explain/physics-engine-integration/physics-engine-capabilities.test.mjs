import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  initSync,
  physics_engine_capabilities_json,
  physics_engine_primitive_matrix_json,
} from "../../../lib/wasm-pkg/collision_wasm.js";
import {
  parseCapabilityLedger,
  parseSegmentWork,
} from "./parse-capability-ledger.ts";

initSync({
  module: readFileSync(
    new URL("../../../lib/wasm-pkg/collision_wasm_bg.wasm", import.meta.url),
  ),
});

function engineLedger() {
  return JSON.parse(physics_engine_capabilities_json());
}

test("the actual WASM ledger parses without changing capability states", () => {
  const raw = engineLedger();
  const parsed = parseCapabilityLedger(JSON.stringify(raw));
  expect(parsed.shapes).toEqual(raw.shapes);
  expect(parsed.pairs).toHaveLength(10);
  expect(
    parsed.capabilities.find((entry) => entry.key === "rotationCcd")?.status,
  ).toBe(raw.capabilities.rotationCcd);
});

test.each([
  [
    "non-finite validation",
    (data) => {
      data.validation.positiveDimensionMinimum = Infinity;
    },
  ],
  [
    "missing validation",
    (data) => {
      delete data.validation.finiteValuesRequired;
    },
  ],
  [
    "unknown schema",
    (data) => {
      data.schemaVersion = 2;
    },
  ],
  [
    "missing capability",
    (data) => {
      delete data.capabilities.rotationCcd;
    },
  ],
  [
    "unknown shape",
    (data) => {
      data.shapes[0].kind = "cylinder";
    },
  ],
  [
    "duplicate shape",
    (data) => {
      data.shapes[0] = data.shapes[1];
    },
  ],
  [
    "duplicate pair",
    (data) => {
      data.pairs[1] = { ...data.pairs[0], dispatchIndex: 1 };
    },
  ],
  [
    "invalid manifold limit",
    (data) => {
      data.pairs[0].manifoldPointLimit = 0;
    },
  ],
  [
    "wrong dispatch index",
    (data) => {
      data.pairs[0].dispatchIndex = 8;
    },
  ],
  [
    "missing rotation status",
    (data) => {
      delete data.shapes[3].solverDynamicRotation;
    },
  ],
])("rejects %s instead of displaying misleading evidence", (_name, mutate) => {
  const data = engineLedger();
  mutate(data);
  expect(() => parseCapabilityLedger(JSON.stringify(data))).toThrow();
});

test("measured segment work comes from the actual WASM dispatch scenes", () => {
  const work = parseSegmentWork(physics_engine_primitive_matrix_json());
  expect(work).toHaveLength(10);
  const sphereCapsule = work.find(
    (pair) => pair.left === "sphere" && pair.right === "capsule",
  );
  expect(sphereCapsule?.distances).toBeGreaterThan(0);
  expect(sphereCapsule?.features).toBeGreaterThan(0);
});

test.each([
  [
    "missing counter",
    (data) => {
      delete data.pairs[0].primitiveSegmentFeatureTests;
    },
  ],
  [
    "fractional counter",
    (data) => {
      data.pairs[0].primitiveSegmentDistanceEvaluations = 0.5;
    },
  ],
  [
    "negative counter",
    (data) => {
      data.pairs[0].primitiveSegmentFeatureTests = -1;
    },
  ],
  [
    "duplicate work cell",
    (data) => {
      data.pairs[1] = data.pairs[0];
    },
  ],
  [
    "wrong source",
    (data) => {
      data.source = "local-fallback";
    },
  ],
])("rejects %s in measured work", (_name, mutate) => {
  const data = JSON.parse(physics_engine_primitive_matrix_json());
  mutate(data);
  expect(() => parseSegmentWork(JSON.stringify(data))).toThrow();
});
