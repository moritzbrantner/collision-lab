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
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            <Link href="/" className="font-semibold tracking-tight text-zinc-50">
              collision-lab
            </Link>
            <nav className="flex items-center gap-5 text-sm text-zinc-400">
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
