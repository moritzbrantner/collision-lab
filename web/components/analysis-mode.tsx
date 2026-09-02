"use client";

import { useEffect, useMemo, useState } from "react";

import initWasm, { DemoWorld } from "../lib/wasm-pkg/collision_wasm";

type AlgorithmId =
  | "naive"
  | "uniform-grid"
  | "sweep-and-prune"
  | "static-bvh"
  | "dynamic-aabb-tree";

type Scenario = "uniform" | "clustered";

type Measurement = {
  tests: number;
  overlaps: number;
  reduction: number;
};

type AnalysisRow = {
  objects: number;
  possiblePairs: number;
  measurements: Record<AlgorithmId, Measurement>;
};

type Snapshot = {
  possiblePairs: number;
  stats: {
    aabbTests: number;
    spatialOverlaps: number;
  };
};

const COUNTS = [50, 100, 250, 500, 1000] as const;
const ALGORITHMS: { id: AlgorithmId; label: string; complexity: string; stroke: string }[] = [
  { id: "naive", label: "Naive", complexity: "O(n²)", stroke: "#a1a1aa" },
  { id: "uniform-grid", label: "Uniform grid", complexity: "≈ O(n + k)", stroke: "#22d3ee" },
  { id: "sweep-and-prune", label: "Sweep & prune", complexity: "O(n log n + k)", stroke: "#facc15" },
  { id: "static-bvh", label: "Static BVH", complexity: "hierarchy-dependent", stroke: "#a78bfa" },
  { id: "dynamic-aabb-tree", label: "Dynamic AABB tree", complexity: "update/query-dependent", stroke: "#fb7185" },
];

