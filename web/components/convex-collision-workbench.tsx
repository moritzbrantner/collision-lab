"use client";

import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import initWasm, { convex_gjk_trace_json } from "../lib/wasm-pkg/collision_wasm";

type Vec2 = { x: number; y: number };
type Polygon = Vec2[];
type Vec3 = [number, number, number];

type SupportEvidence = {
  point: Vec3;
  left: Vec3;
  right: Vec3;
};

type GjkTraceStep = {
  iteration: number;
  queryDirection: Vec3;
  support: SupportEvidence;
  simplex: SupportEvidence[];
  nextSearchDirection: Vec3;
  terminalStatus: GjkStatus | null;
};

type GjkStatus = "intersecting" | "separated" | "no-progress" | "iteration-limit";

type GjkTrace = {
  status: GjkStatus;
  intersection: boolean | null;
  iterations: number;
  simplex: SupportEvidence[];
  searchDirection: Vec3;
  steps: GjkTraceStep[];
};

const WIDTH = 860;
const HEIGHT = 470;
const SCALE = 96;
const ORIGIN_X = 360;
const ORIGIN_Y = 235;

const EMPTY_TRACE: GjkTrace = {
  status: "iteration-limit",
  intersection: null,
  iterations: 0,
  simplex: [],
  searchDirection: [1, 0, 0],
  steps: [],
};

const SOURCE_A = polarShape(
  [1.0, 1.06, 0.92, 1.12, 0.98, 1.04, 0.9, 1.08, 1.02, 0.94, 1.1, 0.96, 1.04, 0.91, 1.08, 0.98],
  1.18,
  0.86,
  0.08,
);

const SOURCE_B = polarShape(
  [1.0, 0.93, 1.08, 0.96, 1.12, 0.9, 1.03, 1.09, 0.95, 1.05, 0.92, 1.1, 0.98, 1.04],
  1.0,
  0.72,
  -0.06,
);

