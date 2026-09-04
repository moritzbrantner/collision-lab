import type { Metadata } from "next";
import Link from "next/link";

import { ConvexCollisionWorkbench } from "../../components/convex-collision-workbench";

export const metadata: Metadata = {
  title: "Convex collision: GJK + EPA",
  description: "Interactive visual guide to convex proxies, support mappings, Minkowski difference, GJK collision detection, and EPA penetration depth.",
};

const stages = [
  {
    number: "01",
    eyebrow: "Represent",
    title: "Turn detailed geometry into convex pieces.",
    copy: "A convex hull keeps every line segment between two points inside the shape. That property makes extreme-point queries cheap and predictable. Concave models usually become several convex pieces rather than one giant hull when fidelity matters.",
  },
  {
    number: "02",
    eyebrow: "Query",
    title: "Ask only for the furthest point.",
    copy: "A support mapping answers one question: which point is furthest along direction d? GJK builds its proof from those answers, so spheres, boxes, hulls, capsules, and other convex shapes can share the same search structure.",
  },
  {
    number: "03",
    eyebrow: "Detect",
    title: "Search A − B for the origin.",
    copy: "Subtracting every point of B from every point of A produces the Minkowski difference. If that convex set contains the origin, the original shapes overlap. GJK approaches that yes/no answer with a tiny simplex instead of constructing the whole set.",
  },
  {
    number: "04",
    eyebrow: "Resolve",
    title: "Expand the simplex into penetration data.",
    copy: "After GJK finds overlap, EPA grows the enclosed simplex toward the boundary of A − B. Its closest boundary feature gives an estimate of penetration depth and the direction needed to separate the shapes.",
  },
];

