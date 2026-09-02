"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import initWasm, { DemoWorld } from "../lib/wasm-pkg/collision_wasm";

type Pair = [number, number];
type Bounds = {
  min: [number, number, number];
  max: [number, number, number];
};
type Body = Bounds & { id: number };
type Snapshot = {
  bodies: Body[];
  pairs: Pair[];
};
type BvhNode = {
  index: number;
  bounds: Bounds;
  depth: number;
  body: number | null;
  left: number | null;
  right: number | null;
  leafCount: number;
  isRoot: boolean;
};
type BvhStep = {
  left: number;
  right: number;
  kind: "descend" | "pruned" | "leaf-test";
  potentialPairs: number;
  pair: Pair | null;
  overlap: boolean;
};
type BvhTrace = {
  kind: "static-bvh";
  aabbTests: number;
  nodePairVisits: number;
  prunedPotentialPairs: number;
  representedPairs: number;
  root: number | null;
  nodes: BvhNode[];
  steps: BvhStep[];
};

const WORLD_EXTENT = 10;
const HALF_EXTENT = 1.2;
const SEED = 913;
const OBJECTS = 8;
const WIDTH = 760;
const HEIGHT = 520;
const PADDING = 46;

export function StaticBvhExplanation() {
  const worldRef = useRef<DemoWorld | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [trace, setTrace] = useState<BvhTrace | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void initWasm()
      .then(() => {
        if (!active) return;
        const world = new DemoWorld(
          "uniform",
          OBJECTS,
          4,
          1,
          SEED,
          WORLD_EXTENT,
          HALF_EXTENT,
          0,
          0,
          0,
        );
        world.set_layer_interaction(1, 1, true);
        worldRef.current = world;
        setSnapshot(JSON.parse(world.snapshot_json("static-bvh")) as Snapshot);
        setTrace(JSON.parse(world.trace_json("static-bvh")) as BvhTrace);
      })
      .catch((reason: unknown) => setError(String(reason)));

    return () => {
      active = false;
      worldRef.current?.free();
      worldRef.current = null;
    };
  }, []);

  const current = useMemo(() => {
    if (!trace?.steps.length) return null;
    return trace.steps[Math.min(stepIndex, trace.steps.length - 1)];
  }, [stepIndex, trace]);
  const leftNode = current && trace ? trace.nodes[current.left] : null;
  const rightNode = current && trace ? trace.nodes[current.right] : null;
  const maxStep = Math.max(0, (trace?.steps.length ?? 1) - 1);

  if (error) {
    return <div className="rounded-2xl border border-red-900/60 bg-red-950/30 p-6 text-sm text-red-300">{error}</div>;
  }
  if (!snapshot || !trace || !current || !leftNode || !rightNode) {
    return <div className="grid min-h-[30rem] place-items-center rounded-3xl border border-zinc-800 bg-zinc-950 text-sm text-zinc-500">Loading the Rust BVH trace…</div>;
  }

  const decision = decisionCopy(current, leftNode, rightNode);

  return (
    <section className="overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-950">
      <div className="border-b border-zinc-800 p-5 sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-600">Hierarchy lesson · Static BVH</p>
        <h2 className="mt-2 text-2xl font-semibold text-zinc-100">One failed parent test can eliminate many object pairs.</h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-500">
          The colored rectangles are the two BVH nodes Rust is comparing now. A node may represent one object or an entire subtree. If the parent bounds are separate, every leaf pair underneath them disappears at once.
        </p>
      </div>

      <div className="grid xl:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="p-4 sm:p-6">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/25 p-2 sm:p-4">
            <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Static BVH subtree pruning explanation" className="w-full">
              <rect width={WIDTH} height={HEIGHT} rx="18" fill="#09090b" />

              {snapshot.bodies.map((body) => {
                const rect = boundsRect(body);
                const isPair = current.pair?.includes(body.id) ?? false;
                return (
                  <g key={body.id}>
                    <rect
                      x={rect.x}
                      y={rect.y}
                      width={rect.width}
                      height={rect.height}
                      rx="8"
                      fill={isPair && current.overlap ? "#7f1d1d" : "#27272a"}
                      stroke={isPair ? (current.overlap ? "#fb7185" : "#facc15") : "#a1a1aa"}
                      strokeWidth={isPair ? 4 : 2}
                    />
                    <text x={rect.x + rect.width / 2} y={rect.y + rect.height / 2 + 6} textAnchor="middle" fill="#fafafa" fontSize="18" fontWeight="700">
                      {label(body.id)}
                    </text>
                  </g>
                );
              })}

              <NodeOverlay node={leftNode} side="left" kind={current.kind} />
              <NodeOverlay node={rightNode} side="right" kind={current.kind} />

              <g transform="translate(46 28)">
                <rect width="250" height="44" rx="10" fill="#18181b" stroke={kindColor(current.kind)} />
                <text x="14" y="27" fill="#e4e4e7" fontSize="14" fontWeight="700">
                  {kindLabel(current.kind)} · {current.potentialPairs} possible pair{current.potentialPairs === 1 ? "" : "s"}
                </text>
              </g>
              <text x={PADDING} y={HEIGHT - 16} fill="#52525b" fontSize="12">
                2D projection of the actual 3D AABBs · node membership and traversal come from Rust
              </text>
            </svg>
          </div>
        </div>

        <aside className="border-t border-zinc-800 p-5 xl:border-l xl:border-t-0">
          <div className="flex items-baseline justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-600">Traversal step</p>
              <h3 className="mt-2 text-xl font-semibold text-zinc-100">{decision.title}</h3>
            </div>
            <span className="font-mono text-xs text-zinc-600">{stepIndex + 1}/{trace.steps.length}</span>
          </div>
          <p className="mt-3 text-sm leading-6 text-zinc-400">{decision.body}</p>

          <div className={`mt-5 rounded-xl border p-4 ${current.kind === "pruned" ? "border-orange-800/60 bg-orange-950/20" : "border-zinc-800 bg-zinc-900/50"}`}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-600">What this step saves</p>
            <p className="mt-2 text-sm leading-6 text-zinc-200">{decision.notice}</p>
          </div>

          <input type="range" min={0} max={maxStep} value={Math.min(stepIndex, maxStep)} onChange={(event) => setStepIndex(Number(event.target.value))} className="mt-6 w-full accent-zinc-100" />
          <div className="mt-3 grid grid-cols-3 gap-2">
            <button type="button" onClick={() => setStepIndex(0)} disabled={stepIndex === 0} className="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-300 disabled:opacity-30">Reset</button>
            <button type="button" onClick={() => setStepIndex((value) => Math.max(0, value - 1))} disabled={stepIndex === 0} className="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-300 disabled:opacity-30">← Previous</button>
            <button type="button" onClick={() => setStepIndex((value) => Math.min(maxStep, value + 1))} disabled={stepIndex >= maxStep} className="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-300 disabled:opacity-30">Next →</button>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-2">
            <Fact label="Objects" value={OBJECTS} />
            <Fact label="Possible pairs" value={trace.representedPairs} />
            <Fact label="Exact leaf tests" value={trace.aabbTests} />
            <Fact label="Pairs pruned" value={trace.prunedPotentialPairs} />
            <Fact label="Node-pair visits" value={trace.nodePairVisits} />
            <Fact label="Tree nodes" value={trace.nodes.length} />
          </div>

          <p className="mt-5 text-xs leading-5 text-zinc-600">
            Accounting invariant: every possible object pair is represented exactly once, either by a leaf test or by an ancestor prune.
          </p>
        </aside>
      </div>
    </section>
  );
}

