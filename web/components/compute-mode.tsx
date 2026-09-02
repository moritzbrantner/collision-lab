"use client";

import { useEffect, useMemo, useState } from "react";

import initWasm, { DemoWorld } from "../lib/wasm-pkg/collision_wasm";
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
    spatialOverlaps: number;
  };
};

type InteractionMatrix = {
  layers: { bits: number }[];
};

type GpuMeasurement = Omit<WebGpuNaiveMeasurement, "bitset">;

type ComputeRow = {
  objects: number;
  possiblePairs: number;
  overlaps: number;
  cpuMs: number;
  gpu: GpuMeasurement | null;
  parity: boolean | null;
};

const COUNTS = [100, 250, 500, 1000, 2500, 5000] as const;
const SAMPLES = 3;

export function ComputeMode() {
  const [scenario, setScenario] = useState<Scenario>("uniform");
  const [rows, setRows] = useState<ComputeRow[]>([]);
  const [progress, setProgress] = useState(0);
  const [gpuSetup, setGpuSetup] = useState<{ setupMs: number; timestampSupported: boolean } | null>(null);
  const [gpuUnavailable, setGpuUnavailable] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let runner: WebGpuNaiveRunner | null = null;

    const run = async () => {
      setRows([]);
      setProgress(0);
      setGpuSetup(null);
      setGpuUnavailable(null);
      setError(null);

      try {
        await initWasm();
        try {
          runner = await createWebGpuNaiveRunner();
          if (!cancelled) {
            setGpuSetup({ setupMs: runner.setupMs, timestampSupported: runner.timestampSupported });
          }
        } catch (reason) {
          if (!cancelled) setGpuUnavailable(String(reason));
        }

        const nextRows: ComputeRow[] = [];
        for (let index = 0; index < COUNTS.length; index += 1) {
          if (cancelled) return;
          const objects = COUNTS[index];
          const worldExtent = 12 * Math.cbrt(objects / COUNTS[0]);
          const world = new DemoWorld(
            scenario,
            objects,
            4,
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

            const cpuSamples: number[] = [];
            let snapshot: Snapshot | null = null;
            for (let sample = 0; sample < SAMPLES; sample += 1) {
              const started = performance.now();
              snapshot = JSON.parse(world.snapshot_json("naive")) as Snapshot;
              cpuSamples.push(performance.now() - started);
            }
            if (!snapshot) throw new Error("Rust/WASM did not produce a benchmark snapshot.");

            const oracleBitset = pairBitset(snapshot);
            const aabbs = packAabbs(snapshot.bodies);
            const gpuSamples: WebGpuNaiveMeasurement[] = [];
            let parity: boolean | null = null;

            if (runner) {
              for (let sample = 0; sample < SAMPLES; sample += 1) {
                const measurement = await runner.run(aabbs, objects);
                gpuSamples.push(measurement);
                parity = (parity ?? true) && bitsetsEqual(oracleBitset, measurement.bitset);
                if (cancelled) return;
              }
            }

            const gpuMedian = gpuSamples.length > 0 ? medianGpuMeasurement(gpuSamples) : null;
            nextRows.push({
              objects,
              possiblePairs: snapshot.possiblePairs,
              overlaps: snapshot.stats.spatialOverlaps,
              cpuMs: median(cpuSamples),
              gpu: gpuMedian ? omitBitset(gpuMedian) : null,
              parity,
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
        runner?.destroy();
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [scenario]);

  const crossover = useMemo(
    () => rows.find((row) => row.gpu && row.gpu.totalMs < row.cpuMs) ?? null,
    [rows],
  );
  const finalRow = rows.at(-1);
  const allParity = rows.length > 0 && rows.every((row) => row.parity !== false);

  return (
    <div className="space-y-8">
      <section className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-5 sm:p-7">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-600">
              Same algorithm · different machine
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-zinc-100">
              When does massively parallel brute force become worthwhile?
            </h2>
            <p className="mt-3 leading-7 text-zinc-500">
              Both sides run the same naive all-pairs AABB test over the same deterministic Rust-generated scene. The CPU path is Rust compiled to WASM; the GPU path is a WebGPU compute shader. Every GPU result must match the Rust pair set exactly.
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
            label="GPU setup"
            value={gpuSetup ? formatMs(gpuSetup.setupMs) : gpuUnavailable ? "unavailable" : "initializing"}
            detail="Adapter, device, shader compilation, and pipeline creation; excluded from each point."
          />
          <MetricCard
            label="GPU pass timing"
            value={gpuSetup ? (gpuSetup.timestampSupported ? "timestamp query" : "wall clock") : "—"}
            detail="Hardware/driver pass timestamps are used when the adapter exposes timestamp-query."
          />
          <MetricCard
            label="First GPU win"
            value={crossover ? `${crossover.objects.toLocaleString()} objects` : "not yet"}
            detail="First measured point where end-to-end GPU time is below the CPU/WASM host-visible path."
          />
          <MetricCard
            label="Exact parity"
            value={rows.length === 0 ? "pending" : allParity ? "passing" : "failed"}
            detail="A compact bitset represents every overlapping pair, not just the pair count."
          />
        </div>

        {gpuUnavailable && (
          <p className="mt-5 rounded-xl border border-amber-900/50 bg-amber-950/20 p-4 text-sm leading-6 text-amber-200">
            {gpuUnavailable} CPU measurements will still run. Open this page in a WebGPU-capable browser over HTTPS to enable the comparison.
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
            Measuring {progress + 1} of {COUNTS.length} deterministic scenes · median of {SAMPLES} samples per point…
          </p>
        )}
      </section>

      <section className="overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-950/70">
        <div className="border-b border-zinc-800 px-5 py-4 sm:px-7">
          <h2 className="font-semibold text-zinc-100">CPU/WASM vs WebGPU naive all-pairs</h2>
          <p className="mt-1 max-w-4xl text-sm leading-6 text-zinc-500">
            GPU total includes buffer allocation/upload, dispatch, readback, and bit counting. “GPU pass” isolates the compute pass when timestamp queries are supported. Submit→map includes the pass plus queueing, the output copy, and synchronization, so it is not additive with GPU pass.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[72rem] w-full text-left text-sm">
            <thead className="bg-zinc-900/50 text-xs uppercase tracking-wide text-zinc-600">
              <tr>
                <th className="px-5 py-3">Objects</th>
                <th className="px-5 py-3">Possible pairs</th>
                <th className="px-5 py-3">Overlaps</th>
                <th className="px-5 py-3">CPU/WASM</th>
                <th className="px-5 py-3">GPU total</th>
                <th className="px-5 py-3">Prepare/upload</th>
                <th className="px-5 py-3">GPU pass</th>
                <th className="px-5 py-3">Submit→map</th>
                <th className="px-5 py-3">Parity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {rows.map((row) => (
                <tr key={row.objects}>
                  <td className="px-5 py-4 font-mono text-zinc-200">{row.objects.toLocaleString()}</td>
                  <td className="px-5 py-4 font-mono text-zinc-400">{row.possiblePairs.toLocaleString()}</td>
                  <td className="px-5 py-4 font-mono text-zinc-400">{row.overlaps.toLocaleString()}</td>
                  <td className="px-5 py-4 font-mono text-zinc-200">{formatMs(row.cpuMs)}</td>
                  <td className="px-5 py-4 font-mono text-zinc-200">{row.gpu ? formatMs(row.gpu.totalMs) : "—"}</td>
                  <td className="px-5 py-4 font-mono text-zinc-400">{row.gpu ? formatMs(row.gpu.prepareUploadMs) : "—"}</td>
                  <td className="px-5 py-4 font-mono text-zinc-400">{row.gpu?.computeMs == null ? "—" : formatMs(row.gpu.computeMs)}</td>
                  <td className="px-5 py-4 font-mono text-zinc-400">{row.gpu ? formatMs(row.gpu.submitReadbackMs) : "—"}</td>
                  <td className="px-5 py-4">
                    {row.parity == null ? (
                      <span className="text-zinc-600">—</span>
                    ) : row.parity ? (
                      <span className="font-semibold text-emerald-300">exact</span>
                    ) : (
                      <span className="font-semibold text-red-300">mismatch</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <ComputeNote
          title="Algorithm and execution backend are separate choices"
          copy="Naive, grid, sweep, BVH, and octree describe how collision work is organized. CPU/WASM and WebGPU describe where that work executes. This page intentionally holds the algorithm constant first."
        />
        <ComputeNote
          title="End-to-end matters"
          copy="A fast shader can still lose once buffer preparation, queueing, synchronization, and readback are included. That is why the chart keeps GPU pass time and host-visible total time separate."
        />
        <ComputeNote
          title="Next comparison: uniform grid"
          copy={
            finalRow?.gpu
              ? `At ${finalRow.objects.toLocaleString()} objects the measured GPU/CPU total-time ratio is ${(finalRow.gpu.totalMs / finalRow.cpuMs).toFixed(2)}×. The next useful experiment is CPU grid vs GPU grid so hardware and algorithmic gains can be separated.`
              : "The next useful experiment is CPU grid vs GPU grid so hardware and algorithmic gains can be separated."
          }
        />
      </section>

      <section className="rounded-3xl border border-zinc-800 bg-zinc-900/25 p-5 sm:p-7">
        <h2 className="text-lg font-semibold text-zinc-100">Measurement contract</h2>
        <div className="mt-4 grid gap-4 text-sm leading-6 text-zinc-500 md:grid-cols-2">
          <p>
            Scene generation stays in Rust and uses seed 42. World volume grows with object count so average density stays roughly constant. Before timing, every collision-layer combination is enabled so the Rust naive pair list is the complete AABB-overlap oracle.
          </p>
          <p>
            The CPU number is the median wall-clock cost of the current host-visible Rust/WASM snapshot path, including result serialization and parsing. It is deliberately labeled as such rather than pretending to be a kernel-only timer. GPU timestamp queries, when available, provide the narrower compute-pass number.
          </p>
        </div>
      </section>
    </div>
  );
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

function medianGpuMeasurement(values: WebGpuNaiveMeasurement[]) {
  return [...values].sort((left, right) => left.totalMs - right.totalMs)[Math.floor(values.length / 2)];
}

function omitBitset(measurement: WebGpuNaiveMeasurement): GpuMeasurement {
  return {
    overlaps: measurement.overlaps,
    prepareUploadMs: measurement.prepareUploadMs,
    computeMs: measurement.computeMs,
    submitReadbackMs: measurement.submitReadbackMs,
    decodeMs: measurement.decodeMs,
    totalMs: measurement.totalMs,
  };
}

function TimingChart({ rows }: { rows: ComputeRow[] }) {
  const width = 900;
  const height = 360;
  const left = 72;
  const right = 24;
  const top = 24;
  const bottom = 52;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const values = rows.flatMap((row) => [
    row.cpuMs,
    row.gpu?.totalMs ?? 0,
    row.gpu?.computeMs ?? 0,
  ]).filter((value) => value > 0);
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
    { key: "cpu", label: "CPU/WASM total", stroke: "#a1a1aa", value: (row: ComputeRow) => row.cpuMs },
    { key: "gpu", label: "WebGPU total", stroke: "#22d3ee", value: (row: ComputeRow) => row.gpu?.totalMs ?? null },
    { key: "compute", label: "GPU pass", stroke: "#34d399", value: (row: ComputeRow) => row.gpu?.computeMs ?? null },
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
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="CPU and WebGPU naive all-pairs timing by object count" className="min-w-[44rem] w-full">
          <rect x={left} y={top} width={plotWidth} height={plotHeight} rx="12" fill="#09090b" stroke="#27272a" />
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
            <text key={row.objects} x={x(index)} y={height - 20} textAnchor="middle" fill="#71717a" fontSize="12">
              {formatCount(row.objects)}
            </text>
          ))}
          <text x={16} y={height / 2} transform={`rotate(-90 16 ${height / 2})`} textAnchor="middle" fill="#71717a" fontSize="12">
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
