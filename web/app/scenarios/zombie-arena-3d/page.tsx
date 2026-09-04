import type { Metadata } from "next";
import Link from "next/link";

import { ZombieArena3dRuntime } from "../../../components/zombie-arena-3d-runtime";

export const metadata: Metadata = {
  title: "Zombie Arena 3D",
  description:
    "A deterministic third-person 3D zombie arena with Rust/WASM physics, projectile CCD, collision broad phases, pathfinding, and renderer-independent humanoid animation experiments.",
};

export default function ZombieArena3dPage() {
  return (
    <main className="mx-auto max-w-[92rem] px-4 py-8 sm:px-6 sm:py-12">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <Link href="/scenarios/" className="text-sm text-zinc-500 transition hover:text-zinc-200">
          ← Scenarios
        </Link>
        <Link
          href="/scenarios/zombie-arena/"
          className="text-sm text-zinc-500 transition hover:text-zinc-200"
        >
          Compare the 2D arena →
        </Link>
      </div>
      <ZombieArena3dRuntime />
    </main>
  );
}
