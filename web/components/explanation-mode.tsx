"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import initWasm, { DemoWorld } from "../lib/wasm-pkg/collision_wasm";

type AlgorithmId = "naive" | "uniform-grid" | "sweep-and-prune";
type Pair = [number, number];

type Body = {
  id: number;
  min: [number, number, number];
  max: [number, number, number];
};

type Snapshot = {
  bodies: Body[];
  pairs: Pair[];
  stats: { aabbTests: number };
};

type GridStep = {
  cell: [number, number, number];
  members: number[];
  candidatePairs: Pair[];
  testedPairs: Pair[];
  overlappingPairs: Pair[];
};

type GridTrace = {
  kind: "uniform-grid";
  cellSize: number;
  aabbTests: number;
  steps: GridStep[];
};

type SweepStep = {
  current: number;
  intervalMin: number;
  intervalMax: number;
  expired: number[];
  activeBeforeTests: number[];
  testedPairs: Pair[];
  overlappingPairs: Pair[];
  activeAfter: number[];
};

type SweepTrace = {
  kind: "sweep-and-prune";
  aabbTests: number;
  steps: SweepStep[];
};

type NaiveStep = {
  pair: Pair;
  overlaps: boolean;
  tested: number;
  total: number;
};

const ALGORITHMS: { id: AlgorithmId; label: string; description: string }[] = [
  {
    id: "naive",
    label: "1 · All pairs",
    description: "Start with the trustworthy baseline: every unique pair is tested.",
  },
  {
    id: "uniform-grid",
    label: "2 · Uniform grid",
    description: "Partition space first so far-away objects never become candidates.",
  },
  {
    id: "sweep-and-prune",
    label: "3 · Sweep & prune",
    description: "Sort X intervals and keep only objects whose intervals are still active.",
  },
];

const WORLD_EXTENT = 6;
const HALF_EXTENT = 2;
const CELL_SIZE = 3;
const SEED = 419;
const SVG_WIDTH = 720;
const SVG_HEIGHT = 520;
const PADDING = 46;

