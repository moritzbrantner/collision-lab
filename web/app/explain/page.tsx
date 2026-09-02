import Link from "next/link";

import { ExplanationMode } from "../../components/explanation-mode";
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
          Start with a handful of labeled objects and walk through each decision. The first lessons compare flat broad phases on one shared scene; hierarchy lessons then get their own deliberately sparse scenes so pruning is visually unmistakable.
        </p>
      </div>

      <div className="mt-10">
        <ExplanationMode />
      </div>

      <div className="mt-14">
        <div className="mb-6 max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-600">Next concept · Hierarchies</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-100">Static BVH: reject groups, not objects.</h2>
          <p className="mt-3 leading-7 text-zinc-500">
            This lesson switches to eight sparse objects because the important idea is hierarchical: a single parent-bound test can prove that several descendant pairs are impossible. Step through the actual Rust traversal below.
          </p>
        </div>
        <StaticBvhExplanation />
      </div>

      <section className="mt-12 grid gap-4 md:grid-cols-3">
        {[
          ["Purpose-built scenes", "Flat algorithms share one six-object comparison scene; hierarchy lessons use tiny scenes chosen to expose pruning clearly."],
          ["Rust-backed", "Overlap results, memberships, active sets, BVH nodes, and traversal decisions come from the same Rust/WASM kernels used elsewhere."],
          ["One idea at a time", "Explanation mode deliberately trades scale for clarity; the Experiment and Analysis modes handle realistic workloads."],
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