export default function ConvexPage() {
  return (
    <main>
      <section className="relative overflow-hidden border-b border-zinc-800">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_10%,rgba(34,211,238,0.10),transparent_30rem),radial-gradient(circle_at_25%_80%,rgba(168,85,247,0.10),transparent_26rem)]" />
        <div className="relative mx-auto max-w-7xl px-6 py-16 sm:py-24">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <Link href="/explain/" className="text-sm text-zinc-500 transition hover:text-zinc-200">← Narrow-phase explanations</Link>
            <div className="flex flex-wrap gap-2 text-xs font-semibold text-zinc-500">
              <span className="rounded-full border border-cyan-900/60 bg-cyan-950/25 px-3 py-1.5 text-cyan-300">convex proxies</span>
              <span className="rounded-full border border-amber-900/60 bg-amber-950/25 px-3 py-1.5 text-amber-300">support mapping</span>
              <span className="rounded-full border border-violet-900/60 bg-violet-950/25 px-3 py-1.5 text-violet-300">GJK</span>
              <span className="rounded-full border border-rose-900/60 bg-rose-950/25 px-3 py-1.5 text-rose-300">EPA</span>
            </div>
          </div>

          <div className="mt-12 grid items-end gap-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="max-w-5xl">
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-zinc-500">Deep dive · Convex collision</p>
              <h1 className="mt-4 text-5xl font-semibold tracking-[-0.045em] text-zinc-50 sm:text-7xl">
                From messy shapes to one clean collision proof.
              </h1>
              <p className="mt-6 max-w-3xl text-lg leading-8 text-zinc-400">
                Convexity turns collision detection into a geometric search problem. Approximate the shape, expose a support mapping, search the Minkowski difference with GJK, then recover penetration information with EPA.
              </p>
            </div>
            <div className="rounded-3xl border border-zinc-800 bg-zinc-950/75 p-6 shadow-xl shadow-black/20">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-600">Core idea</p>
              <div className="mt-4 font-mono text-sm leading-7 text-zinc-300">
                support(A − B, d)<br />
                = support(A, d)<br />
                − support(B, −d)
              </div>
              <p className="mt-4 text-xs leading-5 text-zinc-600">One interface lets the same search work across many convex shape types.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-14 sm:py-20">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {stages.map((stage) => (
            <article key={stage.number} className="group rounded-3xl border border-zinc-800 bg-zinc-900/30 p-6 transition hover:border-zinc-700 hover:bg-zinc-900/45">
              <div className="flex items-center justify-between gap-4">
                <span className="font-mono text-xs text-zinc-700">{stage.number}</span>
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">{stage.eyebrow}</span>
              </div>
              <h2 className="mt-5 text-xl font-semibold leading-7 text-zinc-100">{stage.title}</h2>
              <p className="mt-3 text-sm leading-6 text-zinc-500">{stage.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-20">
        <ConvexCollisionWorkbench />
      </section>

      <section className="border-y border-zinc-800 bg-zinc-900/20">
        <div className="mx-auto max-w-7xl px-6 py-16 sm:py-20">
          <div className="grid gap-10 lg:grid-cols-[22rem_minmax(0,1fr)]">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-600">Approximation strategy</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-100">The proxy is part of the algorithm.</h2>
              <p className="mt-4 text-sm leading-7 text-zinc-500">
                Collision cost is not just “which narrow-phase algorithm?” The representation controls support-query cost, contact fidelity, memory, and whether concavity survives at all.
              </p>
            </div>

            <div className="overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-950/80">
              <div className="grid grid-cols-[1.2fr_repeat(3,minmax(0,1fr))] border-b border-zinc-800 bg-zinc-900/55 px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-600">
                <span>Representation</span><span>Cost</span><span>Fidelity</span><span>Best use</span>
              </div>
              {[
                ["Single convex hull", "lowest", "loses concavity", "simple rigid bodies / coarse proxy"],
                ["Low-vertex convex proxy", "very low", "tunable", "fast broad-ish narrow phase / LOD"],
                ["Convex decomposition", "multiple queries", "preserves concavity", "detailed non-convex bodies"],
                ["Original triangle mesh", "high / specialized", "exact surface", "static worlds or mesh-specific tests"],
              ].map((row) => (
                <div key={row[0]} className="grid grid-cols-[1.2fr_repeat(3,minmax(0,1fr))] gap-3 border-b border-zinc-800/70 px-5 py-4 text-sm last:border-b-0">
                  <span className="font-semibold text-zinc-200">{row[0]}</span>
                  <span className="text-zinc-500">{row[1]}</span>
                  <span className="text-zinc-500">{row[2]}</span>
                  <span className="text-zinc-500">{row[3]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-16 sm:py-20">
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="rounded-3xl border border-zinc-800 bg-zinc-900/30 p-7 lg:col-span-2">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-600">Mental model</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-100">GJK asks “can a simplex reach the origin?” EPA asks “which boundary is closest?”</h2>
            <p className="mt-4 max-w-4xl text-sm leading-7 text-zinc-500">
              That split is useful architecturally: support mappings define convex shapes; GJK consumes only that interface for overlap or distance; EPA can reuse the final overlapping simplex to extract a separation direction. The geometry type and the search algorithm stay loosely coupled.
            </p>
          </div>
          <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-7">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-600">Next lab step</p>
            <h2 className="mt-3 text-xl font-semibold text-zinc-100">Move the correctness path into shared kernels.</h2>
            <p className="mt-3 text-sm leading-6 text-zinc-500">
              This page is an inspectable 2D teaching implementation. A production follow-up can put support mappings, GJK distance/overlap, EPA penetration, tolerance policy, and deterministic fixtures into rust-kernels, then drive this visualization through WASM like the SAT lessons.
            </p>
          </div>
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-zinc-800 pt-8 text-sm">
          <div className="text-zinc-600">Primary reference: Gilbert, Johnson &amp; Keerthi (1988), IEEE Journal on Robotics and Automation.</div>
          <a href="https://doi.org/10.1109/56.2083" className="font-semibold text-zinc-300 underline decoration-zinc-700 underline-offset-4 transition hover:text-white hover:decoration-zinc-300">Open the original GJK paper →</a>
        </div>
      </section>
    </main>
  );
}
