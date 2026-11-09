"use client";

import { useEffect, useRef, useState } from "react";

import initWasm, { AuthoredMeshBvhLesson } from "../lib/wasm-pkg/collision_wasm";

type Mode = "ray" | "segment" | "capsule";
type Bounds = { min: [number, number, number]; max: [number, number, number] };
type Witness = {
  triangle: number;
  chunk: number;
  localTriangle: number;
  fraction: number;
  surfacePoint: [number, number, number];
  normal: [number, number, number] | null;
  queryPosition: [number, number, number];
};
type Step = {
  node: number;
  depth: number;
  kind: "descend" | "rejected" | "candidate";
  bounds: Bounds;
  triangle: number | null;
  source: { chunk: number; triangle: number } | null;
};
type Counts = {
  bruteTriangleTests: number;
  bvhNodesVisited: number;
  bvhTrianglesTested: number;
  sweepIterations: number;
  retainedBuilds: number;
};
type Preparation = {
  replicas: number;
  triangles: number;
  nodes: number;
  retainedBytes: number;
  builds: number;
  sourceChunks: number;
};
type Query = {
  mode: Mode;
  origin: [number, number, number];
  end: [number, number, number];
  accelerated: Witness | null;
  reference: Witness | null;
  parity: boolean;
  counts: Counts;
  preparation: Preparation;
  trace: Step[];
  traceKind: "validated-hierarchy-reconstruction" | "kernel-counts-only";
};
type Scale = {
  preparation: Preparation;
  counts: Counts;
  parity: boolean;
};
type Scales = {
  source: string;
  sourceCommit: string;
  referenceImplementation: string;
  kernel: string;
  description: string;
  scales: Scale[];
};

const MODES: { id: Mode; label: string }[] = [
  { id: "ray", label: "Long downward ray" },
  { id: "segment", label: "Short segment" },
  { id: "capsule", label: "Capsule sweep" },
];

function metre(value: number) {
  return `${value.toFixed(2)} m`;
}

function indexDescription(witness: Witness | null) {
  return witness
    ? `chunk ${witness.chunk}, triangle ${witness.localTriangle} (flattened ID ${witness.triangle}) at t=${witness.fraction.toFixed(4)} · contact (${witness.surfacePoint.map((n) => n.toFixed(2)).join(", ")}) m`
    : "No hit — open space stays open";
}

/** An X/Y projection of the Rust trace; geometry never decides collision in the browser. */
function TraceProjection({ query, step }: { query: Query; step: Step | null }) {
  const x = (metres: number) => 70 + (metres - 45) * 16;
  const y = (metres: number) => 238 - metres * 12;
  const bounds = step?.bounds;
  const box = bounds && {
    x: x(Math.max(45, bounds.min[0])),
    y: y(Math.min(18, bounds.max[1])),
    width: Math.max(0, x(Math.min(85, bounds.max[0])) - x(Math.max(45, bounds.min[0]))),
    height: Math.max(0, y(Math.max(0, bounds.min[1])) - y(Math.min(18, bounds.max[1]))),
  };
  const hit = query.accelerated?.queryPosition;

  return (
    <svg viewBox="0 0 780 275" role="img" aria-label="Side projection of the authored cave with the vertical query and selected BVH node" className="h-auto w-full rounded-xl border border-zinc-800 bg-zinc-950">
      <defs>
        <pattern id="mesh-bvh-grid" width="80" height="60" patternUnits="userSpaceOnUse">
          <path d="M 80 0 L 0 0 0 60" fill="none" stroke="#27272a" strokeWidth="1" />
        </pattern>
      </defs>
      <rect x="70" y="22" width="640" height="216" fill="url(#mesh-bvh-grid)" />
      <path d={`M ${x(45)} ${y(11)} H ${x(85)}`} stroke="#64748b" strokeWidth="2" strokeDasharray="4 5" />
      <path d={`M ${x(45)} ${y(15.5)} H ${x(85)}`} stroke="#52525b" strokeWidth="2" strokeDasharray="3 7" />
      <rect x={x(48)} y={y(11)} width={x(68) - x(48)} height="8" fill="#0e7490" fillOpacity="0.45" stroke="#22d3ee" />
      <rect x={x(44)} y={y(15.5)} width={x(84) - x(44)} height="7" fill="#71717a" fillOpacity="0.45" stroke="#a1a1aa" />
      <text x={x(48)} y={y(11) + 23} fill="#67e8f9" fontSize="11">Authored entrance floor · chunk 640</text>
      <text x={x(48)} y={y(15.5) - 8} fill="#a1a1aa" fontSize="11">Roof · chunk 547</text>
      {box && box.width > 0 && box.height > 0 && (
        <rect x={box.x} y={box.y} width={box.width} height={box.height} fill={step?.kind === "rejected" ? "#f97316" : "#a78bfa"} fillOpacity="0.14" stroke={step?.kind === "rejected" ? "#fb923c" : "#a78bfa"} strokeWidth="2" strokeDasharray="5 3" />
      )}
      <path d={`M ${x(query.origin[0])} ${y(query.origin[1])} L ${x(query.end[0])} ${y(query.end[1])}`} stroke="#facc15" strokeWidth="3" strokeLinecap="round" />
      <circle cx={x(query.origin[0])} cy={y(query.origin[1])} r="5" fill="#facc15" />
      {hit && <circle cx={x(hit[0])} cy={y(hit[1])} r="6" fill="#4ade80" stroke="#052e16" strokeWidth="2" />}
      {[45, 55, 65, 75, 85].map((value) => (
        <text key={value} x={x(value)} y="259" textAnchor="middle" fill="#71717a" fontSize="12">{value} m</text>
      ))}
      {[0, 5, 10, 15].map((value) => (
        <text key={value} x="54" y={y(value) + 4} textAnchor="end" fill="#71717a" fontSize="12">{value}</text>
      ))}
    </svg>
  );
}