export function ExplanationMode() {
  const worldRef = useRef<DemoWorld | null>(null);
  const [ready, setReady] = useState(false);
  const [algorithm, setAlgorithm] = useState<AlgorithmId>("naive");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [gridTrace, setGridTrace] = useState<GridTrace | null>(null);
  const [sweepTrace, setSweepTrace] = useState<SweepTrace | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    initWasm()
      .then(() => {
        if (!active) return;
        const world = new DemoWorld(
          "uniform",
          6,
          CELL_SIZE,
          1,
          SEED,
          WORLD_EXTENT,
          HALF_EXTENT,
          0,
          0,
          0,
        );
        // Explanation mode is about geometry first. All bodies are static/world,
        // so explicitly enable World × World for this teaching scene.
        world.set_layer_interaction(1, 1, true);
        worldRef.current = world;
        setSnapshot(JSON.parse(world.snapshot_json("naive")) as Snapshot);
        const grid = JSON.parse(world.trace_json("uniform-grid")) as GridTrace;
        setGridTrace({
          ...grid,
          steps: grid.steps.filter((step) => step.cell[2] === 0),
        });
        setSweepTrace(JSON.parse(world.trace_json("sweep-and-prune")) as SweepTrace);
        setReady(true);
      })
      .catch((reason: unknown) => setError(String(reason)));

    return () => {
      active = false;
      worldRef.current?.free();
      worldRef.current = null;
    };
  }, []);

  useEffect(() => {
    setStepIndex(0);
  }, [algorithm]);

  const naiveSteps = useMemo(() => {
    if (!snapshot) return [];
    const overlaps = new Set(snapshot.pairs.map(pairKey));
    const steps: NaiveStep[] = [];
    let tested = 0;
    const total = (snapshot.bodies.length * (snapshot.bodies.length - 1)) / 2;
    for (let left = 0; left < snapshot.bodies.length; left += 1) {
      for (let right = left + 1; right < snapshot.bodies.length; right += 1) {
        tested += 1;
        const pair: Pair = [snapshot.bodies[left].id, snapshot.bodies[right].id];
        steps.push({ pair, overlaps: overlaps.has(pairKey(pair)), tested, total });
      }
    }
    return steps;
  }, [snapshot]);

  const steps = useMemo(() => {
    if (algorithm === "naive") return naiveSteps;
    if (algorithm === "uniform-grid") return gridTrace?.steps ?? [];
    return sweepTrace?.steps ?? [];
  }, [algorithm, gridTrace, naiveSteps, sweepTrace]);

  const currentStep = steps.length > 0 ? steps[Math.min(stepIndex, steps.length - 1)] : null;
  const maxStep = Math.max(0, steps.length - 1);

  if (error) {
    return <div className="rounded-2xl border border-red-900/60 bg-red-950/30 p-6 text-sm text-red-300">{error}</div>;
  }

  if (!ready || !snapshot) {
    return <div className="grid min-h-[32rem] place-items-center rounded-3xl border border-zinc-800 bg-zinc-950 text-sm text-zinc-500">Loading Rust/WASM teaching scene…</div>;
  }

  const state = visualState(algorithm, currentStep, snapshot);
  const description = describeStep(algorithm, currentStep, snapshot, gridTrace, sweepTrace);

  return (
    <section className="overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-950">
      <div className="border-b border-zinc-800 p-5 sm:p-6">
        <div className="flex flex-wrap gap-2">
          {ALGORITHMS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setAlgorithm(item.id)}
              className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                algorithm === item.id
                  ? "border-zinc-200 bg-zinc-100 text-zinc-950"
                  : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className="mt-4 max-w-3xl text-sm leading-6 text-zinc-500">
          {ALGORITHMS.find((item) => item.id === algorithm)?.description}
        </p>
      </div>

      <div className="grid xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="p-4 sm:p-6">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-2 sm:p-4">
            <TeachingSvg
              bodies={snapshot.bodies}
              algorithm={algorithm}
              state={state}
              cellSize={gridTrace?.cellSize ?? CELL_SIZE}
            />
          </div>
        </div>

        <aside className="border-t border-zinc-800 p-5 xl:border-l xl:border-t-0">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-600">Explanation step</p>
          <div className="mt-2 flex items-baseline justify-between gap-3">
            <h2 className="text-xl font-semibold text-zinc-100">{description.title}</h2>
            <span className="font-mono text-xs text-zinc-600">{steps.length ? `${stepIndex + 1}/${steps.length}` : "—"}</span>
          </div>
          <p className="mt-3 text-sm leading-6 text-zinc-400">{description.body}</p>

          <div className="mt-5 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-600">What to notice</p>
            <p className="mt-2 text-sm leading-6 text-zinc-300">{description.notice}</p>
          </div>

          <input
            type="range"
            min={0}
            max={maxStep}
            value={Math.min(stepIndex, maxStep)}
            onChange={(event) => setStepIndex(Number(event.target.value))}
            className="mt-6 w-full accent-zinc-100"
          />

          <div className="mt-3 grid grid-cols-3 gap-2">
            <button type="button" onClick={() => setStepIndex(0)} disabled={stepIndex === 0} className="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-300 disabled:opacity-30">Reset</button>
            <button type="button" onClick={() => setStepIndex((value) => Math.max(0, value - 1))} disabled={stepIndex === 0} className="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-300 disabled:opacity-30">← Previous</button>
            <button type="button" onClick={() => setStepIndex((value) => Math.min(maxStep, value + 1))} disabled={stepIndex >= maxStep} className="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-300 disabled:opacity-30">Next →</button>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-2">
            <Fact label="Objects" value={String(snapshot.bodies.length)} />
            <Fact label="Naive pairs" value={String(naiveSteps.length)} />
            <Fact label="Grid exact tests" value={String(gridTrace?.aabbTests ?? "—")} />
            <Fact label="Sweep exact tests" value={String(sweepTrace?.aabbTests ?? "—")} />
          </div>

          <p className="mt-5 text-xs leading-5 text-zinc-600">
            Positions, overlap results, grid memberships, and sweep active-set steps come from the Rust/WASM implementation. The SVG only projects that data into 2D.
          </p>
        </aside>
      </div>
    </section>
  );
}

