import type { Metadata } from "next";
import Link from "next/link";

import { BlueNoiseTerrainScenario } from "../../../components/blue-noise-terrain-scenario";

export const metadata: Metadata = {
  title: "Blue-noise terrain",
  description:
    "A deterministic Rust/WASM collision scenario on an indexed triangle terrain generated from blue-noise sites.",
};

export default function BlueNoiseTerrainPage() {
  return (
    <main className="mx-auto max-w-[92rem] px-4 py-8 sm:px-6 sm:py-12">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/scenarios/" className="text-sm text-zinc-500 transition hover:text-zinc-200">
            ← Scenarios
          </Link>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-50">
            Blue-noise terrain
          </h1>
        </div>
        <p className="max-w-xl text-sm leading-6 text-zinc-400">
          Walk and jump on the actual indexed mesh. The cyan face and normal are the Rust-owned support query, not a renderer approximation.
        </p>
      </div>
      <BlueNoiseTerrainScenario />
    </main>
  );
}
