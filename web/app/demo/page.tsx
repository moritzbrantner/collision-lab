import Link from "next/link";

import { InteractiveCollisionDemo } from "../../components/interactive-collision-demo";

export default function DemoPage() {
  return (
    <main className="mx-auto max-w-7xl px-6 py-12 sm:py-16">
      <Link href="/" className="text-sm text-zinc-500 transition hover:text-zinc-200">
        ← Collision Lab
      </Link>
      <div className="mt-8 max-w-3xl">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">Interactive demo</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-zinc-50 sm:text-5xl">Run the Rust broad phases in your browser.</h1>
        <p className="mt-5 text-lg leading-8 text-zinc-400">
          The same deterministic Rust scene generator and collision kernels used by the command-line lab are compiled to WebAssembly. Switch algorithms, change scene density, and inspect the work each broad phase avoids.
        </p>
      </div>
      <div className="mt-10">
        <InteractiveCollisionDemo />
      </div>
    </main>
  );
}