export function ConvexCollisionWorkbench() {
  const [samples, setSamples] = useState(8);
  const [offsetX, setOffsetX] = useState(1.55);
  const [offsetY, setOffsetY] = useState(0.12);
  const [rotationDegrees, setRotationDegrees] = useState(-18);
  const [stepIndex, setStepIndex] = useState(0);
  const [wasmReady, setWasmReady] = useState(false);
  const [wasmError, setWasmError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void initWasm()
      .then(() => {
        if (!cancelled) setWasmReady(true);
      })
      .catch((error: unknown) => {
        if (!cancelled) setWasmError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const model = useMemo(() => {
    const exactA = convexHull(SOURCE_A);
    const exactB = convexHull(SOURCE_B);
    const proxyA = sampleConvexVertices(exactA, samples);
    const proxyB = sampleConvexVertices(exactB, samples);
    const exactWorldA = transformPolygon(exactA, { x: -1.25, y: 0 }, 0);
    const exactWorldB = transformPolygon(exactB, { x: offsetX, y: offsetY }, degreesToRadians(rotationDegrees));
    const worldA = transformPolygon(proxyA, { x: -1.25, y: 0 }, 0);
    const worldB = transformPolygon(proxyB, { x: offsetX, y: offsetY }, degreesToRadians(rotationDegrees));
    const trace = wasmReady ? readRustTrace(worldA, worldB) : EMPTY_TRACE;
    const minkowski = convexHull(worldA.flatMap((left) => worldB.map((right) => subtract(left, right))));

    return { exactWorldA, exactWorldB, worldA, worldB, trace, minkowski };
  }, [offsetX, offsetY, rotationDegrees, samples, wasmReady]);

  useEffect(() => {
    setStepIndex(0);
  }, [offsetX, offsetY, rotationDegrees, samples, wasmReady]);

  const activeStepIndex = Math.min(stepIndex, Math.max(0, model.trace.steps.length - 1));
  const activeStep = model.trace.steps[activeStepIndex] ?? null;
  const collides = wasmReady && model.trace.intersection === true;
  const separated = wasmReady && model.trace.intersection === false;
  const supportA = activeStep ? vec2(activeStep.support.left) : null;
  const supportB = activeStep ? vec2(activeStep.support.right) : null;
  const direction = activeStep ? vec2(activeStep.queryDirection) : { x: 1, y: 0 };

  return (
    <section className="overflow-hidden rounded-[2rem] border border-zinc-800 bg-zinc-950 shadow-2xl shadow-black/20">
      <div className="border-b border-zinc-800 bg-zinc-900/35 px-5 py-5 sm:px-7">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-500/80">Rust-owned GJK trace</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-100 sm:text-3xl">Move the shapes. Inspect the exact simplex decisions.</h2>
            <p className="mt-3 text-sm leading-6 text-zinc-500">
              React supplies the convex proxy vertices and projects the returned evidence. Support witnesses, retained simplexes, search directions, termination status, and intersection truth come from <span className="font-mono text-zinc-400">geometry-kernels</span> through WASM.
            </p>
          </div>
          <DecisionBadge trace={model.trace} ready={wasmReady} error={wasmError} />
        </div>
      </div>

      <div className="grid xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="p-4 sm:p-6">
          <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-black/30">
            <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full" role="img" aria-label="Rust-backed GJK convex collision scene">
              <defs>
                <marker id="convex-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#fbbf24" />
                </marker>
              </defs>
              <rect width={WIDTH} height={HEIGHT} rx="22" fill="#09090b" />
              <Grid />

              <polygon points={toSvgPoints(model.exactWorldA)} fill="none" stroke="#155e75" strokeWidth="2" strokeDasharray="6 7" strokeOpacity="0.65" />
              <polygon points={toSvgPoints(model.exactWorldB)} fill="none" stroke="#6d28d9" strokeWidth="2" strokeDasharray="6 7" strokeOpacity="0.65" />
              <polygon points={toSvgPoints(model.worldA)} fill="#083344" fillOpacity="0.9" stroke="#67e8f9" strokeWidth="3" />
              <polygon
                points={toSvgPoints(model.worldB)}
                fill={collides ? "#4c0519" : "#2e1065"}
                fillOpacity="0.88"
                stroke={collides ? "#fb7185" : separated ? "#c4b5fd" : "#fbbf24"}
                strokeWidth="3"
              />

              <ShapeLabel point={centroid(model.worldA)} label="A" color="#67e8f9" />
              <ShapeLabel point={centroid(model.worldB)} label="B" color={collides ? "#fb7185" : "#c4b5fd"} />

              {activeStep && supportA && supportB && (
                <>
                  <DirectionArrow direction={direction} />
                  <circle cx={worldX(supportA.x)} cy={worldY(supportA.y)} r="7" fill="#fbbf24" stroke="#09090b" strokeWidth="3" />
                  <circle cx={worldX(supportB.x)} cy={worldY(supportB.y)} r="7" fill="#fbbf24" stroke="#09090b" strokeWidth="3" />
                  <line x1={worldX(supportA.x)} y1={worldY(supportA.y)} x2={worldX(supportB.x)} y2={worldY(supportB.y)} stroke="#fbbf24" strokeDasharray="7 7" strokeOpacity="0.65" />
                </>
              )}
            </svg>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <RangeControl label={`Proxy vertices · ${samples}`} min={3} max={14} step={1} value={samples} onChange={setSamples} />
            <RangeControl label={`Move B · X ${offsetX.toFixed(2)}`} min={-0.1} max={3.6} step={0.05} value={offsetX} onChange={setOffsetX} />
            <RangeControl label={`Move B · Y ${offsetY.toFixed(2)}`} min={-1.8} max={1.8} step={0.05} value={offsetY} onChange={setOffsetY} />
            <RangeControl label={`Rotate B · ${rotationDegrees.toFixed(0)}°`} min={-70} max={70} step={1} value={rotationDegrees} onChange={setRotationDegrees} />
          </div>
        </div>

        <aside className="border-t border-zinc-800 p-5 sm:p-6 xl:border-l xl:border-t-0">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-600">GJK simplex search</p>
          <div className="mt-3 flex items-end justify-between gap-4">
            <div>
              <div className="text-3xl font-semibold text-zinc-100">{activeStep?.iteration ?? 0}</div>
              <div className="mt-1 text-xs text-zinc-600">authoritative support query</div>
            </div>
            <span className="rounded-full border border-zinc-800 px-3 py-1 font-mono text-xs text-zinc-500">{activeStep?.simplex.length ?? 0} simplex pts</span>
          </div>

          <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900/45 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-600">Rust decision</p>
            <p className="mt-2 text-sm leading-6 text-zinc-300">{wasmError ? `WASM initialization failed: ${wasmError}` : wasmReady ? describeStep(activeStep) : "Initializing the Rust geometry kernel in the browser…"}</p>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <Metric label="query d.x" value={wasmReady ? formatNumber(direction.x) : "—"} />
            <Metric label="query d.y" value={wasmReady ? formatNumber(direction.y) : "—"} />
            <Metric label="support x" value={wasmReady ? formatNumber(activeStep?.support.point[0] ?? 0) : "—"} />
            <Metric label="support y" value={wasmReady ? formatNumber(activeStep?.support.point[1] ?? 0) : "—"} />
          </div>

          <div className="mt-5 flex gap-2">
            <button type="button" onClick={() => setStepIndex((value) => Math.max(0, value - 1))} disabled={!wasmReady || activeStepIndex === 0} className="flex-1 rounded-xl border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-300 transition hover:border-zinc-500 disabled:opacity-30">← Previous</button>
            <button type="button" onClick={() => setStepIndex((value) => Math.min(model.trace.steps.length - 1, value + 1))} disabled={!wasmReady || activeStepIndex >= model.trace.steps.length - 1} className="flex-1 rounded-xl border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-300 transition hover:border-zinc-500 disabled:opacity-30">Next →</button>
          </div>

          <div className="mt-6 border-t border-zinc-800 pt-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-600">Witness points</p>
            <p className="mt-2 text-xs leading-5 text-zinc-500">
              The two yellow points are the exact left/right support witnesses returned by Rust for this query. Their difference is the Minkowski support point used by GJK.
            </p>
          </div>
        </aside>
      </div>

      <div className="grid border-t border-zinc-800 lg:grid-cols-2">
        <MinkowskiPanel polygon={model.minkowski} step={activeStep} trace={model.trace} ready={wasmReady} />
        <NextStagePanel trace={model.trace} ready={wasmReady} />
      </div>
    </section>
  );
}

function MinkowskiPanel({ polygon, step, trace, ready }: { polygon: Polygon; step: GjkTraceStep | null; trace: GjkTrace; ready: boolean }) {
  const width = 520;
  const height = 310;
  const scale = 58;
  const ox = width / 2;
  const oy = height / 2;
  const mapX = (x: number) => ox + x * scale;
  const mapY = (y: number) => oy - y * scale;
  const points = polygon.map((point) => `${mapX(point.x)},${mapY(point.y)}`).join(" ");
  const simplex = step?.simplex.map((point) => vec2(point.point)) ?? [];

  return (
    <div className="p-5 sm:p-6 lg:border-r lg:border-zinc-800">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-600">Configuration space</p>
          <h3 className="mt-2 text-xl font-semibold text-zinc-100">Minkowski difference A − B</h3>
        </div>
        <StatusPill trace={trace} ready={ready} />
      </div>
      <div className="mt-4 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/25">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Minkowski difference and Rust GJK simplex">
          <rect width={width} height={height} fill="#09090b" />
          <line x1="20" x2={width - 20} y1={oy} y2={oy} stroke="#27272a" />
          <line x1={ox} x2={ox} y1="20" y2={height - 20} stroke="#27272a" />
          <polygon points={points} fill="#18181b" stroke="#71717a" strokeWidth="2" />
          {simplex.length > 1 && <polyline points={simplex.map((point) => `${mapX(point.x)},${mapY(point.y)}`).join(" ")} fill={simplex.length >= 3 ? "#78350f" : "none"} fillOpacity="0.45" stroke="#fbbf24" strokeWidth="3" />}
          {simplex.map((point, index) => <circle key={`${point.x}-${point.y}-${index}`} cx={mapX(point.x)} cy={mapY(point.y)} r="6" fill="#fbbf24" />)}
          <circle cx={ox} cy={oy} r="7" fill={!ready ? "#fbbf24" : trace.intersection === true ? "#fb7185" : trace.intersection === false ? "#34d399" : "#fbbf24"} stroke="#09090b" strokeWidth="3" />
          <text x={ox + 10} y={oy - 10} fill="#a1a1aa" fontSize="12">origin</text>
        </svg>
      </div>
      <p className="mt-3 text-xs leading-5 text-zinc-600">
        The gray Minkowski boundary is materialized in React only as a teaching reference. GJK does not consume it; every yellow simplex point and support witness above comes from Rust.
      </p>
    </div>
  );
}

function NextStagePanel({ trace, ready }: { trace: GjkTrace; ready: boolean }) {
  return (
    <div className="p-5 sm:p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-600">Next narrow-phase slice</p>
      <h3 className="mt-2 text-xl font-semibold text-zinc-100">EPA should inherit this simplex without moving authority back to the browser.</h3>
      <p className="mt-3 text-sm leading-6 text-zinc-500">
        GJK now ends at a Rust-owned status and simplex. The next roadmap step is a reusable Rust EPA result/trace for penetration depth and normal, followed by stable contact generation. The UI should remain a projection layer.
      </p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <Metric label="terminal status" value={ready ? trace.status : "initializing"} />
        <Metric label="iterations" value={ready ? String(trace.iterations) : "—"} />
        <Metric label="final simplex" value={ready ? `${trace.simplex.length} points` : "—"} />
        <Metric label="truth" value={ready ? (trace.intersection === null ? "indeterminate" : trace.intersection ? "intersecting" : "separated") : "—"} />
      </div>
    </div>
  );
}

function DecisionBadge({ trace, ready, error }: { trace: GjkTrace; ready: boolean; error: string | null }) {
  if (error) {
    return (
      <div className="rounded-2xl border border-rose-900/70 bg-rose-950/35 px-4 py-3 text-rose-200">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] opacity-70">narrow-phase result</div>
        <div className="mt-1 text-lg font-semibold">Unavailable</div>
        <div className="mt-1 font-mono text-xs opacity-60">WASM initialization failed</div>
      </div>
    );
  }
  if (!ready) {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/35 px-4 py-3 text-zinc-300">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] opacity-70">narrow-phase result</div>
        <div className="mt-1 text-lg font-semibold">Initializing</div>
        <div className="mt-1 font-mono text-xs opacity-60">loading Rust geometry kernel</div>
      </div>
    );
  }
  const collides = trace.intersection === true;
  const separated = trace.intersection === false;
  const classes = collides
    ? "border-rose-900/70 bg-rose-950/35 text-rose-200"
    : separated
      ? "border-emerald-900/70 bg-emerald-950/25 text-emerald-200"
      : "border-amber-900/70 bg-amber-950/25 text-amber-200";
  return (
    <div className={`rounded-2xl border px-4 py-3 ${classes}`}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] opacity-70">narrow-phase result</div>
      <div className="mt-1 text-lg font-semibold">{collides ? "Collision" : separated ? "Separated" : "Indeterminate"}</div>
      <div className="mt-1 font-mono text-xs opacity-60">Rust · {trace.status}</div>
    </div>
  );
}