function NodeOverlay({ node, side, kind }: { node: BvhNode; side: "left" | "right"; kind: BvhStep["kind"] }) {
  const rect = boundsRect(node.bounds);
  const color = kind === "pruned" ? "#fb923c" : side === "left" ? "#22d3ee" : "#c084fc";
  return (
    <g>
      <rect x={rect.x} y={rect.y} width={rect.width} height={rect.height} rx="12" fill={color} fillOpacity={kind === "pruned" ? 0.09 : 0.06} stroke={color} strokeWidth="4" strokeDasharray={node.body === null ? "10 6" : undefined} />
      <rect x={rect.x + 5} y={rect.y + 5} width="92" height="26" rx="7" fill="#09090b" fillOpacity="0.9" />
      <text x={rect.x + 12} y={rect.y + 23} fill={color} fontSize="12" fontWeight="700">
        {side} · {node.leafCount} leaf{node.leafCount === 1 ? "" : "s"}
      </text>
    </g>
  );
}

function decisionCopy(step: BvhStep, left: BvhNode, right: BvhNode) {
  if (step.kind === "pruned") {
    return {
      title: "Parent bounds are separate",
      body: `The left node contains ${left.leafCount} object${left.leafCount === 1 ? "" : "s"}; the right contains ${right.leafCount}. Their bounds do not overlap, so Rust stops here.`,
      notice: `${step.potentialPairs} possible leaf pair${step.potentialPairs === 1 ? "" : "s"} are eliminated by this single bounding-box rejection. No descendant of either node is visited for this branch.`,
    };
  }
  if (step.kind === "leaf-test") {
    return {
      title: step.overlap ? "Exact leaf pair overlaps" : "Exact leaf pair is separate",
      body: step.pair ? `Both nodes are leaves, so the hierarchy can prune no further. Rust finally performs the exact AABB test for ${pairLabel(step.pair)}.` : "Both nodes are leaves, so Rust performs the exact AABB test.",
      notice: step.overlap ? "This pair becomes a broad-phase overlap." : "One exact AABB test was necessary, but it produces no overlap.",
    };
  }
  return {
    title: "Parent bounds overlap",
    body: `These node bounds overlap. The BVH cannot reject the ${step.potentialPairs} leaf pair${step.potentialPairs === 1 ? "" : "s"} represented here, so traversal descends toward smaller child bounds.`,
    notice: "No exact object test happens at this step. Hierarchy tests are cheap gates whose job is to decide whether deeper work is necessary.",
  };
}

