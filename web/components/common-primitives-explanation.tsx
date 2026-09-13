"use client";

import { useEffect, useMemo, useState } from "react";

import initWasm, {
  capsule_capsule_json,
  sphere_aabb_json,
  sphere_capsule_json,
} from "../lib/wasm-pkg/collision_wasm";

type Vec3 = [number, number, number];
type PairKind = "sphere-aabb" | "sphere-capsule" | "capsule-capsule";

type Sphere = {
  center: Vec3;
  radius: number;
};

type Capsule = {
  start: Vec3;
  end: Vec3;
  radius: number;
};

type SphereAabbRelation = {
  sphere: Sphere;
  aabb: { min: Vec3; max: Vec3 };
  closestPoint: Vec3;
  centerDistanceSquared: number;
  centerDistance: number;
  signedSeparation: number;
  overlaps: boolean;
};

type SphereCapsuleRelation = {
  sphere: Sphere;
  capsule: Capsule;
  capsuleAxisPoint: Vec3;
  capsuleParameter: number;
  centerDistanceSquared: number;
  centerDistance: number;
  radiusSum: number;
  radiusSumSquared: number;
  signedSeparation: number;
  overlaps: boolean;
};

type CapsuleCapsuleRelation = {
  left: Capsule;
  right: Capsule;
  leftAxisPoint: Vec3;
  rightAxisPoint: Vec3;
  leftParameter: number;
  rightParameter: number;
  axisDistanceSquared: number;
  axisDistance: number;
  radiusSum: number;
  radiusSumSquared: number;
  signedSeparation: number;
  overlaps: boolean;
};

type Relation =
  | { kind: "sphere-aabb"; value: SphereAabbRelation }
  | { kind: "sphere-capsule"; value: SphereCapsuleRelation }
  | { kind: "capsule-capsule"; value: CapsuleCapsuleRelation };

const PAIRS: { id: PairKind; label: string; summary: string }[] = [
  {
    id: "sphere-aabb",
    label: "Sphere ↔ AABB",
    summary: "Clamp the sphere center to the box, then compare that closest distance with the sphere radius.",
  },
  {
    id: "sphere-capsule",
    label: "Sphere ↔ capsule",
    summary: "Project the sphere center onto the capsule axis segment, then add the two radii.",
  },
  {
    id: "capsule-capsule",
    label: "Capsule ↔ capsule",
    summary: "Find the closest points on two finite segments, then compare their distance with the radius sum.",
  },
];

const SPHERE = { center: [-1.45, 0, 0] as Vec3, radius: 0.95 };
const LEFT_CAPSULE = {
  start: [-2.55, -0.35, 0] as Vec3,
  end: [-0.45, 0.35, 0] as Vec3,
  radius: 0.48,
};
const BOX_HALF = [0.95, 0.75, 0.6] as Vec3;
const MOVING_CAPSULE_HALF_LENGTH = 1.15;
const MOVING_CAPSULE_RADIUS = 0.5;
const SVG_WIDTH = 760;
const SVG_HEIGHT = 360;
const WORLD_MIN = -4.5;
const WORLD_MAX = 4.5;
const PAD = 38;
const WORLD_SPAN = WORLD_MAX - WORLD_MIN;
const SCALE = Math.min((SVG_WIDTH - PAD * 2) / WORLD_SPAN, (SVG_HEIGHT - PAD * 2) / WORLD_SPAN);
const VIEW_SIZE = WORLD_SPAN * SCALE;
const ORIGIN_X = (SVG_WIDTH - VIEW_SIZE) / 2;
const ORIGIN_Y = (SVG_HEIGHT - VIEW_SIZE) / 2;

