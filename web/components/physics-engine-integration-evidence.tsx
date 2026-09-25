"use client";

import { useEffect, useMemo, useState } from "react";

import initWasm, {
  physics_engine_capsule_wedge_ccd_json,
  physics_engine_primitive_matrix_json,
} from "../lib/wasm-pkg/collision_wasm";

type ShapeName = "sphere" | "box" | "capsule" | "wedge";

type PairEvidence = {
  left: ShapeName;
  right: ShapeName;
  specialized: boolean;
  specializedDispatches: number;
  genericFallbackCalls: number;
  supportEvaluations: number;
  satQueries: number;
  satAxesTested: number;
  clipPasses: number;
  primitiveQueries: number;
  primitiveAxesTested: number;
  primitiveVertexTests: number;
  manifoldCandidates: number;
};

type MatrixEvidence = {
  source: "physics-engine";
  sourceRevision: string;
  shapes: ShapeName[];
  allSpecialized: boolean;
  pairs: PairEvidence[];
};

type CcdEvidence = {
  source: "physics-engine";
  sourceRevision: string;
  scenario: "fast-capsule-thin-wedge";
  hit: boolean;
  sweptContacts: number;
  retiredBodyIds: number[];
  primitiveQueries: number;
  primitiveSweepIterations: number;
  genericFallbackCalls: number;
  speed: number;
  stepSeconds: number;
  wedgeHalfThickness: number;
  capsuleRadius: number;
};

const SHAPE_LABELS: Record<ShapeName, string> = {
  sphere: "Sphere",
  box: "Box",
  capsule: "Capsule",
  wedge: "Wedge",
};

const SHAPE_ORDER: ShapeName[] = ["sphere", "box", "capsule", "wedge"];

