"use client";

import { useEffect, useRef, useState } from "react";

import initWasm, { DemoWorld } from "../lib/wasm-pkg/collision_wasm";

type Bounds = { min: [number, number, number]; max: [number, number, number] };
type Body = Bounds & { id: number; motion: "static" | "dynamic" };
type Snapshot = { frame: number; bodies: Body[] };
type DynamicNode = {
  index: number;
  bounds: Bounds;
  exactBounds: Bounds | null;
  body: number | null;
};
type DynamicFocus = {
  id: number;
  reinserted: boolean;
  previousFatBounds: Bounds;
  currentFatBounds: Bounds;
  heightBefore: number;
  heightAfter: number;
  changedNodes: number[];
  beforeNodes: DynamicNode[];
  afterNodes: DynamicNode[];
};
type DynamicTrace = {
  kind: "dynamic-aabb-tree";
  frame: number;
  fatMargin: number;
  height: number;
  nodeCount: number;
  reinsertionCount: number;
  containedCount: number;
  pairParity: boolean;
  focus: DynamicFocus | null;
  nodes: DynamicNode[];
};

const WORLD_EXTENT = 8;
const HALF_EXTENT = 0.7;
const FAT_MARGIN = 1.25;
const SPEED = 6;
const OBJECTS = 6;
const SEED = 1703;
const DT = 1 / 30;
const WIDTH = 760;
const HEIGHT = 500;
const PADDING = 44;