export function CommonPrimitivesExplanation() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<PairKind>("sphere-aabb");
  const [x, setX] = useState(1.15);
  const [y, setY] = useState(0.45);
  const [angle, setAngle] = useState(35);
  const [relation, setRelation] = useState<Relation | null>(null);

  const movingCapsule = useMemo(
    () => capsuleFromCenter(x, y, angle, MOVING_CAPSULE_HALF_LENGTH, MOVING_CAPSULE_RADIUS),
    [angle, x, y],
  );

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
      if (kind === "sphere-aabb") {
        setRelation({
          kind,
          value: JSON.parse(
            sphere_aabb_json(
              ...SPHERE.center,
              SPHERE.radius,
              x,
              y,
              0,
              ...BOX_HALF,
            ),
          ) as SphereAabbRelation,
        });
      } else if (kind === "sphere-capsule") {
        setRelation({
          kind,
          value: JSON.parse(
            sphere_capsule_json(
              ...SPHERE.center,
              SPHERE.radius,
              ...movingCapsule.start,
              ...movingCapsule.end,
              movingCapsule.radius,
            ),
          ) as SphereCapsuleRelation,
        });
      } else {
        setRelation({
          kind,
          value: JSON.parse(
            capsule_capsule_json(
              ...LEFT_CAPSULE.start,
              ...LEFT_CAPSULE.end,
              LEFT_CAPSULE.radius,
              ...movingCapsule.start,
              ...movingCapsule.end,
              movingCapsule.radius,
            ),
          ) as CapsuleCapsuleRelation,
        });
      }
      setError(null);
    } catch (reason) {
      setError(String(reason));
    }
  }, [kind, movingCapsule, ready, x, y]);

  useEffect(() => {
    setX(1.15);
    setY(0.45);
    setAngle(kind === "sphere-aabb" ? 0 : 35);
  }, [kind]);

  if (error) {
    return <div className="rounded-2xl border border-red-900/60 bg-red-950/30 p-6 text-sm text-red-300">{error}</div>;
  }

  return (
    <section className="overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-950">
      <div className="border-b border-zinc-800 p-5 sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-600">Narrow phase · Closest-point primitives</p>
        <h2 className="mt-2 text-2xl font-semibold text-zinc-100">Capsules reduce curved collision to a segment-distance problem.</h2>
        <p className="mt-3 max-w-4xl text-sm leading-6 text-zinc-500">
          Many common primitive pairs share the same pattern: find the closest geometric features, measure their distance, then account for radius. The closest points, segment parameters, signed separation, and final collision decision below all come from Rust `geometry-kernels` through WebAssembly.
        </p>
      </div>

      <div className="border-b border-zinc-800 p-4 sm:px-6">
        <div className="flex flex-wrap gap-2">
          {PAIRS.map((pair) => (
            <button
              key={pair.id}
              type="button"
              onClick={() => setKind(pair.id)}
              className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                pair.id === kind
                  ? "border-zinc-200 bg-zinc-100 text-zinc-950"
                  : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
              }`}
            >
              {pair.label}
            </button>
          ))}
        </div>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-500">{PAIRS.find((pair) => pair.id === kind)?.summary}</p>
      </div>

      {!ready || !relation || relation.kind !== kind ? (
        <div className="grid min-h-[30rem] place-items-center text-sm text-zinc-500">Loading closest-point Rust kernels…</div>
      ) : (
        <div className="grid xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="p-4 sm:p-6">
            <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/25 p-2">
              <PrimitiveDiagram relation={relation} />
            </div>
            <div className={`mt-5 grid gap-4 ${kind === "sphere-aabb" ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>
              <RangeControl label="Move B · X" min={-2.5} max={3.2} step={0.05} value={x} onChange={setX} />
              <RangeControl label="Move B · Y" min={-2.5} max={2.5} step={0.05} value={y} onChange={setY} />
              {kind !== "sphere-aabb" && <RangeControl label="Rotate B" min={-90} max={90} step={1} value={angle} suffix="°" onChange={setAngle} />}
            </div>
          </div>

          <PrimitiveInspector relation={relation} />
        </div>
      )}
    </section>
  );
}

function PrimitiveInspector({ relation }: { relation: Relation }) {
  const values = relationValues(relation);
  const touching = Math.abs(values.signedSeparation) < 0.001;
  const decision = touching ? "touching" : values.overlaps ? "overlapping" : "separated";

  return (
    <aside className="border-t border-zinc-800 p-5 sm:p-6 xl:border-l xl:border-t-0">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-600">Rust relation</p>
          <h3 className="mt-2 text-xl font-semibold text-zinc-100">Closest features decide the pair.</h3>
        </div>
        <DecisionBadge overlaps={values.overlaps} touching={touching} label={decision} />
      </div>

      <p className="mt-4 text-sm leading-6 text-zinc-400">{formulaCopy(relation.kind)}</p>

      <dl className="mt-5 divide-y divide-zinc-800 border-y border-zinc-800 text-sm">
        <Metric label="Closest distance" value={format(values.distance)} />
        <Metric label={relation.kind === "sphere-aabb" ? "Sphere radius" : "Radius sum"} value={format(values.radiusBoundary)} />
        <Metric label="Signed separation" value={format(values.signedSeparation)} />
        {relation.kind === "sphere-capsule" && <Metric label="Capsule parameter t" value={format(relation.value.capsuleParameter)} />}
        {relation.kind === "capsule-capsule" && (
          <>
            <Metric label="Left parameter t" value={format(relation.value.leftParameter)} />
            <Metric label="Right parameter u" value={format(relation.value.rightParameter)} />
          </>
        )}
      </dl>

      <div className="mt-5 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-600">What to notice</p>
        <p className="mt-2 text-sm leading-6 text-zinc-300">
          The yellow connector is not guessed by the SVG. Its endpoint or endpoints are the exact closest features returned by Rust. Negative signed separation means the inflated primitive surfaces overlap; zero means touching.
        </p>
      </div>

      <p className="mt-5 text-xs leading-5 text-zinc-600">
        React constructs the input shapes and projects returned coordinates. Closest-point solving and overlap semantics remain in `geometry-kernels`.
      </p>
    </aside>
  );
}

