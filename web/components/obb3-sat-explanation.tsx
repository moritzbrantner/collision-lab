"use client";

import { useEffect, useMemo, useState } from "react";

import initWasm, { obb3_sat_json } from "../lib/wasm-pkg/collision_wasm";

type Vec3 = [number, number, number];

type SatAxis3 = {
  index: number;
  label: string;
  axis: Vec3;
  leftRadius: number;
  rightRadius: number;
  centerDistance: number;
  signedOverlap: number;
  separating: boolean;
  active: boolean;
  critical: boolean;
};

type Obb3View = {
  center: Vec3;
  halfExtents: Vec3;
  rotationRadiansXYZ: Vec3;
  axes: [Vec3, Vec3, Vec3];
};

type SatRelation3 = {
  left: Obb3View;
  right: Obb3View;
  axes: SatAxis3[];
  criticalAxis: number;
  activeAxisCount: number;
  overlaps: boolean;
};

const LEFT = {
  center: [-0.75, 0, -0.15] as Vec3,
  halfExtents: [1.45, 0.82, 0.95] as Vec3,
  rotationDegrees: [12, 24, -10] as Vec3,
};

const WIDTH = 820;
const HEIGHT = 470;
const ORIGIN_X = 395;
const ORIGIN_Y = 220;
const WORLD_SCALE = 66;
const BOX_EDGES = [
  [0, 1], [0, 2], [0, 4], [1, 3], [1, 5], [2, 3],
  [2, 6], [3, 7], [4, 5], [4, 6], [5, 7], [6, 7],
] as const;