export function AnalysisMode() {
  const [scenario, setScenario] = useState<Scenario>("uniform");
  const [rows, setRows] = useState<AnalysisRow[]>([]);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setRows([]);
      setProgress(0);
      setError(null);
      try {
        await initWasm();
        const nextRows: AnalysisRow[] = [];

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
          world.set_layer_interaction(1, 1, true);

          const measurements = {} as Record<AlgorithmId, Measurement>;
          let possiblePairs = 0;
          for (const algorithm of ALGORITHMS) {
            const snapshot = JSON.parse(world.snapshot_json(algorithm.id)) as Snapshot;
            possiblePairs = snapshot.possiblePairs;
            measurements[algorithm.id] = {
              tests: snapshot.stats.aabbTests,
              overlaps: snapshot.stats.spatialOverlaps,
              reduction:
                possiblePairs === 0
                  ? 0
                  : 100 * (1 - snapshot.stats.aabbTests / possiblePairs),
            };
          }
          world.free();

          nextRows.push({ objects, possiblePairs, measurements });
          if (!cancelled) {
            setRows([...nextRows]);
            setProgress(index + 1);
          }
          await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
        }
      } catch (reason) {
        if (!cancelled) setError(String(reason));
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [scenario]);

  const finalRow = rows.at(-1);
  const bestAtLargest = useMemo(() => {
    if (!finalRow) return null;
    return ALGORITHMS.filter((algorithm) => algorithm.id !== "naive")
      .map((algorithm) => ({
        algorithm,
        measurement: finalRow.measurements[algorithm.id],
      }))
      .sort((left, right) => left.measurement.tests - right.measurement.tests)[0];
  }, [finalRow]);

  return (
    <div className="space-y-8">
      <section className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-5 sm:p-7">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-600">
              Measured Rust work
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-zinc-100">
              How does broad-phase work scale as the scene grows?
            </h2>
            <p className="mt-3 leading-7 text-zinc-500">
              Each point is computed by the real Rust/WASM implementation. World volume grows with object count so average density stays roughly constant; this isolates algorithm scaling better than squeezing more objects into the same box.
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

        <div className="mt-6 flex flex-wrap gap-3 text-xs text-zinc-500">
          {ALGORITHMS.map((algorithm) => (
            <span key={algorithm.id} className="inline-flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: algorithm.stroke }} />
              {algorithm.label} · {algorithm.complexity}
            </span>
          ))}
        </div>

        <div className="mt-6">
          <ScalingChart rows={rows} />
        </div>

        {progress < COUNTS.length && !error && (
          <p className="mt-4 text-sm text-zinc-500">
            Measuring deterministic scene {progress + 1} of {COUNTS.length}…
          </p>
        )}
        {error && (
          <p className="mt-4 rounded-lg border border-red-900/50 bg-red-950/30 p-3 text-sm text-red-300">
            {error}
          </p>
        )}
      </section>

      <section className="overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-950/70">
        <div className="border-b border-zinc-800 px-5 py-4 sm:px-7">
          <h2 className="font-semibold text-zinc-100">Exact AABB tests</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Lower is better. All algorithms must still return the same overlap pair set.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[58rem] w-full text-left text-sm">
            <thead className="bg-zinc-900/50 text-xs uppercase tracking-wide text-zinc-600">
              <tr>
                <th className="px-5 py-3">Objects</th>
                <th className="px-5 py-3">Possible pairs</th>
                {ALGORITHMS.map((algorithm) => (
                  <th key={algorithm.id} className="px-5 py-3">{algorithm.label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {rows.map((row) => (
                <tr key={row.objects}>
                  <td className="px-5 py-4 font-mono text-zinc-200">{row.objects.toLocaleString()}</td>
                  <td className="px-5 py-4 font-mono text-zinc-400">{row.possiblePairs.toLocaleString()}</td>
                  {ALGORITHMS.map((algorithm) => {
                    const measurement = row.measurements[algorithm.id];
                    return (
                      <td key={algorithm.id} className="px-5 py-4">
                        <div className="font-mono text-zinc-200">{measurement.tests.toLocaleString()}</div>
                        <div className="mt-1 text-xs text-zinc-600">{measurement.reduction.toFixed(2)}% avoided</div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <AnalysisNote
          title="Big-O is not the whole story"
          copy="Uniform grids, sweeps, and trees all exploit different structure. Distribution, object size, temporal coherence, and tuning determine how much work survives before the exact overlap test."
        />
        <AnalysisNote
          title="The oracle stays visible"
          copy="Naive all-pairs is intentionally retained. Its quadratic curve gives every optimization a fixed correctness baseline and makes the amount of avoided work concrete."
        />
        <AnalysisNote
          title="Current largest scene"
          copy={
            bestAtLargest && finalRow
              ? `${bestAtLargest.algorithm.label} performs ${bestAtLargest.measurement.tests.toLocaleString()} exact tests at ${finalRow.objects.toLocaleString()} objects in this ${scenario} workload.`
              : "Measurements are still running."
          }
        />
      </section>
    </div>
  );
}

function ScalingChart({ rows }: { rows: AnalysisRow[] }) {
  const width = 900;
  const height = 360;
  const left = 72;
  const right = 24;
  const top = 24;
  const bottom = 52;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maxTests = Math.max(
    10,
    ...rows.flatMap((row) => ALGORITHMS.map((algorithm) => row.measurements[algorithm.id].tests)),
  );
  const maxLog = Math.log10(maxTests + 1);
  const x = (index: number) =>
    left + (rows.length <= 1 ? plotWidth / 2 : (index / (rows.length - 1)) * plotWidth);
  const y = (value: number) => top + plotHeight * (1 - Math.log10(value + 1) / maxLog);

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Log-scale AABB tests by object count" className="min-w-[44rem] w-full">
        <rect x={left} y={top} width={plotWidth} height={plotHeight} rx="12" fill="#09090b" stroke="#27272a" />
        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
          const value = Math.pow(10, maxLog * fraction) - 1;
          const lineY = top + plotHeight * (1 - fraction);
          return (
            <g key={fraction}>
              <line x1={left} x2={width - right} y1={lineY} y2={lineY} stroke="#27272a" />
              <text x={left - 10} y={lineY + 4} textAnchor="end" fill="#71717a" fontSize="11">
                {formatCompact(value)}
              </text>
            </g>
          );
        })}
        {rows.map((row, index) => (
          <text key={row.objects} x={x(index)} y={height - 20} textAnchor="middle" fill="#71717a" fontSize="12">
            {row.objects}
          </text>
        ))}
        <text x={16} y={height / 2} transform={`rotate(-90 16 ${height / 2})`} textAnchor="middle" fill="#71717a" fontSize="12">
          exact AABB tests · log scale
        </text>
        {ALGORITHMS.map((algorithm) => {
          const points = rows
            .map((row, index) => `${x(index)},${y(row.measurements[algorithm.id].tests)}`)
            .join(" ");
          return (
            <g key={algorithm.id}>
              {rows.length > 1 && <polyline points={points} fill="none" stroke={algorithm.stroke} strokeWidth="2.5" />}
              {rows.map((row, index) => (
                <circle
                  key={row.objects}
                  cx={x(index)}
                  cy={y(row.measurements[algorithm.id].tests)}
                  r="4"
                  fill={algorithm.stroke}
                />
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function AnalysisNote({ title, copy }: { title: string; copy: string }) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5">
      <h3 className="font-semibold text-zinc-200">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-zinc-500">{copy}</p>
    </div>
  );
}

function formatCompact(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return Math.round(value).toString();
}