function PrimitiveDiagram({ relation }: { relation: Relation }) {
  const overlaps = relation.value.overlaps;
  return (
    <svg viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`} role="img" aria-label="Closest-point primitive collision explanation" className="w-full">
      <rect width={SVG_WIDTH} height={SVG_HEIGHT} rx="16" fill="#09090b" />
      <Grid />

      {relation.kind === "sphere-aabb" && (
        <>
          <SphereShape sphere={relation.value.sphere} fixed />
          <AabbShape aabb={relation.value.aabb} overlaps={overlaps} />
          <ClosestConnector from={relation.value.sphere.center} to={relation.value.closestPoint} />
          <Point point={relation.value.closestPoint} />
        </>
      )}

      {relation.kind === "sphere-capsule" && (
        <>
          <SphereShape sphere={relation.value.sphere} fixed />
          <CapsuleShape capsule={relation.value.capsule} overlaps={overlaps} />
          <ClosestConnector from={relation.value.sphere.center} to={relation.value.capsuleAxisPoint} />
          <Point point={relation.value.capsuleAxisPoint} />
        </>
      )}

      {relation.kind === "capsule-capsule" && (
        <>
          <CapsuleShape capsule={relation.value.left} fixed />
          <CapsuleShape capsule={relation.value.right} overlaps={overlaps} />
          <ClosestConnector from={relation.value.leftAxisPoint} to={relation.value.rightAxisPoint} />
          <Point point={relation.value.leftAxisPoint} />
          <Point point={relation.value.rightAxisPoint} />
        </>
      )}

      <text x={30} y={SVG_HEIGHT - 18} fill="#52525b" fontSize="12">Yellow = closest-feature relation returned by Rust</text>
    </svg>
  );
}

function Grid() {
  const lines = [];
  for (let value = -4; value <= 4; value += 1) {
    lines.push(<line key={`x-${value}`} x1={sx(value)} y1={sy(4)} x2={sx(value)} y2={sy(-4)} stroke="#18181b" strokeWidth="1" />);
    lines.push(<line key={`y-${value}`} x1={sx(-4)} y1={sy(value)} x2={sx(4)} y2={sy(value)} stroke="#18181b" strokeWidth="1" />);
  }
  return <g>{lines}</g>;
}

function SphereShape({ sphere, fixed = false }: { sphere: Sphere; fixed?: boolean }) {
  return (
    <g>
      <circle
        cx={sx(sphere.center[0])}
        cy={sy(sphere.center[1])}
        r={sphere.radius * SCALE}
        fill={fixed ? "#164e63" : "#3f3f46"}
        fillOpacity="0.5"
        stroke={fixed ? "#67e8f9" : "#d4d4d8"}
        strokeWidth="3"
      />
      <Point point={sphere.center} muted />
    </g>
  );
}

function AabbShape({ aabb, overlaps }: { aabb: { min: Vec3; max: Vec3 }; overlaps: boolean }) {
  const x = sx(aabb.min[0]);
  const y = sy(aabb.max[1]);
  const width = (aabb.max[0] - aabb.min[0]) * SCALE;
  const height = (aabb.max[1] - aabb.min[1]) * SCALE;
  return <rect x={x} y={y} width={width} height={height} rx="8" fill={overlaps ? "#7f1d1d" : "#3f3f46"} fillOpacity="0.45" stroke={overlaps ? "#f87171" : "#d4d4d8"} strokeWidth="3" />;
}

function CapsuleShape({ capsule, fixed = false, overlaps = false }: { capsule: Capsule; fixed?: boolean; overlaps?: boolean }) {
  const stroke = fixed ? "#67e8f9" : overlaps ? "#f87171" : "#d4d4d8";
  const fill = fixed ? "#164e63" : overlaps ? "#7f1d1d" : "#3f3f46";
  return (
    <g>
      <line
        x1={sx(capsule.start[0])}
        y1={sy(capsule.start[1])}
        x2={sx(capsule.end[0])}
        y2={sy(capsule.end[1])}
        stroke={fill}
        strokeWidth={capsule.radius * SCALE * 2}
        strokeLinecap="round"
        opacity="0.65"
      />
      <line
        x1={sx(capsule.start[0])}
        y1={sy(capsule.start[1])}
        x2={sx(capsule.end[0])}
        y2={sy(capsule.end[1])}
        stroke={stroke}
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx={sx(capsule.start[0])} cy={sy(capsule.start[1])} r={capsule.radius * SCALE} fill="none" stroke={stroke} strokeWidth="2" opacity="0.7" />
      <circle cx={sx(capsule.end[0])} cy={sy(capsule.end[1])} r={capsule.radius * SCALE} fill="none" stroke={stroke} strokeWidth="2" opacity="0.7" />
    </g>
  );
}

function ClosestConnector({ from, to }: { from: Vec3; to: Vec3 }) {
  return <line x1={sx(from[0])} y1={sy(from[1])} x2={sx(to[0])} y2={sy(to[1])} stroke="#facc15" strokeWidth="3" strokeDasharray="7 5" />;
}

function Point({ point, muted = false }: { point: Vec3; muted?: boolean }) {
  return <circle cx={sx(point[0])} cy={sy(point[1])} r="5" fill={muted ? "#a1a1aa" : "#fde047"} stroke="#09090b" strokeWidth="2" />;
}

function RangeControl({
  label,
  min,
  max,
  step,
  value,
  suffix = "",
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block text-xs font-semibold uppercase tracking-[0.14em] text-zinc-600">
      <span className="flex items-center justify-between gap-3">
        {label}
        <span className="font-mono text-zinc-400">{format(value)}{suffix}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} className="mt-2 w-full accent-zinc-100" />
    </label>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="font-mono text-zinc-200">{value}</dd>
    </div>
  );
}

function DecisionBadge({ overlaps, touching, label }: { overlaps: boolean; touching: boolean; label: string }) {
  const classes = touching
    ? "border-amber-800 bg-amber-950/40 text-amber-300"
    : overlaps
      ? "border-red-900 bg-red-950/40 text-red-300"
      : "border-emerald-900 bg-emerald-950/40 text-emerald-300";
  return <span className={`rounded-full border px-3 py-1 text-xs font-semibold capitalize ${classes}`}>{label}</span>;
}

function relationValues(relation: Relation) {
  if (relation.kind === "sphere-aabb") {
    return {
      distance: relation.value.centerDistance,
      radiusBoundary: relation.value.sphere.radius,
      signedSeparation: relation.value.signedSeparation,
      overlaps: relation.value.overlaps,
    };
  }
  if (relation.kind === "sphere-capsule") {
    return {
      distance: relation.value.centerDistance,
      radiusBoundary: relation.value.radiusSum,
      signedSeparation: relation.value.signedSeparation,
      overlaps: relation.value.overlaps,
    };
  }
  return {
    distance: relation.value.axisDistance,
    radiusBoundary: relation.value.radiusSum,
    signedSeparation: relation.value.signedSeparation,
    overlaps: relation.value.overlaps,
  };
}

function formulaCopy(kind: PairKind) {
  if (kind === "sphere-aabb") return "Clamp the sphere center independently on X/Y/Z to the box. The sphere overlaps when that closest-point distance is no greater than its radius.";
  if (kind === "sphere-capsule") return "Clamp the sphere center onto the finite capsule axis segment. The pair overlaps when the center-to-axis distance is no greater than the sphere radius plus capsule radius.";
  return "Solve the closest points on both finite capsule axes. The pair overlaps when that axis distance is no greater than the two capsule radii added together.";
}

function capsuleFromCenter(centerX: number, centerY: number, angleDegrees: number, halfLength: number, radius: number): Capsule {
  const angle = (angleDegrees * Math.PI) / 180;
  const dx = Math.cos(angle) * halfLength;
  const dy = Math.sin(angle) * halfLength;
  return {
    start: [centerX - dx, centerY - dy, 0],
    end: [centerX + dx, centerY + dy, 0],
    radius,
  };
}

function sx(value: number) {
  return ORIGIN_X + (value - WORLD_MIN) * SCALE;
}

function sy(value: number) {
  return ORIGIN_Y + (WORLD_MAX - value) * SCALE;
}

function format(value: number) {
  if (!Number.isFinite(value)) return "—";
  return value.toFixed(3);
}