function TeachingSvg({
  bodies,
  algorithm,
  state,
  cellSize,
}: {
  bodies: Body[];
  algorithm: AlgorithmId;
  state: VisualState;
  cellSize: number;
}) {
  return (
    <svg viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`} role="img" aria-label="Simplified two-dimensional collision explanation" className="w-full">
      <rect width={SVG_WIDTH} height={SVG_HEIGHT} rx="18" fill="#09090b" />

      {algorithm === "uniform-grid" && <GridLines cellSize={cellSize} activeCell={state.cell} />}

      {algorithm === "sweep-and-prune" && state.sweepX !== null && (
        <g>
          <line x1={sx(state.sweepX)} y1={PADDING - 10} x2={sx(state.sweepX)} y2={SVG_HEIGHT - PADDING + 10} stroke="#facc15" strokeWidth="3" strokeDasharray="9 7" />
          <text x={sx(state.sweepX) + 8} y={PADDING} fill="#facc15" fontSize="13">sweep</text>
        </g>
      )}

      {state.pair && <PairLine pair={state.pair} bodies={bodies} overlaps={state.overlapPair} />}

      {bodies.map((body) => {
        const rect = svgRect(body);
        const style = bodyStyle(body.id, state);
        return (
          <g key={body.id}>
            <rect x={rect.x} y={rect.y} width={rect.width} height={rect.height} rx="10" fill={style.fill} stroke={style.stroke} strokeWidth={style.width} opacity={style.opacity} />
            <text x={rect.x + rect.width / 2} y={rect.y + rect.height / 2 + 6} textAnchor="middle" fill="#fafafa" fontSize="20" fontWeight="700">{label(body.id)}</text>
          </g>
        );
      })}

      <text x={PADDING} y={SVG_HEIGHT - 14} fill="#52525b" fontSize="12">
        Same six rectangles in every algorithm · z is deliberately ignored in this teaching projection
      </text>
    </svg>
  );
}

function GridLines({ cellSize, activeCell }: { cellSize: number; activeCell: [number, number] | null }) {
  const lines = [];
  for (let value = -WORLD_EXTENT; value <= WORLD_EXTENT; value += cellSize) {
    lines.push(<line key={`x-${value}`} x1={sx(value)} y1={sy(WORLD_EXTENT)} x2={sx(value)} y2={sy(-WORLD_EXTENT)} stroke="#27272a" strokeWidth="1" />);
    lines.push(<line key={`y-${value}`} x1={sx(-WORLD_EXTENT)} y1={sy(value)} x2={sx(WORLD_EXTENT)} y2={sy(value)} stroke="#27272a" strokeWidth="1" />);
  }

  return (
    <g>
      {activeCell && (
        <rect
          x={sx(activeCell[0] * cellSize)}
          y={sy((activeCell[1] + 1) * cellSize)}
          width={scale(cellSize)}
          height={scale(cellSize)}
          fill="#2563eb"
          opacity="0.16"
          stroke="#60a5fa"
          strokeWidth="2"
        />
      )}
      {lines}
    </g>
  );
}

function PairLine({ pair, bodies, overlaps }: { pair: Pair; bodies: Body[]; overlaps: boolean }) {
  const left = bodies.find((body) => body.id === pair[0]);
  const right = bodies.find((body) => body.id === pair[1]);
  if (!left || !right) return null;
  const a = bodyCenter(left);
  const b = bodyCenter(right);
  return <line x1={sx(a[0])} y1={sy(a[1])} x2={sx(b[0])} y2={sy(b[1])} stroke={overlaps ? "#f87171" : "#facc15"} strokeWidth="4" strokeDasharray={overlaps ? undefined : "8 6"} opacity="0.9" />;
}

function visualState(algorithm: AlgorithmId, step: unknown, snapshot: Snapshot): VisualState {
  const state: VisualState = {
    active: new Set(),
    current: new Set(),
    overlapping: new Set(),
    expired: new Set(),
    pair: null,
    overlapPair: false,
    cell: null,
    sweepX: null,
  };

  if (!step) return state;

  if (algorithm === "naive") {
    const naive = step as NaiveStep;
    state.pair = naive.pair;
    state.overlapPair = naive.overlaps;
    naive.pair.forEach((id) => state.current.add(id));
    if (naive.overlaps) naive.pair.forEach((id) => state.overlapping.add(id));
    return state;
  }

  if (algorithm === "uniform-grid") {
    const grid = step as GridStep;
    state.cell = [grid.cell[0], grid.cell[1]];
    grid.members.forEach((id) => state.active.add(id));
    grid.overlappingPairs.flat().forEach((id) => state.overlapping.add(id));
    state.pair = grid.testedPairs[0] ?? grid.candidatePairs[0] ?? null;
    state.overlapPair = state.pair ? snapshot.pairs.some((pair) => pairKey(pair) === pairKey(state.pair!)) : false;
    return state;
  }

  const sweep = step as SweepStep;
  state.current.add(sweep.current);
  sweep.activeBeforeTests.forEach((id) => state.active.add(id));
  sweep.expired.forEach((id) => state.expired.add(id));
  sweep.overlappingPairs.flat().forEach((id) => state.overlapping.add(id));
  state.pair = sweep.testedPairs[0] ?? null;
  state.overlapPair = state.pair ? snapshot.pairs.some((pair) => pairKey(pair) === pairKey(state.pair!)) : false;
  state.sweepX = sweep.intervalMin;
  return state;
}

type VisualState = {
  active: Set<number>;
  current: Set<number>;
  overlapping: Set<number>;
  expired: Set<number>;
  pair: Pair | null;
  overlapPair: boolean;
  cell: [number, number] | null;
  sweepX: number | null;
};

function bodyStyle(id: number, state: VisualState) {
  if (state.overlapping.has(id)) return { fill: "#7f1d1d", stroke: "#f87171", width: 4, opacity: 1 };
  if (state.current.has(id)) return { fill: "#713f12", stroke: "#facc15", width: 4, opacity: 1 };
  if (state.active.has(id)) return { fill: "#4c1d95", stroke: "#a78bfa", width: 3, opacity: 1 };
  if (state.expired.has(id)) return { fill: "#18181b", stroke: "#3f3f46", width: 2, opacity: 0.35 };
  return { fill: "#27272a", stroke: "#71717a", width: 2, opacity: 0.82 };
}

function describeStep(
  algorithm: AlgorithmId,
  step: unknown,
  snapshot: Snapshot,
  gridTrace: GridTrace | null,
  sweepTrace: SweepTrace | null,
) {
  if (!step) return { title: "No step", body: "No trace step is available.", notice: "—" };

  if (algorithm === "naive") {
    const naive = step as NaiveStep;
    return {
      title: `Test ${pairLabel(naive.pair)}`,
      body: naive.overlaps
        ? `Rust reports that ${pairLabel(naive.pair)} overlaps. This pair survives.`
        : `Rust reports that ${pairLabel(naive.pair)} does not overlap. The important point is that naive search still had to ask.`,
      notice: `${naive.tested} of ${naive.total} unique pairs have been tested. With only six objects that is manageable; with 10,000 objects it becomes 49,995,000 tests.`,
    };
  }

  if (algorithm === "uniform-grid") {
    const grid = step as GridStep;
    return {
      title: `Visit cell (${grid.cell[0]}, ${grid.cell[1]})`,
      body: grid.members.length < 2
        ? `Only ${grid.members.length === 0 ? "zero" : label(grid.members[0])} is in this cell, so it cannot create a pair.`
        : `This cell contains ${grid.members.map(label).join(", ")}. Only objects sharing a cell can become candidates.`,
      notice: grid.testedPairs.length === 0 && grid.candidatePairs.length > 0
        ? "The candidate already shared another cell and was tested there, so the grid deduplicates it instead of repeating the exact test."
        : `${grid.testedPairs.length} new exact test${grid.testedPairs.length === 1 ? "" : "s"} here. Across the whole scene the grid performs ${gridTrace?.aabbTests ?? "—"} exact tests instead of ${snapshot.stats.aabbTests}.`,
    };
  }

  const sweep = step as SweepStep;
  return {
    title: `${label(sweep.current)} enters the sweep`,
    body: sweep.activeBeforeTests.length === 0
      ? `No earlier X interval is still active when ${label(sweep.current)} begins.`
      : `${label(sweep.current)} only needs to be compared with the active set: ${sweep.activeBeforeTests.map(label).join(", ")}.`,
    notice: sweep.expired.length
      ? `${sweep.expired.map(label).join(", ")} expired before this point, so ${sweep.expired.length === 1 ? "it is" : "they are"} removed without a full overlap test. Sweep-and-prune performs ${sweepTrace?.aabbTests ?? "—"} exact tests in this scene.`
      : "Nothing expires at this step. Watch how the active set grows and shrinks as the sweep line moves right.",
  };
}

function Fact({ label: factLabel, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-600">{factLabel}</div>
      <div className="mt-1 font-mono text-sm text-zinc-200">{value}</div>
    </div>
  );
}

function svgRect(body: Body) {
  const x = sx(body.min[0]);
  const y = sy(body.max[1]);
  return {
    x,
    y,
    width: sx(body.max[0]) - x,
    height: sy(body.min[1]) - y,
  };
}

function bodyCenter(body: Body): [number, number] {
  return [(body.min[0] + body.max[0]) / 2, (body.min[1] + body.max[1]) / 2];
}

function scale(value: number) {
  return (value / (WORLD_EXTENT * 2)) * (SVG_WIDTH - PADDING * 2);
}

function sx(value: number) {
  return PADDING + scale(value + WORLD_EXTENT);
}

function sy(value: number) {
  const usable = SVG_HEIGHT - PADDING * 2;
  return PADDING + ((WORLD_EXTENT - value) / (WORLD_EXTENT * 2)) * usable;
}

function label(id: number) {
  return String.fromCharCode(65 + id);
}

function pairLabel(pair: Pair) {
  return `${label(pair[0])} ↔ ${label(pair[1])}`;
}

function pairKey(pair: Pair) {
  const [a, b] = pair[0] < pair[1] ? pair : [pair[1], pair[0]];
  return `${a}:${b}`;
}
