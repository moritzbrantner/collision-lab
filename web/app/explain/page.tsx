import Link from "next/link";

import { DynamicAabbExplanation } from "../../components/dynamic-aabb-explanation";
import { ExplanationMode } from "../../components/explanation-mode";
import { OctreeExplanation } from "../../components/octree-explanation";
import { StaticBvhExplanation } from "../../components/static-bvh-explanation";

export default function ExplainPage() {
  return (
    <main className="mx-auto max-w-7xl px-6 py-12 sm:py-16">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Link href="/" className="text-sm text-zinc-500 transition hover:text-zinc-200">
          ← Collision Lab
        </Link>
        <div className="flex flex-wrap gap-2">
          <Link href="/demo/" className="rounded-full border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100">
            Experiment
          </Link>
          <Link href="/analysis/" className="rounded-full border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100">
            Analysis
          </Link>
        </div>
      </div>

      <div className="mt-10 max-w-4xl">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">Explanation mode · 2D</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-zinc-50 sm:text-6xl">
          Understand the idea before scaling it up.
        </h1>
        <p className="mt-5 max-w-3xl text-lg leading-8 text-zinc-400">
          Start with a handful of labeled objects and walk through each decision. Flat algorithms share one scene; hierarchy and partition lessons use purpose-built deterministic views so pruning, slack, and spatial subdivision are visually unmistakable.
        </p>
      </div>

      <div className="mt-10">
        <ExplanationMode />
      </div>

      <div className="mt-14">
        <div className="mb-6 max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-600">Hierarchy lesson · Static</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-100">Static BVH: reject groups, not objects.</h2>
          <p className="mt-3 leading-7 text-zinc-500">
            This lesson switches to eight sparse objects because the important idea is hierarchical: a single parent-bound test can prove that several descendant pairs are impossible. Step through the actual Rust traversal below; orange node frames mark a whole-subtree rejection.
          </p>
        </div>
        <StaticBvhExplanation />
      </div>

      <div className="mt-14">
        <div className="mb-6 max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-600">Hierarchy lesson · Dynamic</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-100">Dynamic AABB tree: reserve space for motion.</h2>
          <p className="mt-3 leading-7 text-zinc-500">
            A moving object does not need to restructure the hierarchy every frame. Its enlarged fat AABB acts as a reserve. Advance the deterministic Rust simulation until the exact collider finally escapes that reserve and must be reinserted. Green marks a contained update; orange marks the reinsertion path.
          </p>
        </div>
        <DynamicAabbExplanation />
      </div>

      <div className="mt-14">
        <div className="mb-6 max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-600">Spatial partition lesson · 3D → 2D slices</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-100">Octree: four quadrants in each of two Z halves.</h2>
          <p className="mt-3 leading-7 text-zinc-500">
            Instead of pretending the octree is a quadtree, this lesson keeps the actual eight Rust child boxes and projects them into two flat slices. Step through the lower/high X, Y, and Z choices that define every octant.
          </p>
        </div>
        <OctreeExplanation />
      </div>

      <section className="mt-12 grid gap-4 md:grid-cols-3">
        {[
          ["Purpose-built scenes", "Flat algorithms share one comparison scene; hierarchy and partition lessons use deterministic views chosen to expose each structural idea clearly."],
          ["Rust-backed", "Overlap results, memberships, active sets, BVH traversal, fat bounds, reinsertion decisions, and octree child membership come from Rust/WASM."],
          ["One idea at a time", "Explanation mode deliberately trades scale for clarity; the Experiment and Analysis modes handle realistic workloads and quantitative tradeoffs."],
        ].map(([title, copy]) => (
          <div key={title} className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5">
            <h2 className="font-semibold text-zinc-200">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-500">{copy}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
