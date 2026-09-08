import Link from "next/link";

import { RendererComparison } from "../../components/renderer-comparison";

export default function RenderersPage() {
  return (
    <main className="mx-auto max-w-7xl px-6 py-12 sm:py-16">
      <Link href="/demo/" className="text-sm text-zinc-500 transition hover:text-zinc-200">
        ← Interactive collision demo
      </Link>
      <div className="mt-8 max-w-4xl">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">
          Browser renderer experiment
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-zinc-50 sm:text-5xl">
          Three.js versus Rust/WASM wgpu.
        </h1>
        <p className="mt-5 text-lg leading-8 text-zinc-400">
          This page keeps Collision Lab&apos;s deterministic Rust scene fixed and swaps only the browser renderer. Use the URL query parameter <code className="rounded bg-zinc-900 px-1.5 py-0.5 text-sm text-zinc-300">renderer=three</code> or <code className="rounded bg-zinc-900 px-1.5 py-0.5 text-sm text-zinc-300">renderer=wgpu</code> so browser runs and profiler evidence are reproducible.
        </p>
      </div>

      <div className="mt-10">
        <RendererComparison />
      </div>

      <section className="mt-10 grid gap-4 md:grid-cols-2">
        <article className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5">
          <h2 className="font-semibold text-zinc-200">Held constant</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-500">
            Seed, clustered scene generation, Rust simulation, object count, fixed timestep, camera parameters, viewport, cube geometry, and flat material intent are shared between runs.
          </p>
        </article>
        <article className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5">
          <h2 className="font-semibold text-zinc-200">Deliberately different</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-500">
            One adapter updates a Three.js InstancedMesh and submits through WebGL. The other calls a Rust WASM renderer whose wgpu instance is restricted to BrowserWebGPU and submits directly to the canvas WebGPU surface.
          </p>
        </article>
      </section>
    </main>
  );
}
