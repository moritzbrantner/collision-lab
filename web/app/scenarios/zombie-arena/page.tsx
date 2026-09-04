import type { Metadata } from "next";
import Link from "next/link";

import { ZombieArenaScenario } from "../../../components/zombie-arena-scenario";

export const metadata: Metadata = {
  title: "Zombie Arena",
  description: "A deterministic top-down zombie arena that combines Collision Lab broad phases, kinematic collision, destructible barricades, and projectile CCD.",
};

export default function ZombieArenaPage() {
  return (
    <main className="mx-auto max-w-7xl px-6 py-12 sm:py-16">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Link href="/scenarios/" className="text-sm text-zinc-500 transition hover:text-zinc-200">
          ← Playable scenarios
        </Link>
        <div className="flex flex-wrap gap-2">
          <Link href="/explain/" className="rounded-full border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100">
            Explanation
          </Link>
          <Link href="/convex/" className="rounded-full border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100">
            Convex
          </Link>
          <Link href="/analysis/" className="rounded-full border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100">
            Analysis
          </Link>
        </div>
      </div>

      <div className="mt-10 max-w-5xl">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">
          Full-system scenario · Zombie Arena
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-zinc-50 sm:text-6xl">
          One tiny game. Several collision problems at once.
        </h1>
        <p className="mt-5 max-w-4xl text-lg leading-8 text-zinc-400">
          A static arena gives the world structure. Zombies create a growing dynamic-body workload. Player-built barricades mutate that structure during play. The pistol adds fast projectiles whose swept collision test must catch hits that a discrete endpoint test could miss.
        </p>
      </div>

      <div className="mt-10">
        <ZombieArenaScenario />
      </div>

      <section className="mt-12 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          [
            "Static + mutable world",
            "Outer walls and fixed obstacles stay static, while snapped barricades can be inserted and later removed when zombie damage reaches zero.",
          ],
          [
            "Kinematic actors",
            "Player and zombies use axis-separated movement against exact wall AABBs, producing simple wall sliding without introducing a rigid-body solver.",
          ],
          [
            "Broad-phase parity",
            "Naive, grid, sweep, BVH, dynamic-tree, and octree modes feed the same actor-overlap behavior. Changing the algorithm should change work, not the game result.",
          ],
          [
            "Projectile CCD",
            "Each pistol segment is tested against Minkowski-expanded target AABBs and resolves the earliest time of impact, so fast bullets cannot tunnel through thin geometry.",
          ],
        ].map(([title, copy]) => (
          <div key={title} className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5">
            <h2 className="font-semibold text-zinc-200">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-500">{copy}</p>
          </div>
        ))}
      </section>

      <section className="mt-12 rounded-3xl border border-zinc-800 bg-zinc-900/25 p-6 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-600">
          Deliberate boundary
        </p>
        <h2 className="mt-3 text-2xl font-semibold text-zinc-100">
          This is a collision workload, not the beginning of a private game engine.
        </h2>
        <p className="mt-3 max-w-4xl leading-7 text-zinc-500">
          Zombie Arena owns only scenario rules: spawning, health, shooting, building, and direct pursuit. Reusable broad phases continue to come from the shared kernels, while the scenario-specific Rust/WASM crate keeps the deterministic game state out of the React rendering layer. A future rigid-body solver is unnecessary for this slice.
        </p>
      </section>
    </main>
  );
}
