"use client";

import { useEffect, useMemo, useState } from "react";

import initWasm, {
  preset_analysis_json,
  preset_catalog_json,
} from "../lib/wasm-pkg/collision_wasm";

type AlgorithmId =
  | "naive"
  | "uniform-grid"
  | "octree"
  | "sweep-and-prune"
  | "static-bvh"
  | "dynamic-aabb-tree";

type PresetConfig = {
  objects: number;
  scenario: "uniform" | "clustered";
  cellSize: number;
  fatMargin: number;
  seed: number;
  worldExtent: number;
  halfExtent: number;
  dynamicFraction: number;
  speed: number;
  sensorFraction: number;
};

type PresetMeta = {
  id: string;
  title: string;
  description: string;
  config: PresetConfig;
};

type Measurement = {
  algorithm: AlgorithmId;
  aabbTests: number;
  overlaps: number;
  reduction: number;
  pairParity: boolean;
};

type PresetAnalysis = {
  preset: PresetMeta;
  possiblePairs: number;
  overlaps: number;
  pairParity: boolean;
  measurements: Measurement[];
};

const OBJECT_COUNTS = [100, 250, 500] as const;
const ALGORITHMS: { id: AlgorithmId; label: string }[] = [
  { id: "naive", label: "Naive" },
  { id: "uniform-grid", label: "Grid" },
  { id: "octree", label: "Octree" },
  { id: "sweep-and-prune", label: "Sweep" },
  { id: "static-bvh", label: "Static BVH" },
  { id: "dynamic-aabb-tree", label: "Dynamic tree" },
];