export function AuthoredMeshBvhLessonPanel() {
  const engine = useRef<AuthoredMeshBvhLesson | null>(null);
  const [x, setX] = useState(62);
  const [mode, setMode] = useState<Mode>("segment");
  const [query, setQuery] = useState<Query | null>(null);
  const [scales, setScales] = useState<Scales | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void initWasm().then(() => {
      if (!active) return;
      const instance = new AuthoredMeshBvhLesson();
      engine.current = instance;
      setScales(JSON.parse(instance.scale_json()) as Scales);
      setQuery(JSON.parse(instance.query_json(x, mode)) as Query);
    }).catch((reason: unknown) => {
      if (active) setError(String(reason));
    });
    return () => {
      active = false;
      engine.current?.free();
      engine.current = null;
    };
    // The WASM instance is retained; inputs update it in the next effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!engine.current) return;
    try {
      setQuery(JSON.parse(engine.current.query_json(x, mode)) as Query);
      setStepIndex(0);
    } catch (reason) {
      setError(String(reason));
    }
  }, [x, mode]);

  if (error) return <p role="alert" className="rounded-xl border border-red-900 p-5 text-red-300">Authored mesh evidence unavailable: {error}</p>;
  if (!query || !scales) return <p className="rounded-xl border border-zinc-800 p-5 text-zinc-400">Preparing the authored triangle BVH in Rust/WASM…</p>;

  const step = query.trace[Math.min(stepIndex, query.trace.length - 1)] ?? null;
  return (
    <section data-testid="authored-mesh-bvh-lesson" className="space-y-6 rounded-3xl border border-zinc-800 bg-zinc-900/30 p-5 sm:p-7">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-400">Retained static geometry · Source-derived case study</p>
          <h3 className="mt-2 text-2xl font-semibold text-zinc-100">Brute force versus a triangle BVH</h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">The Redbrand cave fixture has 14 authored chunks and 168 triangles. The teaching adapter flattens them into one mesh so one retained kernel BVH can be inspected; Physics Engine itself keeps the chunks as separate fixed bodies.</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${query.parity ? "bg-emerald-950 text-emerald-300" : "bg-red-950 text-red-300"}`}>
          {query.parity ? "Reference parity verified" : "Reference parity failed"}
        </span>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Mesh query type">
        {MODES.map((entry) => (
          <button key={entry.id} type="button" aria-pressed={mode === entry.id} onClick={() => setMode(entry.id)} className={`rounded-lg border px-3 py-2 text-sm ${mode === entry.id ? "border-cyan-500 bg-cyan-950/50 text-cyan-200" : "border-zinc-700 text-zinc-400 hover:text-zinc-100"}`}>
            {entry.label}
          </button>
        ))}
      </div>
      <label className="block max-w-xl text-sm text-zinc-300" htmlFor="mesh-origin-x">
        <span className="flex justify-between"><span>Move the query origin along the cave</span><span className="font-mono text-cyan-200">x = {metre(x)}</span></span>
        <input id="mesh-origin-x" className="mt-3 w-full accent-cyan-400" type="range" min="45" max="85" step="0.5" value={x} onChange={(event) => setX(Number(event.target.value))} />
      </label>

      <TraceProjection query={query} step={step} />
      <p className="text-xs leading-5 text-zinc-500">Side projection at z = −138 m. Cyan marks a representative authored entrance floor; grey marks the roof. Yellow is the query trajectory; green is the reported query position at impact (capsule centre for sweeps). Purple/orange boxes show the current reconstructed BVH node/rejection, not collision geometry.</p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["All-triangle reference", `${query.counts.bruteTriangleTests} tests`],
          ["Retained BVH leaves", `${query.counts.bvhTrianglesTested} tests`],
          ["BVH nodes visited", `${query.counts.bvhNodesVisited}`],
          ["Build retained", `${(query.preparation.retainedBytes / 1024).toFixed(1)} KiB · once`],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4">
            <p className="text-xs text-zinc-500">{label}</p>
            <p className="mt-2 font-mono text-xl text-zinc-100">{value}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-zinc-800 p-4">
          <h4 className="text-sm font-semibold text-zinc-100">Exhaustive reference</h4>
          <p className="mt-2 font-mono text-xs leading-6 text-zinc-400">{indexDescription(query.reference)}</p>
          <p className="mt-2 text-xs text-zinc-500">{mode === "capsule" ? "One temporary single-triangle kernel sweep per triangle." : "Every original triangle tested with the shared exact segment–triangle kernel."}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 p-4">
          <h4 className="text-sm font-semibold text-zinc-100">Retained mesh BVH</h4>
          <p className="mt-2 font-mono text-xs leading-6 text-zinc-400">{indexDescription(query.accelerated)}</p>
          <p className="mt-2 text-xs text-zinc-500">Stable ID = original input order, not the hierarchy leaf position. {mode === "capsule" ? `${query.counts.sweepIterations} kernel sweep iterations.` : "Node/leaf trace counters verified against the kernel."}</p>
        </div>
      </div>

      {step ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-widest text-zinc-500">Traversal step {stepIndex + 1} / {query.trace.length}</p>
              <p className="mt-1 text-sm text-zinc-200">Node {step.node} · depth {step.depth} · <span className={step.kind === "rejected" ? "text-orange-300" : "text-violet-300"}>{step.kind}</span>{step.source ? ` · chunk ${step.source.chunk} triangle ${step.source.triangle}` : ""}</p>
            </div>
            <div className="flex gap-2">
              <button type="button" disabled={stepIndex === 0} onClick={() => setStepIndex((i) => Math.max(0, i - 1))} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 disabled:opacity-30">Previous</button>
              <button type="button" disabled={stepIndex >= query.trace.length - 1} onClick={() => setStepIndex((i) => Math.min(query.trace.length - 1, i + 1))} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 disabled:opacity-30">Next</button>
            </div>
          </div>
          <p className="mt-2 text-xs leading-5 text-zinc-500">{step.kind === "rejected" ? "The query's AABB misses this node; every descendant triangle is skipped." : step.kind === "candidate" ? "The leaf bound overlaps. The exact shared triangle test now decides whether there is a hit." : "The query overlaps this parent; visit both children in deterministic left-first order."}</p>
        </div>
      ) : (
        <p className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 text-sm text-zinc-400">Capsule sweeps revisit hierarchy bounds as the swept segment advances. The unmodified kernel exposes aggregate node/triangle/sweep work, but no per-iteration node trace; this view does not invent one.</p>
      )}

      <div className="overflow-x-auto">
        <h4 className="mb-3 text-base font-semibold text-zinc-100">Deterministic work as authored geometry grows</h4>
        <table className="w-full min-w-[530px] text-left text-sm">
          <thead className="border-b border-zinc-800 text-zinc-500"><tr><th className="pb-2">Copied chunks</th><th className="pb-2">Triangles</th><th className="pb-2">Brute tests</th><th className="pb-2">BVH tests</th><th className="pb-2">BVH visits</th><th className="pb-2">Retained bytes</th></tr></thead>
          <tbody>{scales.scales.map((row) => (
            <tr key={row.preparation.replicas} className="border-b border-zinc-800/70 font-mono text-zinc-300"><td className="py-3">{row.preparation.sourceChunks}</td><td>{row.preparation.triangles}</td><td>{row.counts.bruteTriangleTests}</td><td>{row.counts.bvhTrianglesTested}</td><td>{row.counts.bvhNodesVisited}</td><td>{row.preparation.retainedBytes.toLocaleString()}</td></tr>
          ))}</tbody>
        </table>
        <p className="mt-3 text-xs leading-5 text-zinc-500">Each scale is prepared exactly once and queried at the same origin. Copies are spatially separated teaching inputs; these are exact kernel work counts, not FPS or wall-clock timings. Preparation costs {query.preparation.nodes} retained nodes at the base scale and is amortized across future queries.</p>
      </div>

      <div className="grid gap-4 text-sm leading-6 text-zinc-400 md:grid-cols-2">
        <p><strong className="text-zinc-200">When it helps.</strong> Immutable, detailed terrain and cave collision where many rays, character probes, or capsule sweeps reuse geometry. The hierarchy discards broad groups before the exact test.</p>
        <p><strong className="text-zinc-200">Limitations.</strong> A build and retained-memory cost; large overlapping triangles and very broad queries prune poorly. This is static-geometry acceleration, not moving-body CCD, solver stability, or frame-time proof.</p>
      </div>
      <p className="text-xs leading-5 text-zinc-500">Source: <a className="text-cyan-300 underline" href="https://github.com/moritzbrantner/physics-engine/pull/493" target="_blank" rel="noreferrer">Physics Engine PR #493</a> · authored Redbrand cave fixture from MMORPG 9ccc3a57 · shared <code>geometry-kernels::triangle_mesh</code> at Collision Lab&apos;s pinned revision. The step sequence is a Rust reconstruction of its median-split traversal, checked against its node/leaf counters, not a direct dump of private kernel nodes. The capsule work comes directly from the kernel, without a step trace.</p>
    </section>
  );
}