export function PhysicsEngineIntegrationEvidence() {
  const [matrix, setMatrix] = useState<MatrixEvidence | null>(null);
  const [ccd, setCcd] = useState<CcdEvidence | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void initWasm()
      .then(() => {
        if (!active) return;
        setMatrix(JSON.parse(physics_engine_primitive_matrix_json()) as MatrixEvidence);
        setCcd(JSON.parse(physics_engine_capsule_wedge_ccd_json()) as CcdEvidence);
      })
      .catch((reason: unknown) => {
        if (active) setError(String(reason));
      });
    return () => {
      active = false;
    };
  }, []);

  const pairLookup = useMemo(() => {
    const pairs = new Map<string, PairEvidence>();
    for (const pair of matrix?.pairs ?? []) {
      pairs.set(pairKey(pair.left, pair.right), pair);
    }
    return pairs;
  }, [matrix]);

  if (error) {
    return (
      <section className="rounded-2xl border border-red-900/60 bg-red-950/30 p-6 text-sm text-red-300">
        Physics Engine evidence could not be loaded: {error}
      </section>
    );
  }

  if (!matrix || !ccd) {
    return (
      <section className="grid min-h-52 place-items-center rounded-3xl border border-zinc-800 bg-zinc-950 text-sm text-zinc-500">
        Loading Physics Engine collision evidence…
      </section>
    );
  }

  const specializedCount = matrix.pairs.filter((pair) => pair.specialized).length;

  return (
    <section
      data-testid="physics-engine-integration"
      className="overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-950"
    >
      <div className="border-b border-zinc-800 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-4xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-600">
              Engine integration · Primitive dispatch + CCD
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-zinc-100">
              Inspect the collision work Physics Engine actually executes.
            </h2>
            <p className="mt-3 text-sm leading-6 text-zinc-500">
              Collision Lab does not copy Physics Engine&apos;s wedge geometry, primitive dispatcher, or continuous-collision logic.
              These results execute the engine&apos;s public f64 fixed-step API in WASM and render its deterministic work counters.
            </p>
          </div>
          <div
            data-testid="physics-engine-specialization-summary"
            className="rounded-full border border-emerald-900 bg-emerald-950/30 px-3 py-1.5 text-xs font-semibold text-emerald-300"
          >
            {specializedCount} / {matrix.pairs.length} specialized
          </div>
        </div>
      </div>

      <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="overflow-x-auto p-4 sm:p-6">
          <table className="w-full min-w-[38rem] border-collapse text-sm">
            <caption className="mb-3 text-left text-xs leading-5 text-zinc-600">
              Every unordered pair is executed as a real overlapping engine scene. A check means the run used a specialized dispatch and zero generic fallbacks.
            </caption>
            <thead>
              <tr>
                <th className="border-b border-zinc-800 p-3 text-left font-medium text-zinc-500">A × B</th>
                {SHAPE_ORDER.map((shape) => (
                  <th key={shape} className="border-b border-zinc-800 p-3 text-center font-medium text-zinc-400">
                    {SHAPE_LABELS[shape]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SHAPE_ORDER.map((left) => (
                <tr key={left}>
                  <th className="border-b border-zinc-900 p-3 text-left font-medium text-zinc-400">
                    {SHAPE_LABELS[left]}
                  </th>
                  {SHAPE_ORDER.map((right) => {
                    const pair = pairLookup.get(pairKey(left, right));
                    return (
                      <td key={right} className="border-b border-zinc-900 p-3 text-center">
                        {pair ? (
                          <span
                            className={
                              pair.specialized
                                ? "font-semibold text-emerald-300"
                                : "font-semibold text-amber-300"
                            }
                            title={pair.specialized ? `${pair.specializedDispatches} specialized dispatches` : "Generic fallback observed"}
                          >
                            {pair.specialized ? "✓" : "fallback"}
                          </span>
                        ) : (
                          <span className="text-zinc-700">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-6 overflow-x-auto rounded-2xl border border-zinc-800">
            <table className="w-full min-w-[44rem] text-sm">
              <thead className="bg-zinc-900/50 text-xs text-zinc-500">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Pair</th>
                  <th className="px-4 py-3 text-right font-medium">Dispatches</th>
                  <th className="px-4 py-3 text-right font-medium">Support</th>
                  <th className="px-4 py-3 text-right font-medium">SAT axes</th>
                  <th className="px-4 py-3 text-right font-medium">Wedge vertices</th>
                  <th className="px-4 py-3 text-right font-medium">Fallbacks</th>
                </tr>
              </thead>
              <tbody>
                {matrix.pairs.map((pair) => (
                  <tr key={pairKey(pair.left, pair.right)} className="border-t border-zinc-800">
                    <td className="px-4 py-3 text-zinc-300">
                      {SHAPE_LABELS[pair.left]} ↔ {SHAPE_LABELS[pair.right]}
                    </td>
                    <MetricCell value={pair.specializedDispatches} />
                    <MetricCell value={pair.supportEvaluations} />
                    <MetricCell value={pair.satAxesTested + pair.primitiveAxesTested} />
                    <MetricCell value={pair.primitiveVertexTests} />
                    <MetricCell value={pair.genericFallbackCalls} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="border-t border-zinc-800 p-5 sm:p-6 xl:border-l xl:border-t-0">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-600">Continuous collision</p>
          <h3 className="mt-2 text-xl font-semibold text-zinc-100">Fast capsule → thin wedge</h3>
          <p className="mt-3 text-sm leading-6 text-zinc-500">
            The capsule travels far enough to cross the thin wedge within one 1/60-second step. The engine&apos;s swept path must catch it instead of relying on frame-end overlap.
          </p>

          <dl data-testid="physics-engine-ccd" className="mt-5 divide-y divide-zinc-800 border-y border-zinc-800 text-sm">
            <EvidenceMetric label="Swept contact" value={ccd.hit ? "detected" : "missed"} />
            <EvidenceMetric label="Swept contacts" value={String(ccd.sweptContacts)} />
            <EvidenceMetric label="Sweep iterations" value={String(ccd.primitiveSweepIterations)} />
            <EvidenceMetric label="Generic fallbacks" value={String(ccd.genericFallbackCalls)} />
            <EvidenceMetric label="Projectile retired" value={ccd.retiredBodyIds.includes(2) ? "yes" : "no"} />
          </dl>

          <p className="mt-5 text-xs leading-5 text-zinc-600">
            Source revision <span className="font-mono text-zinc-500">{matrix.sourceRevision.slice(0, 10)}</span>. Physics Engine owns the semantics; this page owns only the scenario and presentation.
          </p>
        </aside>
      </div>
    </section>
  );
}

function MetricCell({ value }: { value: number }) {
  return <td className="px-4 py-3 text-right font-mono text-zinc-400">{value}</td>;
}

function EvidenceMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="font-mono text-zinc-200">{value}</dd>
    </div>
  );
}

function pairKey(left: ShapeName, right: ShapeName) {
  const leftIndex = SHAPE_ORDER.indexOf(left);
  const rightIndex = SHAPE_ORDER.indexOf(right);
  return leftIndex <= rightIndex ? `${left}:${right}` : `${right}:${left}`;
}
