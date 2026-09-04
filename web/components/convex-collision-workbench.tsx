"use client";

import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "react";

type Vec2 = { x: number; y: number };
type Polygon = Vec2[];

type GjkStep = {
  iteration: number;
  direction: Vec2;
  support: Vec2;
  simplex: Polygon;
  decision: string;
};

type GjkResult = {
  collides: boolean;
  simplex: Polygon;
  steps: GjkStep[];
};

type EpaStep = {
  iteration: number;
  edgeA: Vec2;
  edgeB: Vec2;
  normal: Vec2;
  edgeDistance: number;
  supportDistance: number;
  support: Vec2;
  polytope: Polygon;
};

type EpaResult = {
  normal: Vec2;
  depth: number;
  steps: EpaStep[];
};

const WIDTH = 860;
const HEIGHT = 470;
const SCALE = 96;
const ORIGIN_X = 360;
const ORIGIN_Y = 235;

const SOURCE_A = polarShape([
  1.0, 1.06, 0.92, 1.12, 0.98, 1.04, 0.9, 1.08,
  1.02, 0.94, 1.1, 0.96, 1.04, 0.91, 1.08, 0.98,
], 1.18, 0.86, 0.08);

const SOURCE_B = polarShape([
  1.0, 0.93, 1.08, 0.96, 1.12, 0.9, 1.03, 1.09,
  0.95, 1.05, 0.92, 1.1, 0.98, 1.04,
], 1.0, 0.72, -0.06);