export function Obb3SatExplanation() {
  const [ready, setReady] = useState(false);
  const [rightX, setRightX] = useState(1.5);
  const [rightY, setRightY] = useState(0.3);
  const [rightZ, setRightZ] = useState(0.45);
  const [rightPitch, setRightPitch] = useState(-18);
  const [rightYaw, setRightYaw] = useState(14);
  const [rightRoll, setRightRoll] = useState(-32);
  const [axisIndex, setAxisIndex] = useState(0);
  const [relation, setRelation] = useState<SatRelation3 | null>(null);
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
      const [leftRx, leftRy, leftRz] = LEFT.rotationDegrees.map(degreesToRadians) as Vec3;
      const next = JSON.parse(
        obb3_sat_json(
          LEFT.center[0], LEFT.center[1], LEFT.center[2],
          LEFT.halfExtents[0], LEFT.halfExtents[1], LEFT.halfExtents[2],
          leftRx, leftRy, leftRz,
          rightX, rightY, rightZ,
          1.05, 0.72, 0.88,
          degreesToRadians(rightPitch), degreesToRadians(rightYaw), degreesToRadians(rightRoll),
        ),
      ) as SatRelation3;
      setRelation(next);
      setAxisIndex((current) => Math.min(current, next.axes.length - 1));
      setError(null);
    } catch (reason) {
      setError(String(reason));
    }
  }, [ready, rightPitch, rightRoll, rightX, rightY, rightYaw, rightZ]);

  const selected = relation?.axes[axisIndex] ?? null;
  const firstSeparator = useMemo(
    () => relation?.axes.find((axis) => axis.active && axis.separating) ?? null,
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
      <div className="grid min-h-[34rem] place-items-center rounded-3xl border border-zinc-800 bg-zinc-950 text-sm text-zinc-500">
        Loading the Rust 3D SAT relation…
      </div>
    );
  }

  return (
    <section className="overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-950">
      <div className="border-b border-zinc-800 p-5 sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-600">
          Narrow phase · 3D OBB SAT
        </p>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-4xl">
            <h2 className="text-2xl font-semibold text-zinc-100">
              Six face axes are not enough in 3D. Edge pairs create nine more.
            </h2>
            <p className="mt-3 text-sm leading-6 text-zinc-500">
              Rust evaluates the three local axes of A, the three local axes of B, and all nine A-edge × B-edge axes. One negative active projection overlap proves separation; only when every active axis passes do the boxes intersect or touch.
            </p>
          </div>
          <DecisionBadge overlaps={relation.overlaps} />
        </div>
      </div>

      <div className="grid 2xl:grid-cols-[minmax(0,1fr)_27rem]">
        <div className="p-4 sm:p-6">
          <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/25 p-2 sm:p-4">
            <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="3D oriented boxes and selected SAT axis" className="w-full">
              <rect width={WIDTH} height={HEIGHT} rx="18" fill="#09090b" />
              <WorldAxes />
              <ObbWireframe shape={relation.left} label="A" stroke="#67e8f9" />
              <ObbWireframe shape={relation.right} label="B" stroke={relation.overlaps ? "#fb7185" : "#e4e4e7"} />
              {selected.active && <SelectedAxis relation={relation} axis={selected} />}
              <g transform="translate(82 405)">
                <ProjectionStrip axis={selected} />
              </g>
            </svg>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <Control label={`Move B on X · ${rightX.toFixed(2)}`} min={-0.2} max={4.2} step={0.05} value={rightX} onChange={setRightX} />
            <Control label={`Move B on Y · ${rightY.toFixed(2)}`} min={-2.0} max={2.0} step={0.05} value={rightY} onChange={setRightY} />
            <Control label={`Move B on Z · ${rightZ.toFixed(2)}`} min={-2.0} max={2.0} step={0.05} value={rightZ} onChange={setRightZ} />
            <Control label={`Pitch X · ${rightPitch.toFixed(0)}°`} min={-80} max={80} step={1} value={rightPitch} onChange={setRightPitch} />
            <Control label={`Yaw Y · ${rightYaw.toFixed(0)}°`} min={-80} max={80} step={1} value={rightYaw} onChange={setRightYaw} />
            <Control label={`Roll Z · ${rightRoll.toFixed(0)}°`} min={-80} max={80} step={1} value={rightRoll} onChange={setRightRoll} />
          </div>
        </div>

        <aside className="border-t border-zinc-800 p-5 2xl:border-l 2xl:border-t-0">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-600">Candidate axis</p>
              <h3 className="mt-2 font-mono text-xl font-semibold text-zinc-100">{selected.label}</h3>
            </div>
            <span className="font-mono text-xs text-zinc-600">{axisIndex + 1} / 15</span>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Metric label="active" value={`${relation.activeAxisCount}/15`} />
            <Metric label="critical" value={relation.axes[relation.criticalAxis]?.label ?? "—"} />
          </div>

          <div className="mt-5 grid grid-cols-3 gap-2">
            {relation.axes.map((axis) => (
              <button
                key={axis.index}
                type="button"
                onClick={() => setAxisIndex(axis.index)}
                className={`min-h-16 rounded-xl border p-2 text-left transition ${axis.index === axisIndex ? "border-zinc-500 bg-zinc-900" : "border-zinc-800 bg-zinc-950 hover:border-zinc-700"} ${axis.active ? "" : "opacity-45"}`}
              >
                <div className="flex items-start justify-between gap-1">
                  <span className="break-all font-mono text-[10px] font-semibold text-zinc-200">{axis.label}</span>
                  {axis.critical && <span className="text-[8px] font-semibold uppercase text-violet-300">C</span>}
                </div>
                <div className={`mt-2 font-mono text-[10px] ${!axis.active ? "text-zinc-600" : axis.separating ? "text-red-300" : "text-emerald-300"}`}>
                  {axis.active ? formatSigned(axis.signedOverlap) : "parallel"}
                </div>
              </button>
            ))}
          </div>

          <div className={`mt-5 rounded-xl border p-4 ${selected.active && selected.separating ? "border-red-900/60 bg-red-950/25" : "border-zinc-800 bg-zinc-900/45"}`}>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-600">Rust projection test</p>
            {!selected.active ? (
              <p className="mt-3 text-sm leading-6 text-zinc-400">
                These two edge directions are parallel or nearly parallel, so their cross product has no usable length. Rust marks this candidate inactive; it contributes no independent separating direction.
              </p>
            ) : (
              <>
                <div className="mt-3 font-mono text-sm text-zinc-200">rA + rB − |Δc·axis|</div>
                <div className="mt-2 font-mono text-sm text-zinc-400">
                  {selected.leftRadius.toFixed(3)} + {selected.rightRadius.toFixed(3)} − {selected.centerDistance.toFixed(3)}
                </div>
                <div className={`mt-2 font-mono text-lg font-semibold ${selected.separating ? "text-red-300" : "text-emerald-300"}`}>
                  = {formatSigned(selected.signedOverlap)}
                </div>
                <p className="mt-3 text-xs leading-5 text-zinc-500">
                  {selected.separating
                    ? "Negative: this one axis is a complete proof that the 3D boxes are separated."
                    : "Non-negative: the projections overlap or touch here, so SAT still needs every other active candidate axis."}
                </p>
              </>
            )}
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2">
            <Metric label="axis x" value={selected.active ? selected.axis[0].toFixed(3) : "—"} />
            <Metric label="axis y" value={selected.active ? selected.axis[1].toFixed(3) : "—"} />
            <Metric label="axis z" value={selected.active ? selected.axis[2].toFixed(3) : "—"} />
          </div>

          <div className="mt-5 rounded-xl border border-zinc-800 bg-zinc-900/45 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-600">Whole SAT result</p>
            <p className="mt-2 text-sm leading-6 text-zinc-300">
              {relation.overlaps
                ? `All ${relation.activeAxisCount} active axes pass. The boxes overlap or touch.`
                : `${firstSeparator?.label ?? "An active axis"} has a projection gap, so the boxes are separated.`}
            </p>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2">
            <button type="button" disabled={axisIndex === 0} onClick={() => setAxisIndex((value) => Math.max(0, value - 1))} className="rounded-lg border border-zinc-700 px-2 py-2 text-xs font-semibold text-zinc-300 disabled:opacity-30">← Prev</button>
            <button type="button" onClick={() => setAxisIndex(relation.criticalAxis)} className="rounded-lg border border-violet-900/70 px-2 py-2 text-xs font-semibold text-violet-300">Critical</button>
            <button type="button" disabled={axisIndex === 14} onClick={() => setAxisIndex((value) => Math.min(14, value + 1))} className="rounded-lg border border-zinc-700 px-2 py-2 text-xs font-semibold text-zinc-300 disabled:opacity-30">Next →</button>
          </div>
        </aside>
      </div>
    </section>
  );
}