export function PresetAnalysis() {
  const [objects, setObjects] = useState<(typeof OBJECT_COUNTS)[number]>(250);
  const [catalog, setCatalog] = useState<PresetMeta[]>([]);
  const [rows, setRows] = useState<PresetAnalysis[]>([]);
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
        const nextCatalog = JSON.parse(preset_catalog_json(objects)) as PresetMeta[];
        if (cancelled) return;
        setCatalog(nextCatalog);

        const nextRows: PresetAnalysis[] = [];
        for (let index = 0; index < nextCatalog.length; index += 1) {
          if (cancelled) return;
          const result = JSON.parse(
            preset_analysis_json(nextCatalog[index].id, objects),
          ) as PresetAnalysis;
          nextRows.push(result);
          setRows([...nextRows]);
          setProgress(index + 1);
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
  }, [objects]);

  const everythingOverlaps = rows.find((row) => row.preset.id === "everything-overlaps");
  const badGrid = rows.find((row) => row.preset.id === "bad-grid");
  const worstCaseExact = useMemo(() => {
    if (!everythingOverlaps) return false;
    return everythingOverlaps.measurements.every(
      (measurement) => measurement.aabbTests === everythingOverlaps.possiblePairs,
    );
  }, [everythingOverlaps]);

  return (
    <section className="overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-950/70">
      <div className="border-b border-zinc-800 p-5 sm:p-7">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-600">
              Named deterministic workloads
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-zinc-100">
              Change the structure of the problem, not just the object count.
            </h2>
            <p className="mt-3 leading-7 text-zinc-500">
              These recipes are defined in Rust. The browser asks for a name such as <code className="text-zinc-300">bad-grid</code> or <code className="text-zinc-300">everything-overlaps</code>; Rust chooses the world extent, distribution, collider size, cell size, seed, and other parameters, then measures every broad phase without serializing its pair list.
            </p>
          </div>
          <label className="text-xs font-semibold text-zinc-400">
            Objects per workload
            <select
              value={objects}
              onChange={(event) => setObjects(Number(event.target.value) as (typeof OBJECT_COUNTS)[number])}
              className="mt-2 block rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
            >
              {OBJECT_COUNTS.map((count) => (
                <option key={count} value={count}>{count.toLocaleString()}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {error && (
        <div className="m-5 rounded-xl border border-red-900/60 bg-red-950/30 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {!error && progress < catalog.length && (
        <div className="border-b border-zinc-800 px-5 py-3 text-sm text-zinc-500 sm:px-7">
          Measuring Rust workload {progress + 1} of {catalog.length}…
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-[72rem] w-full text-left text-sm">
          <thead className="bg-zinc-900/50 text-xs uppercase tracking-wide text-zinc-600">
            <tr>
              <th className="px-5 py-3">Workload</th>
              <th className="px-5 py-3">Rust configuration</th>
              {ALGORITHMS.map((algorithm) => (
                <th key={algorithm.id} className="px-4 py-3">{algorithm.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {rows.map((row) => {
              const byAlgorithm = new Map(
                row.measurements.map((measurement) => [measurement.algorithm, measurement]),
              );
              return (
                <tr key={row.preset.id} className="align-top">
                  <td className="w-[18rem] px-5 py-5">
                    <div className="font-semibold text-zinc-200">{row.preset.title}</div>
                    <div className="mt-1 font-mono text-[11px] text-zinc-600">{row.preset.id}</div>
                    <p className="mt-2 text-xs leading-5 text-zinc-500">{row.preset.description}</p>
                    <div className={`mt-3 text-[11px] font-semibold ${row.pairParity ? "text-emerald-400" : "text-red-400"}`}>
                      {row.pairParity ? "exact pair parity" : "PAIR MISMATCH"}
                    </div>
                  </td>
                  <td className="w-[18rem] px-5 py-5 font-mono text-xs leading-6 text-zinc-500">
                    <div>{row.preset.config.scenario} · seed {row.preset.config.seed}</div>
                    <div>world ±{row.preset.config.worldExtent.toFixed(2)}</div>
                    <div>half extent {row.preset.config.halfExtent.toFixed(2)}</div>
                    <div>grid cell {row.preset.config.cellSize.toFixed(2)}</div>
                    <div>{row.overlaps.toLocaleString()} overlaps / {row.possiblePairs.toLocaleString()} possible</div>
                  </td>
                  {ALGORITHMS.map((algorithm) => {
                    const measurement = byAlgorithm.get(algorithm.id);
                    return (
                      <td key={algorithm.id} className="px-4 py-5">
                        {measurement ? (
                          <>
                            <div className="font-mono text-sm text-zinc-200">
                              {measurement.aabbTests.toLocaleString()}
                            </div>
                            <div className="mt-1 text-[11px] text-zinc-600">
                              {measurement.reduction.toFixed(1)}% avoided
                            </div>
                          </>
                        ) : (
                          <span className="text-zinc-700">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 border-t border-zinc-800 p-5 sm:p-7 md:grid-cols-3">
        <Insight
          title="Bad grid isolates a tuning failure"
          copy={badGrid ? badGridInsight(badGrid) : "Measuring the oversized-cell workload…"}
        />
        <Insight
          title="Worst case is real, not a benchmark trick"
          copy={
            everythingOverlaps
              ? worstCaseExact
                ? `All ${everythingOverlaps.possiblePairs.toLocaleString()} unique pairs are exact overlaps, so every broad phase must ultimately test them. There is nothing spatial to prune.`
                : "The worst-case invariant did not hold; inspect parity before drawing conclusions."
              : "Measuring the all-overlap workload…"
          }
        />
        <Insight
          title="Names are durable contracts"
          copy="Experiment and future benchmark tooling can reuse these same Rust workload names. Changing a recipe later is a deliberate contract change instead of a hidden frontend tweak."
        />
      </div>
    </section>
  );
}

function badGridInsight(row: PresetAnalysis) {
  const grid = row.measurements.find((measurement) => measurement.algorithm === "uniform-grid");
  const baseline = row.measurements.find((measurement) => measurement.algorithm === "naive");
  if (!grid || !baseline || baseline.aabbTests === 0) return "No comparable grid result.";
  const share = (100 * grid.aabbTests) / baseline.aabbTests;
  return `The deliberately oversized cell makes the grid perform ${share.toFixed(1)}% as many exact AABB tests as naive all-pairs in this workload. The algorithm is correct; the spatial partition is simply unhelpful.`;
}

function Insight({ title, copy }: { title: string; copy: string }) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/35 p-5">
      <h3 className="font-semibold text-zinc-200">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-zinc-500">{copy}</p>
    </div>
  );
}
