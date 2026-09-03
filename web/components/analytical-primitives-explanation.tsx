"use client";

import { useEffect, useState } from "react";

import initWasm, {
  aabb_aabb_json,
  sphere_sphere_json,
} from "../lib/wasm-pkg/collision_wasm";

type SphereRelation = {
  left: { center: [number, number, number]; radius: number };
  right: { center: [number, number, number]; radius: number };
  centerDistanceSquared: number;
  centerDistance: number;
  radiusSum: number;
  radiusSumSquared: number;
  signedSeparation: number;
  overlaps: boolean;
};

type AabbRelation = {
  left: { min: [number, number, number]; max: [number, number, number] };
  right: { min: [number, number, number]; max: [number, number, number] };
  axisOverlap: [number, number, number];
  overlaps: boolean;
};

const SPHERE_A = { x: -1.4, y: 0, radius: 1.2 };
const BOX_A = { x: -1.2, y: 0, halfX: 1.3, halfY: 0.9 };
const VIEW_MIN = -4.5;
const VIEW_MAX = 4.5;
const SVG_WIDTH = 680;
const SVG_HEIGHT = 300;
const PAD_X = 42;
const PAD_Y = 34;
const VIEW_SPAN = VIEW_MAX - VIEW_MIN;
const WORLD_SCALE = Math.min(
  (SVG_WIDTH - PAD_X * 2) / VIEW_SPAN,
  (SVG_HEIGHT - PAD_Y * 2) / VIEW_SPAN,
);
const WORLD_SIZE = VIEW_SPAN * WORLD_SCALE;
const WORLD_ORIGIN_X = (SVG_WIDTH - WORLD_SIZE) / 2;
const WORLD_ORIGIN_Y = (SVG_HEIGHT - WORLD_SIZE) / 2;

export function AnalyticalPrimitivesExplanation() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sphereX, setSphereX] = useState(1.1);
  const [sphereY, setSphereY] = useState(0.4);
  const [boxX, setBoxX] = useState(1.1);
  const [boxY, setBoxY] = useState(0.4);
  const [sphereRelation, setSphereRelation] = useState<SphereRelation | null>(null);
  const [aabbRelation, setAabbRelation] = useState<AabbRelation | null>(null);

  useEffect(() => {
    let active = true;
    void initWasm()
      .then(() => {
        if (active) setReady(true);
      })
      .catch((reason: unknown) => {
        if (active) setError(String(reason));
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      setSphereRelation(
        JSON.parse(
          sphere_sphere_json(
            SPHERE_A.x,
            SPHERE_A.y,
            0,
            SPHERE_A.radius,
            sphereX,
            sphereY,
            0,
            1,
          ),
        ) as SphereRelation,
      );
      setError(null);
    } catch (reason) {
      setError(String(reason));
    }
  }, [ready, sphereX, sphereY]);

  useEffect(() => {
    if (!ready) return;
    try {
      setAabbRelation(
        JSON.parse(
          aabb_aabb_json(
            BOX_A.x,
            BOX_A.y,
            0,
            BOX_A.halfX,
            BOX_A.halfY,
            0.5,
            boxX,
            boxY,
            0,
            1,
            1.1,
            0.5,
          ),
        ) as AabbRelation,
      );
      setError(null);
    } catch (reason) {
      setError(String(reason));
    }
  }, [boxX, boxY, ready]);

  if (error) {
    return (
      <div className="rounded-2xl border border-red-900/60 bg-red-950/30 p-6 text-sm text-red-300">
        {error}
      </div>
    );
  }

  return (
    <section className="overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-950">
      <div className="border-b border-zinc-800 p-5 sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-600">
          Narrow phase · Analytical primitives
        </p>
        <h2 className="mt-2 text-2xl font-semibold text-zinc-100">
          After the broad phase says “maybe,” test the actual shapes.
        </h2>
        <p className="mt-3 max-w-4xl text-sm leading-6 text-zinc-500">
          Broad phases only produce candidate pairs. These two queries are exact enough to answer the collision question directly for their primitive shapes. Move shape B; every number and boolean below is recomputed by the Rust `geometry-kernels` implementation through WebAssembly.
        </p>
      </div>

      {!ready || !sphereRelation || !aabbRelation ? (
        <div className="grid min-h-[28rem] place-items-center text-sm text-zinc-500">
          Loading analytical Rust kernels…
        </div>
      ) : (
        <div className="grid gap-px bg-zinc-800 xl:grid-cols-2">
          <SphereLesson
            relation={sphereRelation}
            sphereX={sphereX}
            sphereY={sphereY}
            onSphereX={setSphereX}
            onSphereY={setSphereY}
          />
          <AabbLesson
            relation={aabbRelation}
            boxX={boxX}
            boxY={boxY}
            onBoxX={setBoxX}
            onBoxY={setBoxY}
          />
        </div>
      )}
    </section>
  );
}