function WorldAxes() {
  const origin = project([0, 0, 0]);
  const axes: Array<{ label: string; point: Vec3; stroke: string }> = [
    { label: "X", point: [2.8, 0, 0], stroke: "#52525b" },
    { label: "Y", point: [0, 2.3, 0], stroke: "#52525b" },
    { label: "Z", point: [0, 0, 2.5], stroke: "#52525b" },
  ];
  return (
    <g opacity="0.65">
      {axes.map(({ label, point, stroke }) => {
        const end = project(point);
        return (
          <g key={label}>
            <line x1={origin[0]} y1={origin[1]} x2={end[0]} y2={end[1]} stroke={stroke} strokeWidth="2" strokeDasharray="6 7" />
            <text x={end[0] + 7} y={end[1] - 4} fill="#71717a" fontSize="11" fontWeight="700">{label}</text>
          </g>
        );
      })}
    </g>
  );
}

function ObbWireframe({ shape, label, stroke }: { shape: Obb3View; label: string; stroke: string }) {
  const corners = obbCorners(shape).map(project);
  const center = project(shape.center);
  return (
    <g>
      {BOX_EDGES.map(([left, right]) => (
        <line key={`${left}-${right}`} x1={corners[left][0]} y1={corners[left][1]} x2={corners[right][0]} y2={corners[right][1]} stroke={stroke} strokeWidth="3" strokeOpacity="0.82" />
      ))}
      {shape.axes.map((axis, index) => {
        const end = project(add(shape.center, scale(axis, shape.halfExtents[index] + 0.35)));
        return <line key={index} x1={center[0]} y1={center[1]} x2={end[0]} y2={end[1]} stroke={stroke} strokeWidth="2" opacity={0.55 + index * 0.15} />;
      })}
      <circle cx={center[0]} cy={center[1]} r="5" fill={stroke} />
      <text x={center[0] + 10} y={center[1] - 10} fill="#fafafa" fontSize="15" fontWeight="700">{label}</text>
    </g>
  );
}

