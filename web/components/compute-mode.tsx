"use client";

import { useEffect, useMemo, useState } from "react";

import initWasm, { DemoWorld } from "../lib/wasm-pkg/collision_wasm";
import {
  createWebGpuGridRunner,
  type WebGpuGridMeasurement,
  type WebGpuGridRunner,
} from "../lib/webgpu-grid";
import {
  createWebGpuNaiveRunner,
  type WebGpuNaiveMeasurement,
  type WebGpuNaiveRunner,
} from "../lib/webgpu-naive";

type Scenario = "uniform" | "clustered";

type BodySnapshot = {
  id: number;
  min: [number, number, number];
  max: [number, number, number];
};

type Snapshot = {
  bodies: BodySnapshot[];
  pairs: [number, number][];
  possiblePairs: number;
  stats: {
    aabbTests: number;
    occupiedCells: number | null;
    spatialOverlaps: number;
  };
};

type InteractionMatrix = {
  layers: { bits: number }[];
};

type GpuNaiveSummary = Omit<WebGpuNaiveMeasurement, "bitset">;
type GpuGridSummary = Omit<WebGpuGridMeasurement, "bitset">;

type ComputeRow = {
  objects: number;
  possiblePairs: number;
  overlaps: number;
  cpuNaiveMs: number;
  cpuGridMs: number;
  cpuGridAabbTests: number;
  cpuGridOccupiedCells: number;
  gpuNaive: GpuNaiveSummary | null;
  gpuGrid: GpuGridSummary | null;
  naiveParity: boolean | null;
  gridPairParity: boolean | null;
  gridWorkParity: boolean | null;
};

const COUNTS = [100, 250, 500, 1000, 2500, 5000] as const;
const SAMPLES = 3;
const CELL_SIZE = 4;