function SphereLesson({
  relation,
  sphereX,
  sphereY,
  onSphereX,
  onSphereY,
}: {
  relation: SphereRelation;
  sphereX: number;
  sphereY: number;
  onSphereX: (value: number) => void;
  onSphereY: (value: number) => void;
}) {
  const left = relation.left;
  const right = relation.right;
  const touching = Math.abs(relation.signedSeparation) < 0.001;
  const decision = touching ? "touching" : relation.overlaps ? "overlapping" : "separated";

  return (
    <article className="bg-zinc-950 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-600">Sphere ↔ sphere</p>
          <h3 className="mt-2 text-xl font-semibold text-zinc-100">Compare one distance with two radii.</h3>
        </div>
        <DecisionBadge overlaps={relation.overlaps} touching={touching} label={decision} />
      </div>

      <div className="mt-5 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/25 p-2">
        <svg viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`} role="img" aria-label="Sphere sphere analytical collision test" className="w-full">
          <rect width={SVG_WIDTH} height={SVG_HEIGHT} rx="16" fill="#09090b" />
          <line
            x1={sx(left.center[0])}
            y1={sy(left.center[1])}
            x2={sx(right.center[0])}
            y2={sy(right.center[1])}
            stroke="#71717a"
            strokeWidth="2"
            strokeDasharray="7 6"
          />
          <circle
            cx={sx(left.center[0])}
            cy={sy(left.center[1])}
            r={radiusPx(left.radius)}
            fill="#164e63"
            fillOpacity="0.45"
            stroke="#67e8f9"
            strokeWidth="4"
          />
          <circle
            cx={sx(right.center[0])}
            cy={sy(right.center[1])}
            r={radiusPx(right.radius)}
            fill={relation.overlaps ? "#7f1d1d" : "#3f3f46"}
            fillOpacity="0.5"
            stroke={relation.overlaps ? "#fb7185" : "#e4e4e7"}
            strokeWidth="4"
          />
          <PointLabel x={sx(left.center[0])} y={sy(left.center[1])} text="A" />
          <PointLabel x={sx(right.center[0])} y={sy(right.center[1])} text="B" />
          <text x={SVG_WIDTH / 2} y="26" textAnchor="middle" fill="#a1a1aa" fontSize="12">
            center distance d = {relation.centerDistance.toFixed(3)}
          </text>
        </svg>
      </div>

      <Control label={`Move B on X · ${sphereX.toFixed(2)}`} min={-0.2} max={4.2} step={0.05} value={sphereX} onChange={onSphereX} />
      <Control label={`Move B on Y · ${sphereY.toFixed(2)}`} min={-2.2} max={2.2} step={0.05} value={sphereY} onChange={onSphereY} />

      <div className="mt-5 rounded-xl border border-zinc-800 bg-zinc-900/45 p-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-600">Rust decision</p>
        <div className="mt-2 overflow-x-auto font-mono text-sm text-zinc-200">
          d² ≤ (rA + rB)²
        </div>
        <div className="mt-2 font-mono text-sm">
          <span className="text-zinc-300">{relation.centerDistanceSquared.toFixed(3)}</span>
          <span className="mx-2 text-zinc-600">≤</span>
          <span className="text-zinc-300">{relation.radiusSumSquared.toFixed(3)}</span>
          <span className={`ml-3 font-semibold ${relation.overlaps ? "text-emerald-300" : "text-red-300"}`}>
            {relation.overlaps ? "true" : "false"}
          </span>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4">
        <Metric label="d" value={relation.centerDistance.toFixed(3)} />
        <Metric label="rA + rB" value={relation.radiusSum.toFixed(3)} />
        <Metric label="signed gap" value={formatSigned(relation.signedSeparation)} emphasize />
        <Metric label="decision" value={decision} />
      </dl>
      <p className="mt-4 text-xs leading-5 text-zinc-600">
        The boolean does not need a square root: Rust compares squared distance directly. The square root is calculated only to display the signed separation here.
      </p>
    </article>
  );
}

function AabbLesson({
  relation,
  boxX,
  boxY,
  onBoxX,
  onBoxY,
}: {
  relation: AabbRelation;
  boxX: number;
  boxY: number;
  onBoxX: (value: number) => void;
  onBoxY: (value: number) => void;
}) {
  const separatingAxes = relation.axisOverlap
    .map((value, axis) => ({ value, axis }))
    .filter(({ value }) => value < 0);
  const touching = relation.overlaps && relation.axisOverlap.some((value) => Math.abs(value) < 0.001);
  const decision = touching ? "touching" : relation.overlaps ? "overlapping" : "separated";

  return (
    <article className="bg-zinc-950 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-600">AABB ↔ AABB</p>
          <h3 className="mt-2 text-xl font-semibold text-zinc-100">A gap on one axis is enough to reject the pair.</h3>
        </div>
        <DecisionBadge overlaps={relation.overlaps} touching={touching} label={decision} />
      </div>

      <div className="mt-5 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/25 p-2">
        <svg viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`} role="img" aria-label="AABB analytical collision test" className="w-full">
          <rect width={SVG_WIDTH} height={SVG_HEIGHT} rx="16" fill="#09090b" />
          <AabbRect bounds={relation.left} label="A" stroke="#67e8f9" fill="#164e63" />
          <AabbRect
            bounds={relation.right}
            label="B"
            stroke={relation.overlaps ? "#fb7185" : "#e4e4e7"}
            fill={relation.overlaps ? "#7f1d1d" : "#3f3f46"}
          />
          <text x={SVG_WIDTH / 2} y="26" textAnchor="middle" fill="#71717a" fontSize="12">
            shown in XY · Z intervals are fixed and overlapping
          </text>
        </svg>
      </div>

      <Control label={`Move B on X · ${boxX.toFixed(2)}`} min={-0.4} max={4.2} step={0.05} value={boxX} onChange={onBoxX} />
      <Control label={`Move B on Y · ${boxY.toFixed(2)}`} min={-2.6} max={2.6} step={0.05} value={boxY} onChange={onBoxY} />

      <div className="mt-5 rounded-xl border border-zinc-800 bg-zinc-900/45 p-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-600">Signed interval overlap from Rust</p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {relation.axisOverlap.map((value, axis) => (
            <div key={axis} className={`rounded-lg border p-3 ${value < 0 ? "border-red-900/70 bg-red-950/25" : value === 0 ? "border-yellow-800/60 bg-yellow-950/20" : "border-zinc-800 bg-zinc-950/50"}`}>
              <div className="text-[10px] uppercase tracking-wide text-zinc-600">{axisName(axis)}</div>
              <div className={`mt-1 font-mono text-sm font-semibold ${value < 0 ? "text-red-300" : value === 0 ? "text-yellow-300" : "text-emerald-300"}`}>
                {formatSigned(value)}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs leading-5 text-zinc-500">
          Collision iff X ≥ 0 AND Y ≥ 0 AND Z ≥ 0. {separatingAxes.length ? `Separating ${separatingAxes.length === 1 ? "axis" : "axes"}: ${separatingAxes.map(({ axis }) => axisName(axis)).join(", ")}.` : "No separating axis exists."}
        </p>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4">
        <Metric label="X overlap" value={formatSigned(relation.axisOverlap[0])} />
        <Metric label="Y overlap" value={formatSigned(relation.axisOverlap[1])} />
        <Metric label="Z overlap" value={formatSigned(relation.axisOverlap[2])} />
        <Metric label="decision" value={decision} />
      </dl>
      <p className="mt-4 text-xs leading-5 text-zinc-600">
        This is already the central idea behind SAT: find a separating axis. For AABBs the candidate axes are simply world X, Y, and Z; OBB/SAT generalizes which axes must be tested.
      </p>
    </article>
  );
}

function AabbRect({
  bounds,
  label,
  stroke,
  fill,
}: {
  bounds: { min: [number, number, number]; max: [number, number, number] };
  label: string;
  stroke: string;
  fill: string;
}) {
  const x = sx(bounds.min[0]);
  const y = sy(bounds.max[1]);
  const width = sx(bounds.max[0]) - x;
  const height = sy(bounds.min[1]) - y;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx="8" fill={fill} fillOpacity="0.55" stroke={stroke} strokeWidth="4" />
      <text x={x + width / 2} y={y + height / 2 + 6} textAnchor="middle" fill="#fafafa" fontSize="18" fontWeight="700">{label}</text>
    </g>
  );
}

function PointLabel({ x, y, text }: { x: number; y: number; text: string }) {
  return (
    <g>
      <circle cx={x} cy={y} r="5" fill="#fafafa" />
      <text x={x + 10} y={y - 10} fill="#fafafa" fontSize="14" fontWeight="700">{text}</text>
    </g>
  );
}

function DecisionBadge({ overlaps, touching, label }: { overlaps: boolean; touching: boolean; label: string }) {
  const classes = touching
    ? "border-yellow-700/60 bg-yellow-950/25 text-yellow-300"
    : overlaps
      ? "border-emerald-700/60 bg-emerald-950/30 text-emerald-300"
      : "border-red-800/60 bg-red-950/25 text-red-300";
  return <span className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${classes}`}>{label}</span>;
}

function Control({ label, min, max, step, value, onChange }: { label: string; min: number; max: number; step: number; value: number; onChange: (value: number) => void }) {
  return (
    <label className="mt-4 block text-xs font-semibold text-zinc-400">
      {label}
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} className="mt-2 w-full accent-zinc-100" />
    </label>
  );
}

function Metric({ label, value, emphasize = false }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/45 p-3">
      <dt className="text-[10px] uppercase tracking-wide text-zinc-600">{label}</dt>
      <dd className={`mt-1 break-words font-mono text-sm ${emphasize ? "font-semibold text-zinc-100" : "text-zinc-300"}`}>{value}</dd>
    </div>
  );
}

function sx(value: number) {
  return WORLD_ORIGIN_X + (value - VIEW_MIN) * WORLD_SCALE;
}
function sy(value: number) {
  return WORLD_ORIGIN_Y + (VIEW_MAX - value) * WORLD_SCALE;
}
function radiusPx(radius: number) {
  return radius * WORLD_SCALE;
}
function formatSigned(value: number) {
  const normalized = Math.abs(value) < 0.0005 ? 0 : value;
  return `${normalized >= 0 ? "+" : ""}${normalized.toFixed(3)}`;
}
function axisName(axis: number) {
  return axis === 0 ? "X" : axis === 1 ? "Y" : "Z";
}