export function DynamicAabbExplanation() {
  const worldRef = useRef<DemoWorld | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [trace, setTrace] = useState<DynamicTrace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const readFrame = (world: DemoWorld, advance: boolean) => {
    const snapshotJson = advance
      ? world.step_json("dynamic-aabb-tree", DT)
      : world.snapshot_json("dynamic-aabb-tree");
    setSnapshot(JSON.parse(snapshotJson) as Snapshot);
    setTrace(JSON.parse(world.trace_json("dynamic-aabb-tree")) as DynamicTrace);
  };

  const createScene = () => {
    worldRef.current?.free();
    const world = new DemoWorld(
      "uniform",
      OBJECTS,
      4,
      FAT_MARGIN,
      SEED,
      WORLD_EXTENT,
      HALF_EXTENT,
      1,
      SPEED,
      0,
    );
    worldRef.current = world;
    // Advance once so the retained tree records a representative body update.
    readFrame(world, true);
    setError(null);
  };

  useEffect(() => {
    let active = true;
    void initWasm()
      .then(() => {
        if (!active) return;
        setReady(true);
        const world = new DemoWorld(
          "uniform",
          OBJECTS,
          4,
          FAT_MARGIN,
          SEED,
          WORLD_EXTENT,
          HALF_EXTENT,
          1,
          SPEED,
          0,
        );
        worldRef.current = world;
        readFrame(world, true);
      })
      .catch((reason: unknown) => setError(String(reason)));

    return () => {
      active = false;
      worldRef.current?.free();
      worldRef.current = null;
    };
  }, []);

  const stepFrame = () => {
    const world = worldRef.current;
    if (!world) return;
    try {
      readFrame(world, true);
      setError(null);
    } catch (reason) {
      setError(String(reason));
    }
  };

  const advanceUntilReinsertion = () => {
    const world = worldRef.current;
    if (!world) return;
    try {
      let latestSnapshot: Snapshot | null = null;
      let latestTrace: DynamicTrace | null = null;
      for (let attempt = 0; attempt < 60; attempt += 1) {
        latestSnapshot = JSON.parse(world.step_json("dynamic-aabb-tree", DT)) as Snapshot;
        latestTrace = JSON.parse(world.trace_json("dynamic-aabb-tree")) as DynamicTrace;
        if (latestTrace.focus?.reinserted) break;
      }
      if (latestSnapshot) setSnapshot(latestSnapshot);
      if (latestTrace) setTrace(latestTrace);
      setError(null);
    } catch (reason) {
      setError(String(reason));
    }
  };

  if (error) {
    return <div className="rounded-2xl border border-red-900/60 bg-red-950/30 p-6 text-sm text-red-300">{error}</div>;
  }
  if (!ready || !snapshot || !trace || !trace.focus) {
    return <div className="grid min-h-[30rem] place-items-center rounded-3xl border border-zinc-800 bg-zinc-950 text-sm text-zinc-500">Loading retained dynamic tree…</div>;
  }

  const focus = trace.focus;
  const focusedBody = snapshot.bodies.find((body) => body.id === focus.id);
  const changedNodes = focus.afterNodes
    .filter((node) => focus.changedNodes.includes(node.index))
    .slice(0, 10);

  return (
    <section className="overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-950">
      <div className="border-b border-zinc-800 p-5 sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-600">Hierarchy lesson · Dynamic AABB tree</p>
        <h2 className="mt-2 text-2xl font-semibold text-zinc-100">Move inside the reserve; restructure only when you escape it.</h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-500">
          The cyan box is the exact moving collider. The purple box is its previous fat AABB: extra spatial slack that lets small movements update the leaf without removing and reinserting it in the tree.
        </p>
      </div>

      <div className="grid xl:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="p-4 sm:p-6">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/25 p-2 sm:p-4">
            <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Dynamic AABB tree fat-bound explanation" className="w-full">
              <rect width={WIDTH} height={HEIGHT} rx="18" fill="#09090b" />

              {snapshot.bodies.map((body) => {
                const rect = boundsRect(body);
                const isFocus = body.id === focus.id;
                return (
                  <g key={body.id}>
                    <rect
                      x={rect.x}
                      y={rect.y}
                      width={rect.width}
                      height={rect.height}
                      rx="7"
                      fill={isFocus ? "#164e63" : "#27272a"}
                      stroke={isFocus ? "#67e8f9" : "#71717a"}
                      strokeWidth={isFocus ? 4 : 2}
                      opacity={isFocus ? 1 : 0.7}
                    />
                    <text x={rect.x + rect.width / 2} y={rect.y + rect.height / 2 + 5} textAnchor="middle" fill="#fafafa" fontSize="15" fontWeight="700">
                      {label(body.id)}
                    </text>
                  </g>
                );
              })}

              <BoundsOverlay bounds={focus.previousFatBounds} color="#c084fc" label="previous fat AABB" dash />
              <BoundsOverlay
                bounds={focus.currentFatBounds}
                color={focus.reinserted ? "#fb923c" : "#4ade80"}
                label={focus.reinserted ? "new fat AABB" : "fat AABB unchanged"}
                dash
              />

              {focus.reinserted && changedNodes.map((node, index) => (
                <BoundsOverlay
                  key={node.index}
                  bounds={node.bounds}
                  color="#fb923c"
                  label={index === 0 ? "changed tree nodes" : undefined}
                  faint
                />
              ))}

              {focusedBody && <BoundsOverlay bounds={focusedBody} color="#67e8f9" label={`exact ${label(focus.id)}`} />}

              <g transform="translate(44 28)">
                <rect width="280" height="46" rx="10" fill="#18181b" stroke={focus.reinserted ? "#fb923c" : "#4ade80"} />
                <text x="14" y="29" fill={focus.reinserted ? "#fdba74" : "#86efac"} fontSize="14" fontWeight="700">
                  {focus.reinserted ? "ESCAPED → REMOVE + REINSERT" : "CONTAINED → KEEP TREE POSITION"}
                </text>
              </g>
              <text x={PADDING} y={HEIGHT - 15} fill="#52525b" fontSize="12">
                Fixed timestep {DT.toFixed(3)} s · same deterministic Rust scene after Reset
              </text>
            </svg>
          </div>
        </div>

        <aside className="border-t border-zinc-800 p-5 xl:border-l xl:border-t-0">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-600">Frame {trace.frame}</p>
              <h3 className="mt-2 text-xl font-semibold text-zinc-100">Focus body {label(focus.id)}</h3>
            </div>
            <span className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${focus.reinserted ? "border-orange-700/60 bg-orange-950/40 text-orange-300" : "border-emerald-700/60 bg-emerald-950/40 text-emerald-300"}`}>
              {focus.reinserted ? "reinserted" : "contained"}
            </span>
          </div>

          <p className="mt-4 text-sm leading-6 text-zinc-400">
            {focus.reinserted
              ? "The exact collider escaped the old fat AABB. Rust removed its leaf, created a new fat bound around the current position, and reinserted the leaf into a better place in the hierarchy."
              : "The exact collider is still fully inside its previous fat AABB. Rust updates the body's exact bounds but leaves the hierarchy in place."}
          </p>

          <div className="mt-5 grid grid-cols-2 gap-2">
            <button type="button" onClick={stepFrame} className="rounded-lg bg-zinc-100 px-3 py-2 text-xs font-semibold text-zinc-950">Step one frame</button>
            <button type="button" onClick={advanceUntilReinsertion} className="rounded-lg border border-orange-800/70 px-3 py-2 text-xs font-semibold text-orange-300">Until reinsertion</button>
          </div>
          <button type="button" onClick={createScene} className="mt-2 w-full rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-300">Reset deterministic scene</button>

          <dl className="mt-6 grid grid-cols-2 gap-2">
            <Metric label="Contained" value={trace.containedCount} />
            <Metric label="Reinserted" value={trace.reinsertionCount} />
            <Metric label="Tree height" value={trace.height} />
            <Metric label="Tree nodes" value={trace.nodeCount} />
            <Metric label="Changed nodes" value={focus.changedNodes.length} />
            <Metric label="Fat margin" value={trace.fatMargin} decimals />
          </dl>

          <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-600">Exact pair parity</div>
            <div className={`mt-1 font-mono text-sm font-semibold ${trace.pairParity ? "text-emerald-300" : "text-red-300"}`}>
              {trace.pairParity ? "verified" : "mismatch"}
            </div>
          </div>

          <p className="mt-5 text-xs leading-5 text-zinc-600">
            A larger fat margin generally means fewer reinsertions but looser tree bounds. Analysis mode can later sweep this parameter to expose that tradeoff quantitatively.
          </p>
        </aside>
      </div>
    </section>
  );
}

function BoundsOverlay({
  bounds,
  color,
  label: text,
  dash = false,
  faint = false,
}: {
  bounds: Bounds;
  color: string;
  label?: string;
  dash?: boolean;
  faint?: boolean;
}) {
  const rect = boundsRect(bounds);
  return (
    <g opacity={faint ? 0.35 : 1}>
      <rect
        x={rect.x}
        y={rect.y}
        width={rect.width}
        height={rect.height}
        rx="9"
        fill="none"
        stroke={color}
        strokeWidth={faint ? 2 : 3}
        strokeDasharray={dash ? "10 6" : undefined}
      />
      {text && (
        <g transform={`translate(${rect.x + 5} ${Math.max(82, rect.y + 5)})`}>
          <rect width={Math.max(94, text.length * 7.2)} height="24" rx="6" fill="#09090b" fillOpacity="0.9" />
          <text x="8" y="16" fill={color} fontSize="11" fontWeight="700">{text}</text>
        </g>
      )}
    </g>
  );
}

function Metric({ label: metricLabel, value, decimals = false }: { label: string; value: number; decimals?: boolean }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
      <dt className="text-[10px] uppercase tracking-wide text-zinc-600">{metricLabel}</dt>
      <dd className="mt-1 font-mono text-sm text-zinc-200">{decimals ? value.toFixed(2) : value.toLocaleString()}</dd>
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
