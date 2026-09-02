import Link from "next/link";

import { AlgorithmVisual } from "../components/algorithm-visual";
import { algorithms } from "../lib/algorithms";

export default function HomePage() {
  return (
    <main>
      <section className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
        <div className="max-w-3xl">
          <p className="mb-4 text-sm font-semibold uppercase tracking-[0.22em] text-zinc-500">Collision detection, made inspectable</p>
          <h1 className="text-4xl font-semibold tracking-tight text-zinc-50 sm:text-6xl">
            Learn what each broad-phase algorithm actually does.
          </h1>
          <p className="mt-6 text-lg leading-8 text-zinc-400">
            Collision Lab pairs deterministic Rust experiments with visual explanations. Every optimized algorithm must match the same correctness oracle before performance comparisons matter.
          </p>
        </div>

        <div className="mt-12 grid gap-4 sm:grid-cols-3">
          {[
            ["2", "algorithms in the MVP"],
            ["exact", "pair-set parity required"],
            ["deterministic", "scene generation and reporting"],
          ].map(([value, label]) => (
            <div key={label} className="rounded-2xl border border-zinc-800 bg-zinc-900/45 p-5">
              <div className="text-xl font-semibold text-zinc-100">{value}</div>
              <div className="mt-1 text-sm text-zinc-500">{label}</div>
            </div>
          ))}
        </div>
      </section>

      <section id="algorithms" className="mx-auto max-w-6xl px-6 pb-20">
        <div className="mb-8 flex items-end justify-between gap-6">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">Algorithm catalog</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-100">Current implementations</h2>
          </div>
          <p className="hidden max-w-md text-right text-sm leading-6 text-zinc-500 md:block">
            The catalog is intentionally data-driven so new kernels can gain a page without redesigning the site.
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
              <Link
                href={`/algorithms/${algorithm.slug}/`}
                className="mt-6 inline-flex items-center text-sm font-semibold text-zinc-100 underline decoration-zinc-600 underline-offset-4 transition hover:decoration-zinc-200"
              >
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
              ["01", "Generate", "Create the same seeded 3D AABB scene."],
              ["02", "Oracle", "Run the simple naive implementation."],
              ["03", "Candidate", "Run the optimized broad phase."],
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
