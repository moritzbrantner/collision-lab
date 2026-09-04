import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Collision Lab",
    template: "%s · Collision Lab",
  },
  description: "Visual explanations and reproducible experiments for collision-detection algorithms.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <header className="border-b border-zinc-800/80 bg-zinc-950/75 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-6 py-4">
            <Link href="/" className="shrink-0 font-semibold tracking-tight text-zinc-50">
              collision-lab
            </Link>
            <nav className="flex flex-wrap items-center justify-end gap-x-5 gap-y-2 text-sm text-zinc-400">
              <Link href="/explain/" className="transition hover:text-zinc-50">
                Explanation
              </Link>
              <Link href="/convex/" className="transition hover:text-zinc-50">
                Convex
              </Link>
              <Link href="/scenarios/" className="transition hover:text-zinc-50">
                Scenarios
              </Link>
              <Link href="/demo/" className="transition hover:text-zinc-50">
                Experiment
              </Link>
              <Link href="/analysis/" className="transition hover:text-zinc-50">
                Analysis
              </Link>
              <Link href="/compute/" className="transition hover:text-zinc-50">
                Compute
              </Link>
              <Link href="/#algorithms" className="transition hover:text-zinc-50">
                Algorithms
              </Link>
              <a
                href="https://github.com/moritzbrantner/collision-lab"
                className="transition hover:text-zinc-50"
              >
                GitHub
              </a>
            </nav>
          </div>
        </header>
        {children}
        <footer className="mx-auto max-w-6xl px-6 py-12 text-sm text-zinc-500">
          Reusable kernels live in rust-kernels; experiments, comparisons, and explanations live here.
        </footer>
      </body>
    </html>
  );
}