export function ConvexCollisionWorkbench() {
  const [samples, setSamples] = useState(8);
  const [offsetX, setOffsetX] = useState(1.55);
  const [offsetY, setOffsetY] = useState(0.12);
  const [rotationDegrees, setRotationDegrees] = useState(-18);
  const [stepIndex, setStepIndex] = useState(0);
  const [epaStepIndex, setEpaStepIndex] = useState(0);

  const model = useMemo(() => {
    const exactA = convexHull(SOURCE_A);
    const exactB = convexHull(SOURCE_B);
    const proxyA = approximateConvex(exactA, samples);
    const proxyB = approximateConvex(exactB, samples);
    const worldA = transformPolygon(proxyA, { x: -1.25, y: 0 }, 0);
    const worldB = transformPolygon(proxyB, { x: offsetX, y: offsetY }, degreesToRadians(rotationDegrees));
    const gjk = gjkIntersect(worldA, worldB);
    const epa = gjk.collides ? epaPenetration(worldA, worldB, gjk.simplex) : null;
    const minkowski = convexHull(
      worldA.flatMap((left) => worldB.map((right) => subtract(left, right))),
    );

    return {
      exactA,
      exactB,
      proxyA,
      proxyB,
      worldA,
      worldB,
      gjk,
      epa,
      minkowski,
    };
  }, [offsetX, offsetY, rotationDegrees, samples]);

  useEffect(() => {
    setStepIndex(0);
    setEpaStepIndex(0);
  }, [offsetX, offsetY, rotationDegrees, samples]);

  const activeStepIndex = Math.min(stepIndex, Math.max(0, model.gjk.steps.length - 1));
  const activeStep = model.gjk.steps[activeStepIndex] ?? null;
  const activeEpaIndex = Math.min(epaStepIndex, Math.max(0, (model.epa?.steps.length ?? 1) - 1));
  const activeEpa = model.epa?.steps[activeEpaIndex] ?? null;
  const direction = activeStep?.direction ?? { x: 1, y: 0 };
  const supportA = supportPoint(model.worldA, direction);
  const supportB = supportPoint(model.worldB, negate(direction));

  return (
    <section className="overflow-hidden rounded-[2rem] border border-zinc-800 bg-zinc-950 shadow-2xl shadow-black/20">
      <div className="border-b border-zinc-800 bg-zinc-900/35 px-5 py-5 sm:px-7">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-600">Interactive convex narrow phase</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-100 sm:text-3xl">Move the shapes. Watch the proof change.</h2>
            <p className="mt-3 text-sm leading-6 text-zinc-500">
              The visible polygons are low-vertex convex proxies. GJK never needs their full Minkowski difference; it asks only for extreme support points in carefully chosen directions. When the origin is enclosed, EPA expands that simplex to estimate how far the shapes penetrate.
            </p>
          </div>
          <DecisionBadge collides={model.gjk.collides} depth={model.epa?.depth ?? null} />
        </div>
      </div>

      <div className="grid xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="p-4 sm:p-6">
          <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-black/30">
            <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full" role="img" aria-label="Interactive GJK convex collision scene">
              <defs>
                <marker id="convex-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#fbbf24" />
                </marker>
              </defs>
              <rect width={WIDTH} height={HEIGHT} rx="22" fill="#09090b" />
              <Grid />

              <polygon points={toSvgPoints(model.worldA)} fill="#083344" fillOpacity="0.9" stroke="#67e8f9" strokeWidth="3" />
              <polygon
                points={toSvgPoints(model.worldB)}
                fill={model.gjk.collides ? "#4c0519" : "#2e1065"}
                fillOpacity="0.88"
                stroke={model.gjk.collides ? "#fb7185" : "#c4b5fd"}
                strokeWidth="3"
              />

              <ShapeLabel point={centroid(model.worldA)} label="A" color="#67e8f9" />
              <ShapeLabel point={centroid(model.worldB)} label="B" color={model.gjk.collides ? "#fb7185" : "#c4b5fd"} />

              {activeStep && (
                <>
                  <DirectionArrow direction={activeStep.direction} />
                  <circle cx={worldX(supportA.x)} cy={worldY(supportA.y)} r="7" fill="#fbbf24" stroke="#09090b" strokeWidth="3" />
                  <circle cx={worldX(supportB.x)} cy={worldY(supportB.y)} r="7" fill="#fbbf24" stroke="#09090b" strokeWidth="3" />
                  <line
                    x1={worldX(supportA.x)}
                    y1={worldY(supportA.y)}
                    x2={worldX(supportB.x)}
                    y2={worldY(supportB.y)}
                    stroke="#fbbf24"
                    strokeDasharray="7 7"
                    strokeOpacity="0.65"
                  />
                </>
              )}

              {model.epa && (
                <g>
                  <line
                    x1={worldX(centroid(model.worldB).x)}
                    y1={worldY(centroid(model.worldB).y)}
                    x2={worldX(centroid(model.worldB).x + model.epa.normal.x * model.epa.depth)}
                    y2={worldY(centroid(model.worldB).y + model.epa.normal.y * model.epa.depth)}
                    stroke="#fb7185"
                    strokeWidth="4"
                    markerEnd="url(#convex-arrow)"
                  />
                </g>
              )}
            </svg>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <RangeControl label={`Proxy directions · ${samples}`} min={3} max={16} step={1} value={samples} onChange={setSamples} />
            <RangeControl label={`Move B · X ${offsetX.toFixed(2)}`} min={-0.1} max={3.6} step={0.05} value={offsetX} onChange={setOffsetX} />
            <RangeControl label={`Move B · Y ${offsetY.toFixed(2)}`} min={-1.8} max={1.8} step={0.05} value={offsetY} onChange={setOffsetY} />
            <RangeControl label={`Rotate B · ${rotationDegrees.toFixed(0)}°`} min={-70} max={70} step={1} value={rotationDegrees} onChange={setRotationDegrees} />
          </div>
        </div>

        <aside className="border-t border-zinc-800 p-5 sm:p-6 xl:border-l xl:border-t-0">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-600">GJK simplex search</p>
          <div className="mt-3 flex items-end justify-between gap-4">
            <div>
              <div className="text-3xl font-semibold text-zinc-100">{activeStep ? activeStep.iteration + 1 : 0}</div>
              <div className="mt-1 text-xs text-zinc-600">support queries shown</div>
            </div>
            <span className="rounded-full border border-zinc-800 px-3 py-1 font-mono text-xs text-zinc-500">
              simplex {activeStep?.simplex.length ?? 0}D
            </span>
          </div>

          <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900/45 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-600">Current question</p>
            <p className="mt-2 text-sm leading-6 text-zinc-300">{activeStep?.decision ?? "No support query yet."}</p>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <Metric label="direction x" value={formatNumber(direction.x)} />
            <Metric label="direction y" value={formatNumber(direction.y)} />
            <Metric label="proxy A" value={`${model.worldA.length} verts`} />
            <Metric label="proxy B" value={`${model.worldB.length} verts`} />
          </div>

          <div className="mt-5 flex gap-2">
            <button type="button" onClick={() => setStepIndex((value) => Math.max(0, value - 1))} disabled={activeStepIndex === 0} className="flex-1 rounded-xl border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-300 transition hover:border-zinc-500 disabled:opacity-30">← Previous</button>
            <button type="button" onClick={() => setStepIndex((value) => Math.min(model.gjk.steps.length - 1, value + 1))} disabled={activeStepIndex >= model.gjk.steps.length - 1} className="flex-1 rounded-xl border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-300 transition hover:border-zinc-500 disabled:opacity-30">Next →</button>
          </div>

          <div className="mt-6 border-t border-zinc-800 pt-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-600">What the yellow points mean</p>
            <p className="mt-2 text-xs leading-5 text-zinc-500">
              For direction d, choose A&apos;s furthest point along d and B&apos;s furthest point along −d. Their difference is one extreme point of A − B. That support operation is the only shape-specific primitive GJK needs.
            </p>
          </div>
        </aside>
      </div>

      <div className="grid border-t border-zinc-800 lg:grid-cols-2">
        <MinkowskiPanel polygon={model.minkowski} step={activeStep} collides={model.gjk.collides} />
        <EpaPanel result={model.epa} activeStep={activeEpa} activeIndex={activeEpaIndex} setActiveIndex={setEpaStepIndex} />
      </div>
    </section>
  );
}