function StatusPill({ trace, ready }: { trace: GjkTrace; ready: boolean }) {
  if (!ready) return <span className="rounded-full border border-zinc-800 px-3 py-1 text-xs font-semibold text-zinc-400">initializing Rust</span>;
  const label = trace.intersection === true ? "origin enclosed" : trace.intersection === false ? "origin excluded" : trace.status;
  return <span className="rounded-full border border-zinc-800 px-3 py-1 text-xs font-semibold text-zinc-400">{label}</span>;
}

function describeStep(step: GjkTraceStep | null): string {
  if (!step) return "No support query available.";
  switch (step.terminalStatus) {
    case "intersecting":
      return "Rust retained a simplex that reaches the origin; GJK terminates as intersecting.";
    case "separated":
      return "This support query cannot advance past the origin in the requested direction; Rust terminates as separated.";
    case "no-progress":
      return "Rust detected a repeated support point and stops with no-progress instead of inventing an overlap result.";
    case "iteration-limit":
      return "The configured iteration bound was reached; Rust reports an indeterminate iteration-limit status.";
    default:
      return step.simplex.length === 1
        ? "Rust retained one Minkowski support point and chose the next search direction."
        : step.simplex.length === 2
          ? "Rust reduced the candidate set to a line simplex and continues toward the origin."
          : "Rust retained a triangle simplex and continues with the returned search direction.";
  }
}