export function ComputeMode() {
  const [scenario, setScenario] = useState<Scenario>("uniform");
  const [rows, setRows] = useState<ComputeRow[]>([]);
  const [progress, setProgress] = useState(0);
  const [naiveGpuSetup, setNaiveGpuSetup] = useState<{ setupMs: number; timestampSupported: boolean } | null>(null);
  const [gridGpuSetup, setGridGpuSetup] = useState<{ setupMs: number; timestampSupported: boolean } | null>(null);
  const [gpuUnavailable, setGpuUnavailable] = useState<string | null>(null);
  const [gridGpuUnavailable, setGridGpuUnavailable] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let naiveRunner: WebGpuNaiveRunner | null = null;
    let gridRunner: WebGpuGridRunner | null = null;

    const run = async () => {
      setRows([]);
      setProgress(0);
      setNaiveGpuSetup(null);
      setGridGpuSetup(null);
      setGpuUnavailable(null);
      setGridGpuUnavailable(null);
      setError(null);

      try {
        await initWasm();
        try {
          naiveRunner = await createWebGpuNaiveRunner();
          if (!cancelled) {
            setNaiveGpuSetup({
              setupMs: naiveRunner.setupMs,
              timestampSupported: naiveRunner.timestampSupported,
            });
          }
        } catch (reason) {
          if (!cancelled) setGpuUnavailable(String(reason));
        }

        if (naiveRunner) {
          try {
            gridRunner = await createWebGpuGridRunner();
            if (!cancelled) {
              setGridGpuSetup({
                setupMs: gridRunner.setupMs,
                timestampSupported: gridRunner.timestampSupported,
              });
            }
          } catch (reason) {
            if (!cancelled) setGridGpuUnavailable(String(reason));
          }
        }

        const nextRows: ComputeRow[] = [];
        for (let index = 0; index < COUNTS.length; index += 1) {
          if (cancelled) return;
          const objects = COUNTS[index];
          const worldExtent = 12 * Math.cbrt(objects / COUNTS[0]);
          const world = new DemoWorld(
            scenario,
            objects,
            CELL_SIZE,
            1.5,
            42,
            worldExtent,
            0.6,
            0,
            0,
            0,
          );

          try {
            enableEveryLayerPair(world);
            const naiveSnapshot = JSON.parse(world.snapshot_json("naive")) as Snapshot;
            const gridSnapshot = JSON.parse(world.snapshot_json("grid")) as Snapshot;
            assertRustOracleContract(naiveSnapshot, gridSnapshot);

            const oracleBitset = pairBitset(naiveSnapshot);
            const rustGridBitset = pairBitset(gridSnapshot);
            if (!bitsetsEqual(oracleBitset, rustGridBitset)) {
              throw new Error(`Rust uniform-grid pair parity failed at ${objects.toLocaleString()} objects.`);
            }
            if (gridSnapshot.stats.occupiedCells == null) {
              throw new Error("Rust uniform-grid snapshot did not report occupied cells.");
            }

            const cpuNaiveSamples: number[] = [];
            const cpuGridSamples: number[] = [];
            let cpuNaiveCount = 0;
            let cpuGridCount = 0;
            for (let sample = 0; sample < SAMPLES; sample += 1) {
              let started = performance.now();
              cpuNaiveCount = world.naive_overlap_count();
              cpuNaiveSamples.push(performance.now() - started);

              started = performance.now();
              cpuGridCount = world.uniform_grid_overlap_count();
              cpuGridSamples.push(performance.now() - started);
            }
            if (
              cpuNaiveCount !== naiveSnapshot.stats.spatialOverlaps ||
              cpuGridCount !== naiveSnapshot.stats.spatialOverlaps
            ) {
              throw new Error(
                `Rust benchmark/oracle mismatch at ${objects.toLocaleString()} objects.`,
              );
            }

            const aabbs = packAabbs(naiveSnapshot.bodies);
            const naiveGpuSamples: WebGpuNaiveMeasurement[] = [];
            const gridGpuSamples: WebGpuGridMeasurement[] = [];
            let naiveParity: boolean | null = null;
            let gridPairParity: boolean | null = null;
            let gridWorkParity: boolean | null = null;

            if (naiveRunner) {
              for (let sample = 0; sample < SAMPLES; sample += 1) {
                const measurement = await naiveRunner.run(aabbs, objects);
                naiveGpuSamples.push(measurement);
                naiveParity =
                  (naiveParity ?? true) && bitsetsEqual(oracleBitset, measurement.bitset);
                if (cancelled) return;
              }
            }

            if (gridRunner) {
              for (let sample = 0; sample < SAMPLES; sample += 1) {
                const measurement = await gridRunner.run(aabbs, objects, CELL_SIZE);
                gridGpuSamples.push(measurement);
                gridPairParity =
                  (gridPairParity ?? true) && bitsetsEqual(oracleBitset, measurement.bitset);
                gridWorkParity =
                  (gridWorkParity ?? true) &&
                  measurement.aabbTests === gridSnapshot.stats.aabbTests &&
                  measurement.occupiedCells === gridSnapshot.stats.occupiedCells;
                if (cancelled) return;
              }
            }

            const gpuNaive =
              naiveGpuSamples.length > 0
                ? omitNaiveBitset(medianByTotal(naiveGpuSamples))
                : null;
            const gpuGrid =
              gridGpuSamples.length > 0
                ? omitGridBitset(medianByTotal(gridGpuSamples))
                : null;

            nextRows.push({
              objects,
              possiblePairs: naiveSnapshot.possiblePairs,
              overlaps: naiveSnapshot.stats.spatialOverlaps,
              cpuNaiveMs: median(cpuNaiveSamples),
              cpuGridMs: median(cpuGridSamples),
              cpuGridAabbTests: gridSnapshot.stats.aabbTests,
              cpuGridOccupiedCells: gridSnapshot.stats.occupiedCells,
              gpuNaive,
              gpuGrid,
              naiveParity,
              gridPairParity,
              gridWorkParity,
            });
          } finally {
            world.free();
          }

          if (!cancelled) {
            setRows([...nextRows]);
            setProgress(index + 1);
          }
          await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
        }
      } catch (reason) {
        if (!cancelled) setError(String(reason));
      } finally {
        naiveRunner?.destroy();
        gridRunner?.destroy();
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [scenario]);

  const naiveGpuCrossover = useMemo(
    () =>
      rows.find(
        (row) =>
          row.naiveParity === true &&
          row.gpuNaive !== null &&
          row.gpuNaive.totalMs < row.cpuNaiveMs,
      ) ?? null,
    [rows],
  );
  const gridGpuCrossover = useMemo(
    () =>
      rows.find(
        (row) =>
          row.gridPairParity === true &&
          row.gridWorkParity === true &&
          row.gpuGrid !== null &&
          row.gpuGrid.totalMs < row.cpuGridMs,
      ) ?? null,
    [rows],
  );
  const finalRow = rows.at(-1);
  const winner = finalRow ? fastestBackend(finalRow) : null;
  const naiveParityStatus = verificationStatus(
    rows.map((row) => row.naiveParity),
    progress,
    Boolean(gpuUnavailable),
  );
  const gridParityStatus = verificationStatus(
    rows.map((row) =>
      row.gridPairParity == null || row.gridWorkParity == null
        ? null
        : row.gridPairParity && row.gridWorkParity,
    ),
    progress,
    Boolean(gpuUnavailable || gridGpuUnavailable),
  );

  return (
    <div className="space-y-8">
      <section className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-5 sm:p-7">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-600">
              Algorithm × execution backend
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-zinc-100">
              Which matters more: a better algorithm, or a more parallel machine?
            </h2>
            <p className="mt-3 leading-7 text-zinc-500">
              Every point uses the same deterministic Rust-generated AABBs. Compare naive all-pairs and a uniform grid on Rust/WASM and WebGPU, while exact pair parity keeps performance claims subordinate to correctness.
            </p>
          </div>
          <label className="text-xs font-semibold text-zinc-400">
            Scene distribution
            <select
              value={scenario}
              onChange={(event) => setScenario(event.target.value as Scenario)}
              className="mt-2 block rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
            >
              <option value="uniform">Uniform</option>
              <option value="clustered">Clustered</option>
            </select>
          </label>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="Fastest at largest scene"
            value={winner?.label ?? "pending"}
            detail={winner && finalRow ? `${formatMs(winner.ms)} at ${finalRow.objects.toLocaleString()} objects.` : "Wait for the largest deterministic scene."}
          />
          <MetricCard
            label="Naive pair parity"
            value={naiveParityStatus}
            detail="WebGPU brute force must match every Rust naive overlap bit exactly."
          />
          <MetricCard
            label="Grid pair + work parity"
            value={gridParityStatus}
            detail="WebGPU grid must match both the overlap bitset and Rust's unique AABB-test / occupied-cell counts."
          />
          <MetricCard
            label="GPU pipeline setup"
            value={formatSetup(naiveGpuSetup, gridGpuSetup, gpuUnavailable)}
            detail="Adapter/device creation and pipeline compilation stay outside each benchmark point."
          />
        </div>

        {gpuUnavailable && (
          <p className="mt-5 rounded-xl border border-amber-900/50 bg-amber-950/20 p-4 text-sm leading-6 text-amber-200">
            {gpuUnavailable} CPU measurements will still run. Open this page in a WebGPU-capable browser over HTTPS to enable GPU comparisons.
          </p>
        )}
        {gridGpuUnavailable && (
          <p className="mt-5 rounded-xl border border-amber-900/50 bg-amber-950/20 p-4 text-sm leading-6 text-amber-200">
            WebGPU naive is available, but the uniform-grid backend could not initialize: {gridGpuUnavailable}
          </p>
        )}
        {error && (
          <p className="mt-5 rounded-xl border border-red-900/50 bg-red-950/30 p-4 text-sm leading-6 text-red-300">
            {error}
          </p>
        )}

        <div className="mt-7">
          <TimingChart rows={rows} />
        </div>

        {progress < COUNTS.length && !error && (
          <p className="mt-4 text-sm text-zinc-500">
            Measuring {progress + 1} of {COUNTS.length} deterministic scenes · median of {SAMPLES} samples per backend…
          </p>
        )}
      </section>

      <section className="overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-950/70">
        <div className="border-b border-zinc-800 px-5 py-4 sm:px-7">
          <h2 className="font-semibold text-zinc-100">Four-way timing comparison</h2>
          <p className="mt-1 max-w-4xl text-sm leading-6 text-zinc-500">
            CPU values time minimal scalar-return WASM entry points. GPU totals include per-point preparation, upload, dispatch, synchronization, readback, and decoding; device and pipeline creation are excluded.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[72rem] w-full text-left text-sm">
            <thead className="bg-zinc-900/50 text-xs uppercase tracking-wide text-zinc-600">
              <tr>
                <th className="px-5 py-3">Objects</th>
                <th className="px-5 py-3">CPU naive</th>
                <th className="px-5 py-3">WebGPU naive</th>
                <th className="px-5 py-3">CPU grid</th>
                <th className="px-5 py-3">WebGPU grid</th>
                <th className="px-5 py-3">GPU grid pass</th>
                <th className="px-5 py-3">Fastest valid</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {rows.map((row) => {
                const fastest = fastestBackend(row);
                return (
                  <tr key={row.objects}>
                    <td className="px-5 py-4 font-mono text-zinc-200">{row.objects.toLocaleString()}</td>
                    <td className="px-5 py-4 font-mono text-zinc-200">{formatMs(row.cpuNaiveMs)}</td>
                    <td className="px-5 py-4 font-mono text-zinc-200">{row.gpuNaive ? formatMs(row.gpuNaive.totalMs) : "—"}</td>
                    <td className="px-5 py-4 font-mono text-zinc-200">{formatMs(row.cpuGridMs)}</td>
                    <td className="px-5 py-4 font-mono text-zinc-200">{row.gpuGrid ? formatMs(row.gpuGrid.totalMs) : "—"}</td>
                    <td className="px-5 py-4 font-mono text-zinc-400">{row.gpuGrid?.computeMs == null ? "—" : formatMs(row.gpuGrid.computeMs)}</td>
                    <td className="px-5 py-4 font-semibold text-zinc-300">{fastest.label}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-950/70">
        <div className="border-b border-zinc-800 px-5 py-4 sm:px-7">
          <h2 className="font-semibold text-zinc-100">Uniform-grid work parity</h2>
          <p className="mt-1 max-w-4xl text-sm leading-6 text-zinc-500">
            Rust and WebGPU insert each body into every touched cell and globally deduplicate candidate pairs before exact AABB tests. Equal work counters are a stronger check than equal final overlap counts alone.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[70rem] w-full text-left text-sm">
            <thead className="bg-zinc-900/50 text-xs uppercase tracking-wide text-zinc-600">
              <tr>
                <th className="px-5 py-3">Objects</th>
                <th className="px-5 py-3">Possible pairs</th>
                <th className="px-5 py-3">Grid AABB tests CPU</th>
                <th className="px-5 py-3">Grid AABB tests GPU</th>
                <th className="px-5 py-3">Eliminated</th>
                <th className="px-5 py-3">Occupied cells CPU/GPU</th>
                <th className="px-5 py-3">Memberships</th>
                <th className="px-5 py-3">Pair parity</th>
                <th className="px-5 py-3">Work parity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {rows.map((row) => (
                <tr key={row.objects}>
                  <td className="px-5 py-4 font-mono text-zinc-200">{row.objects.toLocaleString()}</td>
                  <td className="px-5 py-4 font-mono text-zinc-400">{row.possiblePairs.toLocaleString()}</td>
                  <td className="px-5 py-4 font-mono text-zinc-400">{row.cpuGridAabbTests.toLocaleString()}</td>
                  <td className="px-5 py-4 font-mono text-zinc-400">{row.gpuGrid ? row.gpuGrid.aabbTests.toLocaleString() : "—"}</td>
                  <td className="px-5 py-4 font-mono text-zinc-400">{formatPercent(1 - row.cpuGridAabbTests / Math.max(1, row.possiblePairs))}</td>
                  <td className="px-5 py-4 font-mono text-zinc-400">{row.gpuGrid ? `${row.cpuGridOccupiedCells.toLocaleString()} / ${row.gpuGrid.occupiedCells.toLocaleString()}` : `${row.cpuGridOccupiedCells.toLocaleString()} / —`}</td>
                  <td className="px-5 py-4 font-mono text-zinc-400">{row.gpuGrid ? row.gpuGrid.memberships.toLocaleString() : "—"}</td>
                  <td className="px-5 py-4">{ParityLabel({ value: row.gridPairParity })}</td>
                  <td className="px-5 py-4">{ParityLabel({ value: row.gridWorkParity })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-950/70">
        <div className="border-b border-zinc-800 px-5 py-4 sm:px-7">
          <h2 className="font-semibold text-zinc-100">GPU cost breakdown</h2>
          <p className="mt-1 max-w-4xl text-sm leading-6 text-zinc-500">
            Pass-only values require the adapter's timestamp-query feature. Submit→map contains queueing, compute, copies, synchronization, and mapping, so it is not additive with the pass columns.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[76rem] w-full text-left text-sm">
            <thead className="bg-zinc-900/50 text-xs uppercase tracking-wide text-zinc-600">
              <tr>
                <th className="px-5 py-3">Objects</th>
                <th className="px-5 py-3">Naive prepare</th>
                <th className="px-5 py-3">Naive pass</th>
                <th className="px-5 py-3">Grid prepare</th>
                <th className="px-5 py-3">Grid build</th>
                <th className="px-5 py-3">Grid test</th>
                <th className="px-5 py-3">Grid submit→map</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {rows.map((row) => (
                <tr key={row.objects}>
                  <td className="px-5 py-4 font-mono text-zinc-200">{row.objects.toLocaleString()}</td>
                  <td className="px-5 py-4 font-mono text-zinc-400">{row.gpuNaive ? formatMs(row.gpuNaive.prepareUploadMs) : "—"}</td>
                  <td className="px-5 py-4 font-mono text-zinc-400">{row.gpuNaive?.computeMs == null ? "—" : formatMs(row.gpuNaive.computeMs)}</td>
                  <td className="px-5 py-4 font-mono text-zinc-400">{row.gpuGrid ? formatMs(row.gpuGrid.prepareUploadMs) : "—"}</td>
                  <td className="px-5 py-4 font-mono text-zinc-400">{row.gpuGrid?.buildPassMs == null ? "—" : formatMs(row.gpuGrid.buildPassMs)}</td>
                  <td className="px-5 py-4 font-mono text-zinc-400">{row.gpuGrid?.testPassMs == null ? "—" : formatMs(row.gpuGrid.testPassMs)}</td>
                  <td className="px-5 py-4 font-mono text-zinc-400">{row.gpuGrid ? formatMs(row.gpuGrid.submitReadbackMs) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <ComputeNote
          title="Algorithmic gain on CPU"
          copy={finalRow ? `At ${finalRow.objects.toLocaleString()} objects, CPU grid is ${formatRatio(finalRow.cpuNaiveMs / finalRow.cpuGridMs)} relative to CPU naive.` : "Measures how much the uniform grid gains without changing hardware."}
        />
        <ComputeNote
          title="Parallelism gain for naive"
          copy={naiveGpuCrossover ? `End-to-end WebGPU brute force first beats CPU brute force at the measured ${naiveGpuCrossover.objects.toLocaleString()}-object point.` : "No parity-valid end-to-end WebGPU brute-force crossover has appeared yet."}
        />
        <ComputeNote
          title="Parallelism gain for grid"
          copy={gridGpuCrossover ? `End-to-end WebGPU grid first beats CPU grid at the measured ${gridGpuCrossover.objects.toLocaleString()}-object point.` : "No parity-and-work-valid end-to-end WebGPU-grid crossover has appeared yet."}
        />
        <ComputeNote
          title="Combined gain"
          copy={finalRow?.gpuGrid && finalRow.gridPairParity === true && finalRow.gridWorkParity === true ? `At the largest scene, WebGPU grid is ${formatRatio(finalRow.cpuNaiveMs / finalRow.gpuGrid.totalMs)} relative to CPU naive.` : "Combines algorithmic pruning with GPU parallelism once grid parity is proven."}
        />
      </section>

      <section className="rounded-3xl border border-zinc-800 bg-zinc-900/25 p-5 sm:p-7">
        <h2 className="text-lg font-semibold text-zinc-100">Measurement contract</h2>
        <div className="mt-4 grid gap-4 text-sm leading-6 text-zinc-500 md:grid-cols-2">
          <p>
            Scene generation stays in Rust with seed 42, fixed 0.6 half-extents, and a {CELL_SIZE}-unit grid. World volume grows with object count so average density stays roughly stable. Every collision-layer combination is enabled before oracle snapshots, and Rust naive remains the final pair-set reference.
          </p>
          <p>
            CPU timings use minimal Rust/WASM methods that run only the selected broad phase and return the overlap count; scene generation and JSON snapshots are outside the timer. GPU totals begin before per-point buffer preparation and include upload, dispatch, synchronization, readback, and decoding.
          </p>
          <p>
            The WebGPU grid uses CPU-prepared integer cell ranges solely to preserve Rust's floor-based spatial-hash mapping exactly from the same f32 AABBs. That O(n) preparation is included in GPU total time. Cell membership insertion, candidate traversal, global pair deduplication, exact AABB tests, and overlap recording execute on the GPU.
          </p>
          <p>
            Grid correctness is deliberately stronger than final-pair parity: the GPU must also reproduce Rust's number of occupied cells and unique exact AABB tests. Performance rows remain visible on mismatch for diagnosis, but mismatching GPU results are excluded from “fastest” and crossover claims.
          </p>
        </div>
      </section>
    </div>
  );
}

function assertRustOracleContract(naive: Snapshot, grid: Snapshot) {
  if (naive.pairs.length !== naive.stats.spatialOverlaps) {
    throw new Error(
      `Rust naive oracle pair list is filtered: expected ${naive.stats.spatialOverlaps}, received ${naive.pairs.length}.`,
    );
  }
  if (grid.pairs.length !== grid.stats.spatialOverlaps) {
    throw new Error(
      `Rust grid oracle pair list is filtered: expected ${grid.stats.spatialOverlaps}, received ${grid.pairs.length}.`,
    );
  }
  if (
    naive.possiblePairs !== grid.possiblePairs ||
    naive.stats.spatialOverlaps !== grid.stats.spatialOverlaps
  ) {
    throw new Error("Rust naive and uniform-grid snapshots disagree before GPU comparison.");
  }
}

function enableEveryLayerPair(world: DemoWorld) {
  const matrix = JSON.parse(world.interaction_matrix_json()) as InteractionMatrix;
  for (let left = 0; left < matrix.layers.length; left += 1) {
    for (let right = left; right < matrix.layers.length; right += 1) {
      world.set_layer_interaction(matrix.layers[left].bits, matrix.layers[right].bits, true);
    }
  }
}

function packAabbs(bodies: BodySnapshot[]) {
  const packed = new Float32Array(bodies.length * 8);
  bodies.forEach((body, index) => {
    const offset = index * 8;
    packed[offset] = body.min[0];
    packed[offset + 1] = body.min[1];
    packed[offset + 2] = body.min[2];
    packed[offset + 3] = 0;
    packed[offset + 4] = body.max[0];
    packed[offset + 5] = body.max[1];
    packed[offset + 6] = body.max[2];
    packed[offset + 7] = 0;
  });
  return packed;
}

function pairBitset(snapshot: Snapshot) {
  const bits = new Uint32Array(Math.ceil(snapshot.possiblePairs / 32));
  const indices = new Map(snapshot.bodies.map((body, index) => [body.id, index]));
  for (const [leftId, rightId] of snapshot.pairs) {
    const leftIndex = indices.get(leftId);
    const rightIndex = indices.get(rightId);
    if (leftIndex == null || rightIndex == null) {
      throw new Error(`Rust returned a pair for an unknown body: ${leftId}, ${rightId}.`);
    }
    const left = Math.min(leftIndex, rightIndex);
    const right = Math.max(leftIndex, rightIndex);
    const index = pairIndex(left, right, snapshot.bodies.length);
    const word = Math.floor(index / 32);
    const bit = index % 32;
    bits[word] |= (1 << bit) >>> 0;
  }
  return bits;
}

function pairIndex(left: number, right: number, count: number) {
  return (left * (2 * count - left - 1)) / 2 + (right - left - 1);
}

function bitsetsEqual(left: Uint32Array, right: Uint32Array) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function medianByTotal<T extends { totalMs: number }>(values: T[]) {
  return [...values].sort((left, right) => left.totalMs - right.totalMs)[
    Math.floor(values.length / 2)
  ];
}

function omitNaiveBitset(measurement: WebGpuNaiveMeasurement): GpuNaiveSummary {
  const { bitset: _bitset, ...summary } = measurement;
  return summary;
}

function omitGridBitset(measurement: WebGpuGridMeasurement): GpuGridSummary {
  const { bitset: _bitset, ...summary } = measurement;
  return summary;
}

function fastestBackend(row: ComputeRow) {
  const candidates = [
    { label: "CPU naive", ms: row.cpuNaiveMs },
    { label: "CPU grid", ms: row.cpuGridMs },
  ];
  if (row.naiveParity === true && row.gpuNaive) {
    candidates.push({ label: "WebGPU naive", ms: row.gpuNaive.totalMs });
  }
  if (row.gridPairParity === true && row.gridWorkParity === true && row.gpuGrid) {
    candidates.push({ label: "WebGPU grid", ms: row.gpuGrid.totalMs });
  }
  return candidates.reduce((best, candidate) => (candidate.ms < best.ms ? candidate : best));
}

function verificationStatus(values: (boolean | null)[], progress: number, unavailable: boolean) {
  if (values.some((value) => value === false)) return "failed";
  if (values.some((value) => value === true)) return "passing";
  if (progress === COUNTS.length && unavailable) return "unavailable";
  return "pending";
}

function TimingChart({ rows }: { rows: ComputeRow[] }) {
  const width = 900;
  const height = 380;
  const left = 72;
  const right = 24;
  const top = 24;
  const bottom = 52;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const values = rows
    .flatMap((row) => [
      row.cpuNaiveMs,
      row.cpuGridMs,
      row.gpuNaive?.totalMs ?? 0,
      row.gpuGrid?.totalMs ?? 0,
    ])
    .filter((value) => value > 0);
  const maxMs = Math.max(1, ...values);
  const minMs = Math.max(0.001, Math.min(...values, 0.01));
  const minLog = Math.log10(minMs);
  const maxLog = Math.max(minLog + 1, Math.log10(maxMs));
  const x = (index: number) =>
    left + (rows.length <= 1 ? plotWidth / 2 : (index / (rows.length - 1)) * plotWidth);
  const y = (value: number) => {
    const log = Math.log10(Math.max(minMs, value));
    return top + plotHeight * (1 - (log - minLog) / (maxLog - minLog));
  };
  const series = [
    {
      key: "cpu-naive",
      label: "CPU/WASM naive",
      stroke: "#a1a1aa",
      value: (row: ComputeRow) => row.cpuNaiveMs,
    },
    {
      key: "gpu-naive",
      label: "WebGPU naive",
      stroke: "#22d3ee",
      value: (row: ComputeRow) => row.gpuNaive?.totalMs ?? null,
    },
    {
      key: "cpu-grid",
      label: "CPU/WASM grid",
      stroke: "#f59e0b",
      value: (row: ComputeRow) => row.cpuGridMs,
    },
    {
      key: "gpu-grid",
      label: "WebGPU grid",
      stroke: "#34d399",
      value: (row: ComputeRow) => row.gpuGrid?.totalMs ?? null,
    },
  ] as const;

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-4 text-xs text-zinc-500">
        {series.map((entry) => (
          <span key={entry.key} className="inline-flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.stroke }} />
            {entry.label}
          </span>
        ))}
      </div>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="CPU and WebGPU naive and uniform-grid timing by object count"
          className="min-w-[44rem] w-full"
        >
          <rect
            x={left}
            y={top}
            width={plotWidth}
            height={plotHeight}
            rx="12"
            fill="#09090b"
            stroke="#27272a"
          />
          {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
            const value = Math.pow(10, minLog + (maxLog - minLog) * fraction);
            const lineY = top + plotHeight * (1 - fraction);
            return (
              <g key={fraction}>
                <line x1={left} x2={width - right} y1={lineY} y2={lineY} stroke="#27272a" />
                <text x={left - 10} y={lineY + 4} textAnchor="end" fill="#71717a" fontSize="11">
                  {formatAxisMs(value)}
                </text>
              </g>
            );
          })}
          {rows.map((row, index) => (
            <text
              key={row.objects}
              x={x(index)}
              y={height - 20}
              textAnchor="middle"
              fill="#71717a"
              fontSize="12"
            >
              {formatCount(row.objects)}
            </text>
          ))}
          <text
            x={16}
            y={height / 2}
            transform={`rotate(-90 16 ${height / 2})`}
            textAnchor="middle"
            fill="#71717a"
            fontSize="12"
          >
            milliseconds · log scale
          </text>
          {series.map((entry) => {
            const points = rows
              .map((row, index) => {
                const value = entry.value(row);
                return value == null ? null : `${x(index)},${y(value)}`;
              })
              .filter((point): point is string => point != null)
              .join(" ");
            return (
              <g key={entry.key}>
                {points.split(" ").filter(Boolean).length > 1 && (
                  <polyline points={points} fill="none" stroke={entry.stroke} strokeWidth="2.5" />
                )}
                {rows.map((row, index) => {
                  const value = entry.value(row);
                  return value == null ? null : (
                    <circle key={row.objects} cx={x(index)} cy={y(value)} r="4" fill={entry.stroke} />
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function ParityLabel({ value }: { value: boolean | null }) {
  if (value == null) return <span className="text-zinc-600">—</span>;
  return value ? (
    <span className="font-semibold text-emerald-300">exact</span>
  ) : (
    <span className="font-semibold text-red-300">mismatch</span>
  );
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/35 p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-zinc-600">{label}</div>
      <div className="mt-2 text-lg font-semibold text-zinc-100">{value}</div>
      <p className="mt-2 text-xs leading-5 text-zinc-600">{detail}</p>
    </div>
  );
}

function ComputeNote({ title, copy }: { title: string; copy: string }) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5">
      <h3 className="font-semibold text-zinc-200">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-zinc-500">{copy}</p>
    </div>
  );
}

function formatSetup(
  naive: { setupMs: number } | null,
  grid: { setupMs: number } | null,
  unavailable: string | null,
) {
  if (unavailable) return "unavailable";
  if (!naive) return "initializing";
  if (!grid) return `${formatMs(naive.setupMs)} + grid pending`;
  return formatMs(naive.setupMs + grid.setupMs);
}

function formatRatio(ratio: number) {
  if (!Number.isFinite(ratio)) return "—";
  if (ratio >= 1) return `${ratio.toFixed(ratio >= 10 ? 1 : 2)}× faster`;
  return `${(1 / ratio).toFixed(2)}× slower`;
}

function formatPercent(value: number) {
  return `${(Math.max(0, Math.min(1, value)) * 100).toFixed(1)}%`;
}

function formatMs(value: number) {
  if (value < 0.1) return `${value.toFixed(3)} ms`;
  if (value < 10) return `${value.toFixed(2)} ms`;
  return `${value.toFixed(1)} ms`;
}

function formatAxisMs(value: number) {
  if (value < 0.01) return `${(value * 1000).toFixed(1)}µs`;
  if (value < 1) return `${value.toFixed(2)}ms`;
  if (value < 10) return `${value.toFixed(1)}ms`;
  return `${Math.round(value)}ms`;
}

function formatCount(value: number) {
  return value >= 1000 ? `${value / 1000}k` : String(value);
}