function MinkowskiPanel({ polygon, step, collides }: { polygon: Polygon; step: GjkStep | null; collides: boolean }) {
  const width = 520;
  const height = 310;
  const scale = 58;
  const ox = width / 2;
  const oy = height / 2;
  const mapX = (x: number) => ox + x * scale;
  const mapY = (y: number) => oy - y * scale;
  const points = polygon.map((point) => `${mapX(point.x)},${mapY(point.y)}`).join(" ");
  const simplex = step?.simplex ?? [];

  return (
    <div className="p-5 sm:p-6 lg:border-r lg:border-zinc-800">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-600">Configuration space</p>
          <h3 className="mt-2 text-xl font-semibold text-zinc-100">Minkowski difference A − B</h3>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${collides ? "border-rose-900/70 bg-rose-950/40 text-rose-300" : "border-emerald-900/70 bg-emerald-950/30 text-emerald-300"}`}>
          origin {collides ? "inside" : "outside"}
        </span>
      </div>
      <div className="mt-4 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/25">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Minkowski difference and GJK simplex">
          <rect width={width} height={height} fill="#09090b" />
          <line x1="20" x2={width - 20} y1={oy} y2={oy} stroke="#27272a" />
          <line x1={ox} x2={ox} y1="20" y2={height - 20} stroke="#27272a" />
          <polygon points={points} fill="#18181b" stroke="#71717a" strokeWidth="2" />
          {simplex.length > 1 && <polyline points={simplex.map((point) => `${mapX(point.x)},${mapY(point.y)}`).join(" ")} fill={simplex.length === 3 ? "#78350f" : "none"} fillOpacity="0.45" stroke="#fbbf24" strokeWidth="3" />}
          {simplex.map((point, index) => <circle key={`${point.x}-${point.y}-${index}`} cx={mapX(point.x)} cy={mapY(point.y)} r="6" fill="#fbbf24" />)}
          <circle cx={ox} cy={oy} r="7" fill={collides ? "#fb7185" : "#34d399"} stroke="#09090b" strokeWidth="3" />
          <text x={ox + 10} y={oy - 10} fill="#a1a1aa" fontSize="12">origin</text>
        </svg>
      </div>
      <p className="mt-3 text-xs leading-5 text-zinc-600">
        The gray boundary is materialized only for teaching. GJK normally avoids constructing it: support queries jump directly to the boundary points that matter.
      </p>
    </div>
  );
}

function EpaPanel({
  result,
  activeStep,
  activeIndex,
  setActiveIndex,
}: {
  result: EpaResult | null;
  activeStep: EpaStep | null;
  activeIndex: number;
  setActiveIndex: (value: number | ((current: number) => number)) => void;
}) {
  return (
    <div className="p-5 sm:p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-600">After GJK · EPA</p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h3 className="text-xl font-semibold text-zinc-100">Expand the simplex to the nearest boundary.</h3>
          <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-500">
            EPA repeatedly selects the polytope edge closest to the origin, asks for one more support point in that edge normal, and stops when the new point cannot extend the boundary meaningfully.
          </p>
        </div>
        {result && (
          <div className="rounded-2xl border border-rose-900/60 bg-rose-950/25 px-4 py-3 text-right">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-rose-400/70">penetration estimate</div>
            <div className="mt-1 font-mono text-lg font-semibold text-rose-200">{result.depth.toFixed(3)}</div>
          </div>
        )}
      </div>

      {!result || !activeStep ? (
        <div className="mt-5 grid min-h-48 place-items-center rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/20 px-6 text-center text-sm leading-6 text-zinc-600">
          Separate the shapes and EPA has nothing to resolve. Move B into A to see penetration depth and normal emerge after GJK proves overlap.
        </div>
      ) : (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <Metric label="edge distance" value={activeStep.edgeDistance.toFixed(3)} />
            <Metric label="support distance" value={activeStep.supportDistance.toFixed(3)} />
            <Metric label="expansion gap" value={(activeStep.supportDistance - activeStep.edgeDistance).toFixed(4)} />
          </div>
          <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900/35 p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-600">Expansion step</p>
                <div className="mt-1 font-mono text-sm text-zinc-300">{activeStep.iteration + 1} / {result.steps.length}</div>
              </div>
              <div className="text-right font-mono text-xs text-zinc-500">
                n = ({formatNumber(activeStep.normal.x)}, {formatNumber(activeStep.normal.y)})
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setActiveIndex((value) => Math.max(0, value - 1))} disabled={activeIndex === 0} className="flex-1 rounded-xl border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-300 disabled:opacity-30">← Previous</button>
              <button type="button" onClick={() => setActiveIndex((value) => Math.min(result.steps.length - 1, value + 1))} disabled={activeIndex >= result.steps.length - 1} className="flex-1 rounded-xl border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-300 disabled:opacity-30">Next →</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function DecisionBadge({ collides, depth }: { collides: boolean; depth: number | null }) {
  return (
    <div className={`rounded-2xl border px-4 py-3 ${collides ? "border-rose-900/70 bg-rose-950/35" : "border-emerald-900/70 bg-emerald-950/25"}`}>
      <div className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${collides ? "text-rose-400/70" : "text-emerald-400/70"}`}>narrow-phase result</div>
      <div className={`mt-1 text-lg font-semibold ${collides ? "text-rose-200" : "text-emerald-200"}`}>{collides ? "Collision" : "Separated"}</div>
      <div className="mt-1 font-mono text-xs text-zinc-600">{depth === null ? "GJK boolean" : `EPA depth ${depth.toFixed(3)}`}</div>
    </div>
  );
}

