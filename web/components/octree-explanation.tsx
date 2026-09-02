"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import initWasm, { DemoWorld } from "../lib/wasm-pkg/collision_wasm";

type Bounds = { min: [number, number, number]; max: [number, number, number] };
type OctreeNode = {
  index: number;
  bounds: Bounds;
  depth: number;
  members: number[];
  children: number[];
  isLeaf: boolean;
};
type OctreeTrace = {
  kind: "octree";
  aabbTests: number;
  root: number | null;
  leafCount: number;
  occupiedLeafCount: number;
  nodes: OctreeNode[];
};

type AxisSide = "low" | "high";
type OctantSides = { x: AxisSide; y: AxisSide; z: AxisSide };

const OBJECTS = 20;
const WORLD_EXTENT = 8;
const HALF_EXTENT = 0.65;
const SEED = 2309;
const SVG_WIDTH = 760;
const SVG_HEIGHT = 430;
const PANEL_SIZE = 280;
const PANEL_TOP = 92;
const LEFT_X = 70;
const RIGHT_X = 410;

export function OctreeExplanation() {
  const worldRef = useRef<DemoWorld | null>(null);
  const [trace, setTrace] = useState<OctreeTrace | null>(null);
  const [childIndex, setChildIndex] = useState(0);
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
        worldRef.current = world;
        const next = JSON.parse(world.trace_json("octree")) as OctreeTrace;
        setTrace(next);
      })
      .catch((reason: unknown) => setError(String(reason)));

    return () => {
      active = false;
      worldRef.current?.free();
      worldRef.current = null;
    };
  }, []);

  const root = trace?.root === null || trace?.root === undefined ? null : trace.nodes[trace.root];
  const children = useMemo(
    () => (root && trace ? root.children.map((index) => trace.nodes[index]) : []),
    [root, trace],
  );
  const selected = children[Math.min(childIndex, Math.max(0, children.length - 1))] ?? null;
  const sides = selected && root ? classifyOctant(root.bounds, selected.bounds) : null;
  const descendants = selected && trace ? descendantCount(trace.nodes, selected) : 0;

  if (error) {
    return <div className="rounded-2xl border border-red-900/60 bg-red-950/30 p-6 text-sm text-red-300">{error}</div>;
  }
  if (!trace || !root || children.length !== 8 || !selected || !sides) {
    return <div className="grid min-h-[28rem] place-items-center rounded-3xl border border-zinc-800 bg-zinc-950 text-sm text-zinc-500">Loading the Rust octree subdivision…</div>;
  }

  return (
    <section className="overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-950">
      <div className="border-b border-zinc-800 p-5 sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-600">Spatial partition lesson · Octree</p>
        <h2 className="mt-2 text-2xl font-semibold text-zinc-100">Eight children = four XY quadrants × two Z halves.</h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-500">
          A flat 2D drawing cannot show eight non-overlapping 3D octants at once. Instead, this view slices the real Rust root cube into lower-Z and upper-Z halves. Each half contains the same four low/high X/Y quadrants.
        </p>
      </div>

      <div className="grid xl:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="p-4 sm:p-6">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/25 p-2 sm:p-4">
            <svg viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`} role="img" aria-label="Octree shown as lower-Z and upper-Z quadrant slices" className="w-full">
              <rect width={SVG_WIDTH} height={SVG_HEIGHT} rx="18" fill="#09090b" />
              <text x={LEFT_X} y="54" fill="#a1a1aa" fontSize="16" fontWeight="700">Lower Z half</text>
              <text x={RIGHT_X} y="54" fill="#a1a1aa" fontSize="16" fontWeight="700">Upper Z half</text>
              <text x={LEFT_X} y="76" fill="#52525b" fontSize="12">4 children</text>
              <text x={RIGHT_X} y="76" fill="#52525b" fontSize="12">4 children</text>

              <SlicePanel
                panelX={LEFT_X}
                z="low"
                root={root}
                children={children}
                selected={selected}
              />
              <SlicePanel
                panelX={RIGHT_X}
                z="high"
                root={root}
                children={children}
                selected={selected}
              />

              <g transform="translate(250 388)">
                <rect width="260" height="30" rx="8" fill="#18181b" stroke="#22d3ee" />
                <text x="130" y="20" textAnchor="middle" fill="#a5f3fc" fontSize="12" fontWeight="700">
                  selected: X {sides.x} · Y {sides.y} · Z {sides.z}
                </text>
              </g>
            </svg>
          </div>
        </div>

        <aside className="border-t border-zinc-800 p-5 xl:border-l xl:border-t-0">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-600">Depth-1 child</p>
              <h3 className="mt-2 text-xl font-semibold text-zinc-100">Octant {childIndex + 1} of 8</h3>
            </div>
            <span className="font-mono text-xs text-zinc-600">node {selected.index}</span>
          </div>

          <p className="mt-4 text-sm leading-6 text-zinc-400">
            This octant is the <strong className="text-zinc-200">{sides.x}-X</strong>, <strong className="text-zinc-200">{sides.y}-Y</strong>, <strong className="text-zinc-200">{sides.z}-Z</strong> child of the root. Its bounds and member list come directly from `OctreeTrace`.
          </p>

          <div className="mt-5 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-600">Members touching this child</div>
            <div className="mt-2 font-mono text-sm leading-6 text-zinc-200">
              {selected.members.length ? selected.members.map(label).join(" · ") : "none"}
            </div>
            <p className="mt-2 text-xs leading-5 text-zinc-600">
              An AABB that straddles a split plane may appear in more than one child. Candidate pairs are deduplicated before exact tests.
            </p>
          </div>

          <input type="range" min={0} max={7} value={childIndex} onChange={(event) => setChildIndex(Number(event.target.value))} className="mt-6 w-full accent-zinc-100" />
          <div className="mt-3 grid grid-cols-3 gap-2">
            <button type="button" onClick={() => setChildIndex(0)} disabled={childIndex === 0} className="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-300 disabled:opacity-30">Reset</button>
            <button type="button" onClick={() => setChildIndex((value) => Math.max(0, value - 1))} disabled={childIndex === 0} className="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-300 disabled:opacity-30">← Previous</button>
            <button type="button" onClick={() => setChildIndex((value) => Math.min(7, value + 1))} disabled={childIndex === 7} className="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-300 disabled:opacity-30">Next →</button>
          </div>

          <dl className="mt-6 grid grid-cols-2 gap-2">
            <Metric label="Root children" value={root.children.length} />
            <Metric label="Child members" value={selected.members.length} />
            <Metric label="Tree nodes" value={trace.nodes.length} />
            <Metric label="Leaves" value={trace.leafCount} />
            <Metric label="Occupied leaves" value={trace.occupiedLeafCount} />
            <Metric label="Exact tests" value={trace.aabbTests} />
          </dl>

          <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-600">Recursive subdivision below this child</div>
            <div className="mt-1 font-mono text-sm text-zinc-200">{descendants.toLocaleString()} descendant node{descendants === 1 ? "" : "s"}</div>
          </div>

          <p className="mt-5 text-xs leading-5 text-zinc-600">
            Experiment mode shows these same octants as actual 3D helper boxes. This sliced view exists only to make the eight-way split easier to reason about on a flat screen.
          </p>
        </aside>
      </div>
    </section>
  );
}

function SlicePanel({
  panelX,
  z,
  root,
  children,
  selected,
}: {
  panelX: number;
  z: AxisSide;
  root: OctreeNode;
  children: OctreeNode[];
  selected: OctreeNode;
}) {
  const sliceChildren = children.filter((child) => classifyOctant(root.bounds, child.bounds).z === z);
  return (
    <g>
      <rect x={panelX} y={PANEL_TOP} width={PANEL_SIZE} height={PANEL_SIZE} rx="12" fill="#111216" stroke="#52525b" strokeWidth="2" />
      {sliceChildren.map((child) => {
        const sides = classifyOctant(root.bounds, child.bounds);
        const x = panelX + (sides.x === "high" ? PANEL_SIZE / 2 : 0);
        const y = PANEL_TOP + (sides.y === "low" ? PANEL_SIZE / 2 : 0);
        const active = child.index === selected.index;
        const memberText = child.members.length ? child.members.slice(0, 5).map(label).join(" ") : "empty";
        return (
          <g key={child.index}>
            <rect
              x={x}
              y={y}
              width={PANEL_SIZE / 2}
              height={PANEL_SIZE / 2}
              fill={active ? "#164e63" : child.members.length ? "#27272a" : "#18181b"}
              fillOpacity={active ? 0.9 : 0.75}
              stroke={active ? "#67e8f9" : "#71717a"}
              strokeWidth={active ? 4 : 2}
            />
            <text x={x + 10} y={y + 22} fill={active ? "#a5f3fc" : "#a1a1aa"} fontSize="11" fontWeight="700">
              X {sides.x} · Y {sides.y}
            </text>
            <text x={x + 10} y={y + 43} fill="#71717a" fontSize="11">
              {child.members.length} member{child.members.length === 1 ? "" : "s"}
            </text>
            <text x={x + 10} y={y + 64} fill="#52525b" fontSize="10">
              {memberText}{child.members.length > 5 ? " …" : ""}
            </text>
          </g>
        );
      })}
      <line x1={panelX + PANEL_SIZE / 2} x2={panelX + PANEL_SIZE / 2} y1={PANEL_TOP} y2={PANEL_TOP + PANEL_SIZE} stroke="#a1a1aa" strokeOpacity="0.35" />
      <line x1={panelX} x2={panelX + PANEL_SIZE} y1={PANEL_TOP + PANEL_SIZE / 2} y2={PANEL_TOP + PANEL_SIZE / 2} stroke="#a1a1aa" strokeOpacity="0.35" />
    </g>
  );
}

function classifyOctant(root: Bounds, child: Bounds): OctantSides {
  const mid = [
    (root.min[0] + root.max[0]) * 0.5,
    (root.min[1] + root.max[1]) * 0.5,
    (root.min[2] + root.max[2]) * 0.5,
  ];
  return {
    x: child.min[0] >= mid[0] ? "high" : "low",
    y: child.min[1] >= mid[1] ? "high" : "low",
    z: child.min[2] >= mid[2] ? "high" : "low",
  };
}

function descendantCount(nodes: OctreeNode[], node: OctreeNode): number {
  let count = 0;
  const stack = [...node.children];
  while (stack.length) {
    const index = stack.pop();
    if (index === undefined) break;
    const child = nodes[index];
    count += 1;
    stack.push(...child.children);
  }
  return count;
}

function Metric({ label: metricLabel, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
      <dt className="text-[10px] uppercase tracking-wide text-zinc-600">{metricLabel}</dt>
      <dd className="mt-1 font-mono text-sm text-zinc-200">{value.toLocaleString()}</dd>
    </div>
  );
}

function label(id: number) {
  return id < 26 ? String.fromCharCode(65 + id) : `#${id}`;
}