function readRustTrace(left: Polygon, right: Polygon): GjkTrace {
  const leftJson = JSON.stringify(left.map((point) => [point.x, point.y]));
  const rightJson = JSON.stringify(right.map((point) => [point.x, point.y]));
  return JSON.parse(convex_gjk_trace_json(leftJson, rightJson)) as GjkTrace;
}

function Grid() {
  const lines = [];
  for (let x = 40; x < WIDTH; x += 48) lines.push(<line key={`x-${x}`} x1={x} x2={x} y1="0" y2={HEIGHT} stroke="#18181b" />);
  for (let y = 40; y < HEIGHT; y += 48) lines.push(<line key={`y-${y}`} x1="0" x2={WIDTH} y1={y} y2={y} stroke="#18181b" />);
  return <g>{lines}</g>;
}

function ShapeLabel({ point, label, color }: { point: Vec2; label: string; color: string }) {
  return <text x={worldX(point.x)} y={worldY(point.y) + 5} textAnchor="middle" fill={color} fontSize="16" fontWeight="700">{label}</text>;
}

function DirectionArrow({ direction }: { direction: Vec2 }) {
  const normalized = normalizeSafe(direction);
  const start = { x: -3.1, y: 1.65 };
  const end = add(start, scale(normalized, 0.95));
  return (
    <g>
      <line x1={worldX(start.x)} y1={worldY(start.y)} x2={worldX(end.x)} y2={worldY(end.y)} stroke="#fbbf24" strokeWidth="3" markerEnd="url(#convex-arrow)" />
      <text x={worldX(start.x)} y={worldY(start.y) - 12} fill="#fbbf24" fontSize="12" fontWeight="700">Rust query direction d</text>
    </g>
  );
}

