import Link from "next/link";

import { InteractiveCollisionDemo } from "../../components/interactive-collision-demo";
import { StaticBvhExperiment } from "../../components/static-bvh-experiment";

export default function DemoPage() {
  return (
    <main className="mx-auto max-w-7xl px-6 py-12 sm:py-16">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Link href="/" className="text-sm text-zinc-500 transition hover:text-zinc-200">
          ← Collision Lab
        </Link>
        <div className="flex flex-wrap gap-2">
          <Link href="/explain/" className="rounded-full border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100">
            Explanation
          </Link>
          <Link href="/analysis/" className="rounded-full border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100">
            Analysis
          </Link>
        </div>
      </div>
      <div className="mt-8 max-w-3xl">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">
          Interactive simulation
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-zinc-50 sm:text-5xl">
          Watch Rust broad phases react to a moving world.
        </h1>
        <p className="mt-5 text-lg leading-8 text-zinc-400">
          Mix fixed obstacles with moving bodies, then Play, Pause, or Step through deterministic simulation frames. Motion, world-boundary bounces, scene generation, and collision detection all run in Rust/WASM; Three.js only renders the resulting state.
        </p>
      </div>
      <div className="mt-10">
        <InteractiveCollisionDemo />
      </div>

      <section className="mt-16">
        <div className="mb-6 max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-600">Focused helper experiment</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-100">Static BVH traversal in 3D.</h2>
          <p className="mt-3 leading-7 text-zinc-500">
            The general playground shows the whole workload. This focused inspector isolates one hierarchy traversal and renders the two Rust BVH node bounds being compared at each step, including subtree prunes and exact leaf tests.
          </p>
        </div>
        <StaticBvhExperiment />
      </section>

      <section className="mt-12 grid gap-4 md:grid-cols-3">
        <article className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5">
          <h2 className="font-semibold text-zinc-200">Static bodies</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-500">
            Fixed world geometry does not move between frames. This is the natural home for walls, terrain chunks, buildings, and other persistent obstacles.
          </p>
        </article>
        <article className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5">
          <h2 className="font-semibold text-zinc-200">Dynamic bodies</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-500">
            Moving AABBs have deterministic velocities and bounce at the world boundary. Their changing neighborhoods make temporal-coherence strategies visible.
          </p>
        </article>
        <article className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5">
          <h2 className="font-semibold text-zinc-200">Real helper state</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-500">
            Grid cells, sweep planes, octree subdivisions, dynamic-tree fat bounds, and static-BVH traversal boxes are all projections of Rust algorithm state rather than decorative frontend approximations.
          </p>
        </article>
      </section>
    </main>
  );
}