function Grid() {
  const lines = [];
  for (let x = 40; x < WIDTH; x += 48) {
    lines.push(<line key={`x-${x}`} x1={x} x2={x} y1="0" y2={HEIGHT} stroke="#18181b" />);
  }
  for (let y = 40; y < HEIGHT; y += 48) {
    lines.push(<line key={`y-${y}`} x1="0" x2={WIDTH} y1={y} y2={y} stroke="#18181b" />);
  }
  return <g>{lines}</g>;
}

function ShapeLabel({ point, label, color }: { point: Vec2; label: string; color: string }) {
  return <text x={worldX(point.x)} y={worldY(point.y) + 5} textAnchor="middle" fill={color} fontSize="16" fontWeight="700">{label}</text>;
}

function DirectionArrow({ direction }: { direction: Vec2 }) {
  const normalized = normalize(direction);
  const start = { x: -3.1, y: 1.65 };
  const end = add(start, scale(normalized, 0.95));
  return (
    <g>
      <line x1={worldX(start.x)} y1={worldY(start.y)} x2={worldX(end.x)} y2={worldY(end.y)} stroke="#fbbf24" strokeWidth="3" markerEnd="url(#convex-arrow)" />
      <text x={worldX(start.x)} y={worldY(start.y) - 12} fill="#fbbf24" fontSize="12" fontWeight="700">support direction d</text>
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

function gjkIntersect(left: Polygon, right: Polygon): GjkResult {
  let direction = subtract(centroid(right), centroid(left));
  if (lengthSquared(direction) < 1e-10) direction = { x: 1, y: 0 };

  const simplex: Polygon = [];
  const steps: GjkStep[] = [];
  let point = supportMinkowski(left, right, direction);
  simplex.unshift(point);
  direction = negate(point);
  steps.push({
    iteration: 0,
    direction: normalizeSafe(direction),
    support: point,
    simplex: [...simplex],
    decision: "Start from one extreme point of A − B, then search back toward the origin.",
  });

  for (let iteration = 1; iteration < 24; iteration += 1) {
    if (lengthSquared(direction) < 1e-12) {
      return { collides: true, simplex: [...simplex], steps };
    }

    point = supportMinkowski(left, right, direction);
    const advance = dot(point, direction);
    if (advance < 0) {
      steps.push({
        iteration,
        direction: normalizeSafe(direction),
        support: point,
        simplex: [...simplex],
        decision: "The next support point cannot pass the origin in this direction, so the Minkowski difference cannot contain the origin.",
      });
      return { collides: false, simplex: [...simplex], steps };
    }

    simplex.unshift(point);
    const handled = handleSimplex(simplex);
    direction = handled.direction;
    simplex.splice(0, simplex.length, ...handled.simplex);
    steps.push({
      iteration,
      direction: normalizeSafe(direction),
      support: point,
      simplex: [...simplex],
      decision: handled.containsOrigin
        ? "The simplex encloses the origin. GJK has proved that the two convex proxies overlap."
        : simplex.length === 2
          ? "Keep the line segment that can still approach the origin and search perpendicular to it."
          : "Keep the triangle region that can still contain the origin and continue with another support query.",
    });

    if (handled.containsOrigin) {
      return { collides: true, simplex: [...simplex], steps };
    }
  }

  return { collides: false, simplex: [...simplex], steps };
}

function handleSimplex(simplex: Polygon): { containsOrigin: boolean; simplex: Polygon; direction: Vec2 } {
  const a = simplex[0];
  if (!a) return { containsOrigin: false, simplex: [], direction: { x: 1, y: 0 } };
  const ao = negate(a);

  if (simplex.length === 1) {
    return { containsOrigin: false, simplex: [a], direction: ao };
  }

  const b = simplex[1];
  if (!b) return { containsOrigin: false, simplex: [a], direction: ao };
  const ab = subtract(b, a);

  if (simplex.length === 2) {
    if (dot(ab, ao) > 0) {
      return { containsOrigin: false, simplex: [a, b], direction: perpendicularToward(ab, ao) };
    }
    return { containsOrigin: false, simplex: [a], direction: ao };
  }

  const c = simplex[2];
  if (!c) return { containsOrigin: false, simplex: [a, b], direction: perpendicularToward(ab, ao) };
  const ac = subtract(c, a);
  const abPerp = tripleProduct(ac, ab, ab);
  if (dot(abPerp, ao) > 0) {
    return { containsOrigin: false, simplex: [a, b], direction: normalizeFallback(abPerp, perpendicularToward(ab, ao)) };
  }

  const acPerp = tripleProduct(ab, ac, ac);
  if (dot(acPerp, ao) > 0) {
    return { containsOrigin: false, simplex: [a, c], direction: normalizeFallback(acPerp, perpendicularToward(ac, ao)) };
  }

  return { containsOrigin: true, simplex: [a, b, c], direction: { x: 0, y: 0 } };
}

function epaPenetration(left: Polygon, right: Polygon, simplex: Polygon): EpaResult | null {
  let polytope = convexHull(simplex);
  if (polytope.length < 3) return null;

  const steps: EpaStep[] = [];
  let bestNormal = { x: 1, y: 0 };
  let bestDistance = 0;

  for (let iteration = 0; iteration < 32; iteration += 1) {
    let closestDistance = Number.POSITIVE_INFINITY;
    let closestNormal = { x: 1, y: 0 };
    let closestIndex = 0;

    for (let index = 0; index < polytope.length; index += 1) {
      const a = polytope[index];
      const b = polytope[(index + 1) % polytope.length];
      if (!a || !b) continue;
      const edge = subtract(b, a);
      let normal = normalizeSafe({ x: edge.y, y: -edge.x });
      let distance = dot(normal, a);
      if (distance < 0) {
        normal = negate(normal);
        distance = -distance;
      }
      if (distance < closestDistance) {
        closestDistance = distance;
        closestNormal = normal;
        closestIndex = index;
      }
    }

    const support = supportMinkowski(left, right, closestNormal);
    const supportDistance = dot(closestNormal, support);
    const edgeA = polytope[closestIndex];
    const edgeB = polytope[(closestIndex + 1) % polytope.length];
    if (!edgeA || !edgeB) return null;

    steps.push({
      iteration,
      edgeA,
      edgeB,
      normal: closestNormal,
      edgeDistance: closestDistance,
      supportDistance,
      support,
      polytope: [...polytope],
    });

    bestNormal = closestNormal;
    bestDistance = closestDistance;

    if (supportDistance - closestDistance < 0.0025) {
      return { normal: bestNormal, depth: bestDistance, steps };
    }

    const duplicate = polytope.some((point) => distanceSquared(point, support) < 1e-10);
    if (duplicate) {
      return { normal: bestNormal, depth: bestDistance, steps };
    }

    polytope = [
      ...polytope.slice(0, closestIndex + 1),
      support,
      ...polytope.slice(closestIndex + 1),
    ];
  }

  return { normal: bestNormal, depth: bestDistance, steps };
}

function supportMinkowski(left: Polygon, right: Polygon, direction: Vec2): Vec2 {
  return subtract(supportPoint(left, direction), supportPoint(right, negate(direction)));
}

function supportPoint(polygon: Polygon, direction: Vec2): Vec2 {
  let best = polygon[0] ?? { x: 0, y: 0 };
  let bestProjection = dot(best, direction);
  for (let index = 1; index < polygon.length; index += 1) {
    const point = polygon[index];
    if (!point) continue;
    const projection = dot(point, direction);
    if (projection > bestProjection) {
      best = point;
      bestProjection = projection;
    }
  }
  return best;
}

function approximateConvex(polygon: Polygon, samples: number): Polygon {
  const supportSamples: Polygon = [];
  for (let index = 0; index < samples; index += 1) {
    const angle = (index / samples) * Math.PI * 2;
    supportSamples.push(supportPoint(polygon, { x: Math.cos(angle), y: Math.sin(angle) }));
  }
  return convexHull(uniquePoints(supportSamples));
}

function convexHull(points: Polygon): Polygon {
  const unique = uniquePoints(points).sort((a, b) => a.x - b.x || a.y - b.y);
  if (unique.length <= 2) return unique;

  const lower: Polygon = [];
  for (const point of unique) {
    while (lower.length >= 2) {
      const a = lower[lower.length - 2];
      const b = lower[lower.length - 1];
      if (!a || !b || cross(subtract(b, a), subtract(point, b)) > 0) break;
      lower.pop();
    }
    lower.push(point);
  }

  const upper: Polygon = [];
  for (let index = unique.length - 1; index >= 0; index -= 1) {
    const point = unique[index];
    if (!point) continue;
    while (upper.length >= 2) {
      const a = upper[upper.length - 2];
      const b = upper[upper.length - 1];
      if (!a || !b || cross(subtract(b, a), subtract(point, b)) > 0) break;
      upper.pop();
    }
    upper.push(point);
  }

  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function polarShape(radii: number[], scaleX: number, scaleY: number, phase: number): Polygon {
  return radii.map((radius, index) => {
    const angle = phase + (index / radii.length) * Math.PI * 2;
    return { x: Math.cos(angle) * radius * scaleX, y: Math.sin(angle) * radius * scaleY };
  });
}

function transformPolygon(polygon: Polygon, translation: Vec2, rotation: number): Polygon {
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  return polygon.map((point) => ({
    x: point.x * cosine - point.y * sine + translation.x,
    y: point.x * sine + point.y * cosine + translation.y,
  }));
}

function centroid(polygon: Polygon): Vec2 {
  if (polygon.length === 0) return { x: 0, y: 0 };
  const sum = polygon.reduce((current, point) => add(current, point), { x: 0, y: 0 });
  return scale(sum, 1 / polygon.length);
}

function uniquePoints(points: Polygon): Polygon {
  const seen = new Set<string>();
  return points.filter((point) => {
    const key = `${point.x.toFixed(8)}:${point.y.toFixed(8)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function tripleProduct(a: Vec2, b: Vec2, c: Vec2): Vec2 {
  const ac = dot(a, c);
  const bc = dot(b, c);
  return subtract(scale(b, ac), scale(a, bc));
}

function perpendicularToward(edge: Vec2, toward: Vec2): Vec2 {
  let perpendicular = { x: -edge.y, y: edge.x };
  if (dot(perpendicular, toward) < 0) perpendicular = negate(perpendicular);
  return normalizeFallback(perpendicular, toward);
}

function normalizeFallback(value: Vec2, fallback: Vec2): Vec2 {
  return lengthSquared(value) < 1e-12 ? normalizeSafe(fallback) : value;
}

function normalizeSafe(value: Vec2): Vec2 {
  const magnitude = Math.sqrt(lengthSquared(value));
  if (magnitude < 1e-12) return { x: 1, y: 0 };
  return { x: value.x / magnitude, y: value.y / magnitude };
}

function normalize(value: Vec2): Vec2 {
  return normalizeSafe(value);
}

function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

function subtract(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

function negate(value: Vec2): Vec2 {
  return { x: -value.x, y: -value.y };
}

function scale(value: Vec2, factor: number): Vec2 {
  return { x: value.x * factor, y: value.y * factor };
}

function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

function cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}

function lengthSquared(value: Vec2): number {
  return dot(value, value);
}

function distanceSquared(a: Vec2, b: Vec2): number {
  return lengthSquared(subtract(a, b));
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

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function formatNumber(value: number): string {
  return value.toFixed(3);
}
