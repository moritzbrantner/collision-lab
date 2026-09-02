import Link from "next/link";

import { ExplanationMode } from "../../components/explanation-mode";

export default function ExplainPage() {
  return (
    <main className="mx-auto max-w-7xl px-6 py-12 sm:py-16">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Link href="/" className="text-sm text-zinc-500 transition hover:text-zinc-200">
          ← Collision Lab
        </Link>
        <Link href="/demo/" className="rounded-full border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100">
          Switch to 3D experiment mode →
        </Link>
      </div>

      <div className="mt-10 max-w-4xl">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">Explanation mode · 2D</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-zinc-50 sm:text-6xl">
          Understand the idea before scaling it up.
        </h1>
        <p className="mt-5 max-w-3xl text-lg leading-8 text-zinc-400">
          The full playground is useful for experiments, but hundreds of moving boxes can hide the core idea. This mode keeps the same six objects and walks through each broad phase one decision at a time.
        </p>
      </div>

      <div className="mt-10">
        <ExplanationMode />
      </div>

      <section className="mt-12 grid gap-4 md:grid-cols-3">
        {[
          ["Same scene", "The objects do not move when you switch algorithms, so differences in work are easy to compare."],
          ["Rust-backed", "Overlap results and optimized execution traces come from the same Rust/WASM kernels as experiment mode."],
          ["Deliberately small", "Six labeled rectangles are enough to expose candidate generation, rejection, and pruning without visual noise."],
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