function Fact({ label: factLabel, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-600">{factLabel}</div>
      <div className="mt-1 font-mono text-sm text-zinc-200">{value.toLocaleString()}</div>
    </div>
  );
}

function boundsRect(bounds: Bounds) {
  const x = sx(bounds.min[0]);
  const y = sy(bounds.max[1]);
  return {
    x,
    y,
    width: Math.max(2, sx(bounds.max[0]) - x),
    height: Math.max(2, sy(bounds.min[1]) - y),
  };
}

function scale(value: number) {
  return (value / (WORLD_EXTENT * 2)) * (WIDTH - PADDING * 2);
}
function sx(value: number) {
  return PADDING + scale(value + WORLD_EXTENT);
}
function sy(value: number) {
  const usable = HEIGHT - PADDING * 2;
  return PADDING + ((WORLD_EXTENT - value) / (WORLD_EXTENT * 2)) * usable;
}
function label(id: number) {
  return String.fromCharCode(65 + id);
}
function pairLabel(pair: Pair) {
  return `${label(pair[0])} ↔ ${label(pair[1])}`;
}
function kindColor(kind: BvhStep["kind"]) {
  if (kind === "pruned") return "#fb923c";
  if (kind === "leaf-test") return "#facc15";
  return "#67e8f9";
}
function kindLabel(kind: BvhStep["kind"]) {
  if (kind === "pruned") return "PRUNE";
  if (kind === "leaf-test") return "LEAF TEST";
  return "DESCEND";
}
