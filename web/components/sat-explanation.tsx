"use client";

import { useEffect, useMemo, useState } from "react";

import initWasm, { obb2_sat_json } from "../lib/wasm-pkg/collision_wasm";

type SatAxis = {
  index: number;
  label: string;
  axis: [number, number];
  leftRadius: number;
  rightRadius: number;
  centerDistance: number;
  signedOverlap: number;
  separating: boolean;
  critical: boolean;
};

type SatRelation = {
  left: {
    center: [number, number];
    halfExtents: [number, number];
    rotationRadians: number;
  };
  right: {
    center: [number, number];
    halfExtents: [number, number];
    rotationRadians: number;
  };
  axes: SatAxis[];
  criticalAxis: number;
  overlaps: boolean;
};

const LEFT = {
  x: -0.8,
  y: 0,
  halfX: 1.45,
  halfY: 0.72,
  rotation: degreesToRadians(22),
};
const WIDTH = 760;
const HEIGHT = 390;
const WORLD_SCALE = 62;
const ORIGIN_X = WIDTH / 2;
const ORIGIN_Y = 185;

export function SatExplanation() {
  const [ready, setReady] = useState(false);
  const [rightX, setRightX] = useState(1.45);
  const [rightY, setRightY] = useState(0.25);
  const [rightRotationDegrees, setRightRotationDegrees] = useState(-28);
  const [axisIndex, setAxisIndex] = useState(0);
  const [relation, setRelation] = useState<SatRelation | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      const next = JSON.parse(
        obb2_sat_json(
          LEFT.x,
          LEFT.y,
          LEFT.halfX,
          LEFT.halfY,
          LEFT.rotation,
          rightX,
          rightY,
          1.05,
          0.82,
          degreesToRadians(rightRotationDegrees),
        ),
      ) as SatRelation;
      setRelation(next);
      setAxisIndex((current) => Math.min(current, next.axes.length - 1));
      setError(null);
    } catch (reason) {
      setError(String(reason));
    }
  }, [ready, rightRotationDegrees, rightX, rightY]);

  const selected = relation?.axes[axisIndex] ?? null;
  const firstSeparator = useMemo(
    () => relation?.axes.find((axis) => axis.separating) ?? null,
    [relation],
  );

  if (error) {
    return (
      <div className="rounded-2xl border border-red-900/60 bg-red-950/30 p-6 text-sm text-red-300">
        {error}
      </div>
    );
  }
  if (!ready || !relation || !selected) {
    return (
      <div className="grid min-h-[30rem] place-items-center rounded-3xl border border-zinc-800 bg-zinc-950 text-sm text-zinc-500">
        Loading the Rust SAT relation…
      </div>
    );
  }

  return (
    <section className="overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-950">
      <div className="border-b border-zinc-800 p-5 sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-600">
          Narrow phase · Separating Axis Theorem
        </p>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-4xl">
            <h2 className="text-2xl font-semibold text-zinc-100">
              Oriented boxes bring their own candidate axes.
            </h2>
            <p className="mt-3 text-sm leading-6 text-zinc-500">
              AABBs only needed world X/Y/Z. These rectangles are rotated, so SAT projects both shapes onto the two local axes of A and the two local axes of B. If even one projection has a gap, the rectangles cannot intersect.
            </p>
          </div>
          <DecisionBadge overlaps={relation.overlaps} />
        </div>
      </div>

      <div className="grid xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="p-4 sm:p-6">
          <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/25 p-2 sm:p-4">
            <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="OBB Separating Axis Theorem step-through" className="w-full">
              <rect width={WIDTH} height={HEIGHT} rx="18" fill="#09090b" />
              <g opacity="0.28">
                <line x1="30" x2={WIDTH - 30} y1={ORIGIN_Y} y2={ORIGIN_Y} stroke="#52525b" />
                <line x1={ORIGIN_X} x2={ORIGIN_X} y1="30" y2="330" stroke="#52525b" />
              </g>

              <ObbShape shape={relation.left} label="A" stroke="#67e8f9" fill="#164e63" />
              <ObbShape
                shape={relation.right}
                label="B"
                stroke={relation.overlaps ? "#fb7185" : "#e4e4e7"}
                fill={relation.overlaps ? "#7f1d1d" : "#3f3f46"}
              />

              <AxisLine axis={selected.axis} separating={selected.separating} label={selected.label} />

              <g transform="translate(70 320)">
                <ProjectionStrip axis={selected} />
              </g>
            </svg>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <Control label={`Move B on X · ${rightX.toFixed(2)}`} min={-0.3} max={4.4} step={0.05} value={rightX} onChange={setRightX} />
            <Control label={`Move B on Y · ${rightY.toFixed(2)}`} min={-2.2} max={2.2} step={0.05} value={rightY} onChange={setRightY} />
            <Control label={`Rotate B · ${rightRotationDegrees.toFixed(0)}°`} min={-90} max={90} step={1} value={rightRotationDegrees} onChange={setRightRotationDegrees} />
          </div>
        </div>

        <aside className="border-t border-zinc-800 p-5 xl:border-l xl:border-t-0">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-600">Candidate axis</p>
              <h3 className="mt-2 text-xl font-semibold text-zinc-100">{selected.label}</h3>
            </div>
            <span className="font-mono text-xs text-zinc-600">{axisIndex + 1} / 4</span>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2">
            {relation.axes.map((axis) => (
              <button
                key={axis.index}
                type="button"
                onClick={() => setAxisIndex(axis.index)}
                className={`rounded-xl border p-3 text-left transition ${axis.index === axisIndex ? "border-zinc-500 bg-zinc-900" : "border-zinc-800 bg-zinc-950 hover:border-zinc-700"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-semibold text-zinc-200">{axis.label}</span>
                  {axis.critical && <span className="text-[9px] font-semibold uppercase tracking-wide text-violet-300">critical</span>}
                </div>
                <div className={`mt-2 font-mono text-xs ${axis.separating ? "text-red-300" : "text-emerald-300"}`}>
                  {formatSigned(axis.signedOverlap)}
                </div>
              </button>
            ))}
          </div>

          <div className={`mt-5 rounded-xl border p-4 ${selected.separating ? "border-red-900/60 bg-red-950/25" : "border-zinc-800 bg-zinc-900/45"}`}>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-600">Rust projection test</p>
            <div className="mt-3 font-mono text-sm text-zinc-200">
              rA + rB − |Δc·axis|
            </div>
            <div className="mt-2 font-mono text-sm text-zinc-400">
              {selected.leftRadius.toFixed(3)} + {selected.rightRadius.toFixed(3)} − {selected.centerDistance.toFixed(3)}
            </div>
            <div className={`mt-2 font-mono text-lg font-semibold ${selected.separating ? "text-red-300" : "text-emerald-300"}`}>
              = {formatSigned(selected.signedOverlap)}
            </div>
            <p className="mt-3 text-xs leading-5 text-zinc-500">
              {selected.separating
                ? "Negative: the projected intervals have a gap. This axis alone proves the rectangles are separated."
                : selected.signedOverlap === 0
                  ? "Zero: the projected intervals touch. Touching counts as overlap in this lab."
                  : "Positive: projections overlap on this axis, so SAT must continue checking the remaining candidate axes."}
            </p>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <Metric label="axis x" value={selected.axis[0].toFixed(3)} />
            <Metric label="axis y" value={selected.axis[1].toFixed(3)} />
            <Metric label="A radius" value={selected.leftRadius.toFixed(3)} />
            <Metric label="B radius" value={selected.rightRadius.toFixed(3)} />
          </div>

          <div className="mt-5 rounded-xl border border-zinc-800 bg-zinc-900/45 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-600">Whole SAT result</p>
            <p className="mt-2 text-sm leading-6 text-zinc-300">
              {relation.overlaps
                ? "No candidate axis separates the rectangles, so SAT concludes they overlap or touch."
                : `${firstSeparator?.label ?? "A candidate axis"} separates the rectangles. A boolean-only implementation could stop as soon as that axis is found.`}
            </p>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <button type="button" disabled={axisIndex === 0} onClick={() => setAxisIndex((value) => Math.max(0, value - 1))} className="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-300 disabled:opacity-30">← Previous</button>
            <button type="button" disabled={axisIndex === 3} onClick={() => setAxisIndex((value) => Math.min(3, value + 1))} className="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-300 disabled:opacity-30">Next →</button>
          </div>

          <p className="mt-5 text-xs leading-5 text-zinc-600">
            In 3D, OBB SAT expands from four axes to fifteen common candidates: three face axes from each box plus nine cross products. The proof idea stays the same.
          </p>
        </aside>
      </div>
    </section>
  );
}

function ObbShape({
  shape,
  label,
  stroke,
  fill,
}: {
  shape: SatRelation["left"];
  label: string;
  stroke: string;
  fill: string;
}) {
  const centerX = worldX(shape.center[0]);
  const centerY = worldY(shape.center[1]);
  const width = shape.halfExtents[0] * 2 * WORLD_SCALE;
  const height = shape.halfExtents[1] * 2 * WORLD_SCALE;
  const rotationDegrees = -(shape.rotationRadians * 180) / Math.PI;
  return (
    <g transform={`translate(${centerX} ${centerY}) rotate(${rotationDegrees})`}>
      <rect x={-width / 2} y={-height / 2} width={width} height={height} rx="8" fill={fill} fillOpacity="0.5" stroke={stroke} strokeWidth="4" />
      <line x1="0" y1="0" x2={width / 2 + 22} y2="0" stroke={stroke} strokeWidth="3" />
      <line x1="0" y1="0" x2="0" y2={-height / 2 - 22} stroke={stroke} strokeWidth="3" opacity="0.65" />
      <circle cx="0" cy="0" r="4" fill="#fafafa" />
      <text x="10" y="-10" fill="#fafafa" fontSize="15" fontWeight="700" transform={`rotate(${-rotationDegrees})`}>{label}</text>
    </g>
  );
}

function AxisLine({ axis, separating, label }: { axis: [number, number]; separating: boolean; label: string }) {
  const screenAxis = [axis[0], -axis[1]];
  const length = 310;
  const color = separating ? "#fb7185" : "#facc15";
  return (
    <g>
      <line
        x1={ORIGIN_X - screenAxis[0] * length}
        y1={ORIGIN_Y - screenAxis[1] * length}
        x2={ORIGIN_X + screenAxis[0] * length}
        y2={ORIGIN_Y + screenAxis[1] * length}
        stroke={color}
        strokeWidth="3"
        strokeDasharray="10 7"
      />
      <rect x={ORIGIN_X + screenAxis[0] * 235 - 24} y={ORIGIN_Y + screenAxis[1] * 235 - 16} width="58" height="26" rx="7" fill="#09090b" stroke={color} />
      <text x={ORIGIN_X + screenAxis[0] * 235 + 5} y={ORIGIN_Y + screenAxis[1] * 235 + 2} textAnchor="middle" fill={color} fontSize="12" fontWeight="700">{label}</text>
    </g>
  );
}

function ProjectionStrip({ axis }: { axis: SatAxis }) {
  const width = 620;
  const mid = width / 2;
  const scale = 50;
  const aLeft = mid - axis.leftRadius * scale;
  const aRight = mid + axis.leftRadius * scale;
  const bCenter = mid + axis.centerDistance * scale;
  const bLeft = bCenter - axis.rightRadius * scale;
  const bRight = bCenter + axis.rightRadius * scale;
  return (
    <g>
      <text x="0" y="-9" fill="#52525b" fontSize="11">1D projections on selected axis</text>
      <line x1="0" x2={width} y1="14" y2="14" stroke="#3f3f46" strokeWidth="2" />
      <line x1={aLeft} x2={aRight} y1="8" y2="8" stroke="#67e8f9" strokeWidth="8" strokeLinecap="round" />
      <line x1={bLeft} x2={bRight} y1="20" y2="20" stroke={axis.separating ? "#fb7185" : "#e4e4e7"} strokeWidth="8" strokeLinecap="round" />
      <text x={aLeft - 8} y="10" textAnchor="end" fill="#67e8f9" fontSize="10">A</text>
      <text x={bRight + 8} y="23" fill={axis.separating ? "#fb7185" : "#a1a1aa"} fontSize="10">B</text>
    </g>
  );
}

function DecisionBadge({ overlaps }: { overlaps: boolean }) {
  return (
    <span className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${overlaps ? "border-emerald-700/60 bg-emerald-950/30 text-emerald-300" : "border-red-800/60 bg-red-950/25 text-red-300"}`}>
      {overlaps ? "SAT: overlap" : "SAT: separated"}
    </span>
  );
}

function Control({ label, min, max, step, value, onChange }: { label: string; min: number; max: number; step: number; value: number; onChange: (value: number) => void }) {
  return (
    <label className="block text-xs font-semibold text-zinc-400">
      {label}
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} className="mt-2 w-full accent-zinc-100" />
    </label>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/45 p-3">
      <dt className="text-[10px] uppercase tracking-wide text-zinc-600">{label}</dt>
      <dd className="mt-1 font-mono text-sm text-zinc-300">{value}</dd>
    </div>
  );
}

function worldX(value: number) {
  return ORIGIN_X + value * WORLD_SCALE;
}
function worldY(value: number) {
  return ORIGIN_Y - value * WORLD_SCALE;
}
function formatSigned(value: number) {
  const normalized = Math.abs(value) < 0.0005 ? 0 : value;
  return `${normalized >= 0 ? "+" : ""}${normalized.toFixed(3)}`;
}
function degreesToRadians(value: number) {
  return (value * Math.PI) / 180;
}