function SelectedAxis({ relation, axis }: { relation: SatRelation3; axis: SatAxis3 }) {
  const midpoint = scale(add(relation.left.center, relation.right.center), 0.5);
  const start = project(add(midpoint, scale(axis.axis, -3.7)));
  const end = project(add(midpoint, scale(axis.axis, 3.7)));
  const labelPoint = project(add(midpoint, scale(axis.axis, 2.7)));
  const stroke = axis.separating ? "#fb7185" : "#facc15";
  return (
    <g>
      <line x1={start[0]} y1={start[1]} x2={end[0]} y2={end[1]} stroke={stroke} strokeWidth="3" strokeDasharray="10 7" />
      <rect x={labelPoint[0] - 34} y={labelPoint[1] - 16} width="68" height="25" rx="7" fill="#09090b" stroke={stroke} />
      <text x={labelPoint[0]} y={labelPoint[1] + 1} textAnchor="middle" fill={stroke} fontSize="10" fontWeight="700">{axis.label}</text>
    </g>
  );
}

function ProjectionStrip({ axis }: { axis: SatAxis3 }) {
  const width = 655;
  if (!axis.active) {
    return (
      <g>
        <text x="0" y="0" fill="#71717a" fontSize="11">Inactive cross axis · parallel edge directions create no independent projection.</text>
      </g>
    );
  }
  const scaleFactor = 44;
  const mid = width / 2 - axis.centerDistance * scaleFactor * 0.25;
  const aLeft = mid - axis.leftRadius * scaleFactor;
  const aRight = mid + axis.leftRadius * scaleFactor;
  const bCenter = mid + axis.centerDistance * scaleFactor;
  const bLeft = bCenter - axis.rightRadius * scaleFactor;
  const bRight = bCenter + axis.rightRadius * scaleFactor;
  return (
    <g>
      <text x="0" y="-12" fill="#52525b" fontSize="11">1D projections supplied by Rust for the selected axis</text>
      <line x1="0" x2={width} y1="13" y2="13" stroke="#3f3f46" strokeWidth="2" />
      <line x1={aLeft} x2={aRight} y1="7" y2="7" stroke="#67e8f9" strokeWidth="8" strokeLinecap="round" />
      <line x1={bLeft} x2={bRight} y1="19" y2="19" stroke={axis.separating ? "#fb7185" : "#e4e4e7"} strokeWidth="8" strokeLinecap="round" />
      <text x={aLeft} y="38" fill="#67e8f9" fontSize="10">A</text>
      <text x={bRight - 8} y="38" fill={axis.separating ? "#fb7185" : "#e4e4e7"} fontSize="10">B</text>
    </g>
  );
}

function DecisionBadge({ overlaps }: { overlaps: boolean }) {
  return (
    <span className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${overlaps ? "border-emerald-800 bg-emerald-950/40 text-emerald-300" : "border-red-900 bg-red-950/40 text-red-300"}`}>
      {overlaps ? "overlap / touch" : "separated"}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2">
      <div className="text-[9px] font-semibold uppercase tracking-wide text-zinc-600">{label}</div>
      <div className="mt-1 truncate font-mono text-xs text-zinc-300">{value}</div>
    </div>
  );
}

function Control({ label, min, max, step, value, onChange }: { label: string; min: number; max: number; step: number; value: number; onChange: (value: number) => void }) {
  return (
    <label className="block text-xs text-zinc-500">
      <span className="mb-2 block font-medium text-zinc-400">{label}</span>
      <input className="w-full accent-zinc-300" type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function obbCorners(shape: Obb3View): Vec3[] {
  const corners: Vec3[] = [];
  for (const x of [-1, 1]) {
    for (const y of [-1, 1]) {
      for (const z of [-1, 1]) {
        let point = shape.center;
        point = add(point, scale(shape.axes[0], x * shape.halfExtents[0]));
        point = add(point, scale(shape.axes[1], y * shape.halfExtents[1]));
        point = add(point, scale(shape.axes[2], z * shape.halfExtents[2]));
        corners.push(point);
      }
    }
  }
  return corners;
}

function project(point: Vec3): [number, number] {
  return [
    ORIGIN_X + (point[0] + point[2] * 0.58) * WORLD_SCALE,
    ORIGIN_Y - point[1] * WORLD_SCALE + point[2] * WORLD_SCALE * 0.34,
  ];
}

function add(left: Vec3, right: Vec3): Vec3 {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

function scale(vector: Vec3, factor: number): Vec3 {
  return [vector[0] * factor, vector[1] * factor, vector[2] * factor];
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function formatSigned(value: number): string {
  const rounded = Math.abs(value) < 0.0005 ? 0 : value;
  return `${rounded >= 0 ? "+" : ""}${rounded.toFixed(3)}`;
}
