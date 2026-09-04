"use client";

import { useEffect, useState } from "react";

import { ensureZombieArena3dWasm } from "../lib/zombie-arena-3d-runtime";
import { ZombieArena3dNavigationComparison } from "./zombie-arena-3d-navigation-comparison";
import { ZombieArena3dScenario } from "./zombie-arena-3d-scenario";
import { ZombieArenaCharacterLab } from "./zombie-arena-character-lab";

export function ZombieArena3dRuntime() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void ensureZombieArena3dWasm()
      .then(() => {
        if (active) setReady(true);
      })
      .catch((reason: unknown) => {
        if (active) setError(String(reason));
      });
    return () => {
      active = false;
    };
  }, []);

  if (error) {
    return (
      <section className="rounded-3xl border border-red-900/60 bg-red-950/25 p-6 text-sm text-red-300">
        Zombie Arena 3D runtime could not start: {error}
      </section>
    );
  }

  if (!ready) {
    return (
      <section className="grid min-h-[36rem] place-items-center rounded-3xl border border-zinc-800 bg-zinc-950 text-sm text-zinc-500">
        Loading the shared deterministic Rust/WASM runtime…
      </section>
    );
  }

  return (
    <>
      <ZombieArena3dScenario />
      <ZombieArenaCharacterLab />
      <ZombieArena3dNavigationComparison />
    </>
  );
}
