import Link from "next/link";

import { AnalysisMode } from "../../components/analysis-mode";
import { PresetAnalysis } from "../../components/preset-analysis";

export default function AnalysisPage() {
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
          <Link href="/compute/" className="rounded-full border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100">
            Compute
          </Link>
        </div>
      </div>

      <div className="mt-10 max-w-4xl">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">Analysis</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-zinc-50 sm:text-6xl">
          Measure the tradeoffs instead of guessing them.
        </h1>
        <p className="mt-5 max-w-3xl text-lg leading-8 text-zinc-400">
          Explanation shows why an algorithm works. Experiment shows it moving in a world. Analysis compares how much work each real Rust implementation performs as both scale and workload structure change.
        </p>
      </div>

      <div className="mt-10">
        <AnalysisMode />
      </div>

      <div className="mt-12">
        <PresetAnalysis />
      </div>
    </main>
  );
}
