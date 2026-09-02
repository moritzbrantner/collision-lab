import Link from "next/link";
import { notFound } from "next/navigation";

import { AlgorithmVisual } from "../../../components/algorithm-visual";
import { algorithms, getAlgorithm } from "../../../lib/algorithms";

export const dynamicParams = false;

export function generateStaticParams() {
  return algorithms.map((algorithm) => ({ slug: algorithm.slug }));
}

export default async function AlgorithmPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const algorithm = getAlgorithm(slug);

  if (!algorithm) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-14 sm:py-20">
      <Link href="/#algorithms" className="text-sm text-zinc-500 transition hover:text-zinc-200">
        ← All algorithms
      </Link>

      <div className="mt-8 grid gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-start">
        <div>
          <div className="flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
            <span>{algorithm.family}</span>
            <span>·</span>
            <span>{algorithm.role}</span>
          </div>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-zinc-50 sm:text-5xl">{algorithm.name}</h1>
          <p className="mt-5 text-lg leading-8 text-zinc-400">{algorithm.summary}</p>
          <div className="mt-6 flex flex-wrap gap-2 text-sm text-zinc-300">
            <span className="rounded-full border border-zinc-700 px-3 py-1.5">{algorithm.complexity}</span>
            <span className="rounded-full border border-zinc-700 px-3 py-1.5">{algorithm.memory}</span>
          </div>
        </div>
        <AlgorithmVisual slug={algorithm.slug} />
      </div>

      <div className="mt-16 grid gap-12 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-12">
          <section>
            <h2 className="text-2xl font-semibold text-zinc-100">How it works</h2>
            <div className="mt-5 space-y-5 text-base leading-7 text-zinc-400">
              {algorithm.explanation.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-zinc-100">Algorithm steps</h2>
            <ol className="mt-5 space-y-3">
              {algorithm.steps.map((step, index) => (
                <li key={step} className="flex gap-4 rounded-xl border border-zinc-800 bg-zinc-900/30 p-4 text-zinc-400">
                  <span className="font-mono text-sm text-zinc-600">{String(index + 1).padStart(2, "0")}</span>
                  <span className="leading-6">{step}</span>
                </li>
              ))}
            </ol>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-zinc-100">Pseudocode</h2>
            <pre className="mt-5 overflow-x-auto rounded-2xl border border-zinc-800 bg-zinc-950 p-5 text-sm leading-6 text-zinc-300">
              <code>{algorithm.pseudocode}</code>
            </pre>
          </section>
        </div>

        <aside className="space-y-6 lg:sticky lg:top-8">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/35 p-5">
            <h2 className="font-semibold text-zinc-200">Good fit</h2>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-zinc-500">
              {algorithm.bestFor.map((item) => <li key={item}>• {item}</li>)}
            </ul>
          </div>
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/35 p-5">
            <h2 className="font-semibold text-zinc-200">Tradeoffs</h2>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-zinc-500">
              {algorithm.tradeoffs.map((item) => <li key={item}>• {item}</li>)}
            </ul>
          </div>
          <a
            href={`https://github.com/moritzbrantner/rust-kernels/blob/main/${algorithm.sourcePath}`}
            className="block rounded-2xl border border-zinc-800 p-5 text-sm font-semibold text-zinc-300 transition hover:border-zinc-600 hover:text-zinc-50"
          >
            View Rust implementation →
          </a>
        </aside>
      </div>
    </main>
  );
}