function RangeControl({ label, min, max, step, value, onChange }: { label: string; min: number; max: number; step: number; value: number; onChange: (value: number) => void }) {
  return (
    <label className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4 text-xs font-semibold text-zinc-500">
      <span>{label}</span>
      <input className="mt-3 w-full accent-zinc-200" type="range" min={min} max={max} step={step} value={value} onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(Number(event.target.value))} />
    </label>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/35 p-3">
      <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-600">{label}</div>
      <div className="mt-1 font-mono text-xs font-semibold text-zinc-300">{value}</div>
    </div>
  );
}

function polarShape(radii: number[], radiusX: number, radiusY: number, rotation: number): Polygon {
  return radii.map((radius, index) => {
    const angle = (index / radii.length) * Math.PI * 2 + rotation;
    return { x: Math.cos(angle) * radiusX * radius, y: Math.sin(angle) * radiusY * radius };
  });
}

function sampleConvexVertices(polygon: Polygon, requested: number): Polygon {
  const count = Math.max(3, Math.min(requested, polygon.length));
  const selected: Polygon = [];
  for (let index = 0; index < count; index += 1) {
    const sourceIndex = Math.floor((index * polygon.length) / count) % polygon.length;
    const point = polygon[sourceIndex];
    if (point) selected.push(point);
  }
  return selected;
}

function convexHull(points: Polygon): Polygon {
  if (points.length <= 2) return [...points];
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Polygon = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: Polygon = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function transformPolygon(polygon: Polygon, offset: Vec2, rotation: number): Polygon {
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  return polygon.map((point) => ({ x: point.x * cosine - point.y * sine + offset.x, y: point.x * sine + point.y * cosine + offset.y }));
}

function centroid(polygon: Polygon): Vec2 {
  if (polygon.length === 0) return { x: 0, y: 0 };
  const sum = polygon.reduce((current, point) => add(current, point), { x: 0, y: 0 });
  return scale(sum, 1 / polygon.length);
}

function vec2(value: Vec3): Vec2 {
  return { x: value[0], y: value[1] };
}

function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

function subtract(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

function scale(value: Vec2, factor: number): Vec2 {
  return { x: value.x * factor, y: value.y * factor };
}

function normalizeSafe(value: Vec2): Vec2 {
  const length = Math.hypot(value.x, value.y);
  return length > 1e-12 ? scale(value, 1 / length) : { x: 1, y: 0 };
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function worldX(value: number): number {
  return ORIGIN_X + value * SCALE;
}

function worldY(value: number): number {
  return ORIGIN_Y - value * SCALE;
}

function toSvgPoints(polygon: Polygon): string {
  return polygon.map((point) => `${worldX(point.x)},${worldY(point.y)}`).join(" ");
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(3) : "—";
}
