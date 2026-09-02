import Link from "next/link";

import { ComputeMode } from "../../components/compute-mode";

export default function ComputePage() {
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
          <Link href="/demo/" className="rounded-full border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100">
            Experiment
          </Link>
          <Link href="/analysis/" className="rounded-full border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100">
            Analysis
          </Link>
        </div>
      </div>

      <div className="mt-10 max-w-4xl">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">Compute</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-zinc-50 sm:text-6xl">
          Change the algorithm. Change the machine. Measure both.
        </h1>
        <p className="mt-5 max-w-3xl text-lg leading-8 text-zinc-400">
          Algorithm choice and execution architecture are independent axes. Compare naive all-pairs and uniform-grid broad phases on Rust/WASM and WebGPU to see where pruning beats parallelism, where parallelism amplifies a good algorithm, and where transfer or synchronization costs erase a fast shader.
        </p>
      </div>

      <div className="mt-10">
        <ComputeMode />
      </div>
    </main>
  );
}
