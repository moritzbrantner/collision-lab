import Link from "next/link";

import { AlgorithmVisual } from "../components/algorithm-visual";
import { algorithms } from "../lib/algorithms";

export default function HomePage() {
  return (
    <main>
      <section className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
        <div className="max-w-4xl">
          <p className="mb-4 text-sm font-semibold uppercase tracking-[0.22em] text-zinc-500">Collision detection, made inspectable</p>
          <h1 className="text-4xl font-semibold tracking-tight text-zinc-50 sm:text-6xl">
            Learn it. Stress it. Analyze it.
          </h1>
          <p className="mt-6 max-w-3xl text-lg leading-8 text-zinc-400">
            Collision Lab uses the same deterministic Rust kernels in three complementary ways: tiny 2D explanations, moving 3D experiments, and measured scaling analysis.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/explain/" className="inline-flex rounded-xl bg-zinc-100 px-5 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-white">
              Learn in 2D →
            </Link>
            <Link href="/demo/" className="inline-flex rounded-xl border border-zinc-700 px-5 py-3 text-sm font-semibold text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100">
              Experiment in 3D
            </Link>
            <Link href="/analysis/" className="inline-flex rounded-xl border border-zinc-700 px-5 py-3 text-sm font-semibold text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100">
              Analyze scaling
            </Link>
          </div>
        </div>

        <div className="mt-12 grid gap-4 sm:grid-cols-3">
          {[
            [String(algorithms.length), "broad-phase implementations"],
            ["exact", "pair-set parity required"],
            ["3 modes", "explanation · experiment · analysis"],
          ].map(([value, label]) => (
            <div key={label} className="rounded-2xl border border-zinc-800 bg-zinc-900/45 p-5">
              <div className="text-xl font-semibold text-zinc-100">{value}</div>
              <div className="mt-1 text-sm text-zinc-500">{label}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="border-y border-zinc-800 bg-zinc-900/25">
        <div className="mx-auto grid max-w-6xl gap-6 px-6 py-12 lg:grid-cols-3">
          <ModeCard
            href="/explain/"
            eyebrow="Explanation"
            title="Few objects. One idea at a time."
            copy="Use a fixed 2D teaching scene, labels, stepping, active sets, cells, and rejected pairs to understand why an algorithm works."
            action="Learn in 2D →"
          />
          <ModeCard
            href="/demo/"
            eyebrow="Experiment"
            title="Moving worlds and visible data structures."
            copy="Run Rust kernels through WASM against moving 3D scenes, interaction matrices, sensors, retained trees, and algorithm helper geometry."
            action="Experiment in 3D →"
          />
          <ModeCard
            href="/analysis/"
            eyebrow="Analysis"
            title="Compare scaling and workload tradeoffs."
            copy="Measure exact AABB work across growing deterministic scenes and compare theoretical complexity with what the real implementations actually do."
            action="Analyze the algorithms →"
          />
        </div>
      </section>

      <section id="algorithms" className="mx-auto max-w-6xl px-6 py-20">
        <div className="mb-8 flex items-end justify-between gap-6">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">Algorithm catalog</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-100">Current implementations</h2>
          </div>
          <p className="hidden max-w-md text-right text-sm leading-6 text-zinc-500 md:block">
            Each page explains the algorithm; all three modes exercise the same Rust concepts through WebAssembly.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {algorithms.map((algorithm) => (
            <article key={algorithm.slug} className="rounded-3xl border border-zinc-800 bg-zinc-900/35 p-5 sm:p-7">
              <AlgorithmVisual slug={algorithm.slug} />
              <div className="mt-6 flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                <span>{algorithm.family}</span>
                <span>·</span>
                <span>{algorithm.role}</span>
              </div>
              <h3 className="mt-3 text-2xl font-semibold text-zinc-100">{algorithm.name}</h3>
              <p className="mt-3 leading-7 text-zinc-400">{algorithm.summary}</p>
              <div className="mt-5 flex flex-wrap gap-2 text-sm text-zinc-300">
                <span className="rounded-full border border-zinc-700 px-3 py-1">{algorithm.complexity}</span>
                <span className="rounded-full border border-zinc-700 px-3 py-1">{algorithm.memory}</span>
              </div>
              <Link href={`/algorithms/${algorithm.slug}/`} className="mt-6 inline-flex items-center text-sm font-semibold text-zinc-100 underline decoration-zinc-600 underline-offset-4 transition hover:decoration-zinc-200">
                Open explanation →
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section className="border-y border-zinc-800 bg-zinc-900/25">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <h2 className="text-2xl font-semibold text-zinc-100">How the lab evaluates an algorithm</h2>
          <div className="mt-8 grid gap-4 md:grid-cols-4">
            {[
              ["01", "Generate", "Create a deterministic scene or a named teaching preset."],
              ["02", "Oracle", "Run the simple naive implementation."],
              ["03", "Candidate", "Run each optimized broad phase."],
              ["04", "Verify", "Require exact sorted pair-set parity, then compare work."],
            ].map(([number, title, copy]) => (
              <div key={number} className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5">
                <div className="text-xs font-semibold text-zinc-600">{number}</div>
                <div className="mt-3 font-semibold text-zinc-200">{title}</div>
                <p className="mt-2 text-sm leading-6 text-zinc-500">{copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

function ModeCard({ href, eyebrow, title, copy, action }: { href: string; eyebrow: string; title: string; copy: string; action: string }) {
  return (
    <Link href={href} className="group rounded-3xl border border-zinc-800 bg-zinc-950/70 p-7 transition hover:border-zinc-600">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-600">{eyebrow}</p>
      <h2 className="mt-3 text-2xl font-semibold text-zinc-100">{title}</h2>
      <p className="mt-3 leading-7 text-zinc-500">{copy}</p>
      <span className="mt-5 inline-flex text-sm font-semibold text-zinc-300 transition group-hover:text-white">{action}</span>
    </Link>
  );
}
