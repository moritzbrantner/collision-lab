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
          Browser renderer benchmark
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-zinc-50 sm:text-5xl">
          WebGL2, Three.js WebGPU, and Rust/WASM wgpu.
        </h1>
        <p className="mt-5 text-lg leading-8 text-zinc-400">
          Collision Lab keeps the deterministic Rust scene fixed and swaps only the browser renderer boundary. Reproducible runs use <code className="rounded bg-zinc-900 px-1.5 py-0.5 text-sm text-zinc-300">renderer=three</code>, <code className="rounded bg-zinc-900 px-1.5 py-0.5 text-sm text-zinc-300">renderer=three-webgpu</code>, or <code className="rounded bg-zinc-900 px-1.5 py-0.5 text-sm text-zinc-300">renderer=wgpu</code> together with explicit object and frame counts.
        </p>
      </div>

      <div className="mt-10">
        <RendererComparison />
      </div>

      <section className="mt-10 grid gap-4 md:grid-cols-3">
        <article className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5">
          <h2 className="font-semibold text-zinc-200">Held constant</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-500">
            Seed, clustered scene generation, Rust simulation, object count, fixed timestep, camera parameters, viewport, cube geometry, and flat material intent are shared between runs.
          </p>
        </article>
        <article className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5">
          <h2 className="font-semibold text-zinc-200">Measured separately</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-500">
            CPU submission, simulation plus JSON/packing transfer, RAF cadence, renderer initialization, resource bytes, and optional GPU timestamp samples stay distinct so one bottleneck cannot masquerade as another.
          </p>
        </article>
        <article className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5">
          <h2 className="font-semibold text-zinc-200">Evidence boundary</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-500">
            CI software-GPU runs are deterministic regression evidence. Hardware-browser runs on this Pages surface are the evidence for real device performance; unsupported GPU timing is reported as unavailable rather than inferred.
          </p>
        </article>
      </section>
    </main>
  );
}
