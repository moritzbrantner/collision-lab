import Link from "next/link";

import { AnalyticalPrimitivesExplanation } from "../../components/analytical-primitives-explanation";
import { DynamicAabbExplanation } from "../../components/dynamic-aabb-explanation";
import { ExplanationMode } from "../../components/explanation-mode";
import { Obb3SatExplanation } from "../../components/obb3-sat-explanation";
import { OctreeExplanation } from "../../components/octree-explanation";
import { SatExplanation } from "../../components/sat-explanation";
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
          <Link href="/compute/" className="rounded-full border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100">
            Compute
          </Link>
        </div>
      </div>

      <div className="mt-10 max-w-4xl">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">Explanation mode · 2D + projected 3D</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-zinc-50 sm:text-6xl">
          Understand the idea before scaling it up.
        </h1>
        <p className="mt-5 max-w-3xl text-lg leading-8 text-zinc-400">
          Start with a handful of labeled objects and walk through each decision. Broad-phase lessons explain how to avoid impossible pairs; the narrow-phase chapter then asks the exact geometry question for the candidates that survive.
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

      <div className="mt-20 border-t border-zinc-800 pt-14">
        <div className="mb-7 max-w-4xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">New chapter · Narrow phase</p>
          <h2 className="mt-3 text-4xl font-semibold tracking-tight text-zinc-100">From “maybe these are near” to “do the shapes actually intersect?”</h2>
          <p className="mt-4 text-lg leading-8 text-zinc-500">
            The broad phase is intentionally conservative: it should cheaply discard impossible pairs without missing real collisions. Narrow phase receives the survivors and performs shape-specific geometry. We start with primitives whose answer can be written as a small analytical formula, then generalize the same separating-axis proof from 2D to full 3D oriented boxes.
          </p>
        </div>
        <AnalyticalPrimitivesExplanation />
      </div>

      <div className="mt-14">
        <div className="mb-6 max-w-4xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-600">Narrow phase · Generalized separating axes</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-100">SAT in 2D: rotate the boxes, then rotate the axes you test.</h2>
          <p className="mt-3 leading-7 text-zinc-500">
            AABBs could use the world axes because their faces were aligned with them. Oriented rectangles bring their own local X/Y directions. Step through all four candidate axes below and watch the Rust projection test search for a single gap.
          </p>
        </div>
        <SatExplanation />
      </div>

      <div className="mt-14">
        <div className="mb-6 max-w-4xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-600">Narrow phase · Full 3D SAT</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-100">The same proof scales to 15 candidate axes in 3D.</h2>
          <p className="mt-3 leading-7 text-zinc-500">
            Six face normals catch face separation. Nine pairwise edge cross products catch edge-edge separation that no face axis can prove. The view below projects the actual Rust OBB state into SVG while every collision decision remains in `geometry-kernels`.
          </p>
        </div>
        <Obb3SatExplanation />
      </div>

      <section className="mt-14 overflow-hidden rounded-3xl border border-cyan-900/50 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.10),transparent_22rem)] p-6 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-400/70">Continue the narrow phase</p>
        <div className="mt-3 grid items-end gap-6 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div className="max-w-4xl">
            <h2 className="text-3xl font-semibold tracking-tight text-zinc-100">Beyond boxes: convex proxies, support mappings, GJK, and EPA.</h2>
            <p className="mt-3 leading-7 text-zinc-500">
              SAT is a natural bridge into general convex collision. The next page shows how detailed shapes become convex proxies, how a support function exposes their extremes, how GJK searches the Minkowski difference, and how EPA turns an overlap simplex into penetration depth.
            </p>
          </div>
          <Link href="/convex/" className="inline-flex rounded-xl bg-cyan-100 px-5 py-3 text-sm font-semibold text-cyan-950 transition hover:bg-white">
            Open convex collision →
          </Link>
        </div>
      </section>

      <section className="mt-12 grid gap-4 md:grid-cols-3">
        {[
          ["Broad phase filters", "Grid, sweep, BVH, dynamic trees, and octrees reduce the pair set. Their job is not necessarily to understand the exact render/physics shape."],
          ["Narrow phase proves", "Sphere/AABB formulas and 2D/3D OBB SAT answer the exact primitive collision question for one surviving pair using Rust geometry kernels."],
          ["Generalization path", "SAT establishes projection-based convex reasoning. The convex deep dive continues with support mappings, GJK, EPA, and shape approximation."],
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
