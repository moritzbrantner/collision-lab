"use client";

import { useEffect, useMemo, useState } from "react";

import initZombie3dWasm, {
  ZombieArena3dWorld,
} from "../lib/zombie-arena-3d-wasm-pkg/zombie_arena_3d_wasm";

type NavigationMode = "astar" | "flow-field";

type Snapshot = {
  frame: number;
  navigationMode: NavigationMode;
  player: { position: [number, number, number] };
  stats: {
    zombies: number;
    pathReplans: number;
    pathExpanded: number;
    flowFieldBuilds: number;
    flowFieldExpanded: number;
    flowFieldFollowers: number;
    steeringAdjustments: number;
    destroyedBarricadesTotal: number;
  };
};

type BenchmarkResult = {
  mode: NavigationMode;
  frames: number;
  elapsedMs: number;
  planningBuilds: number;
  expandedCells: number;
  followerSteps: number;
  steeringAdjustments: number;
  finalZombies: number;
};

const SEED = 0x5a173d;
const BROAD_PHASE = "uniform-grid";
const FRAME_OPTIONS = [300, 600, 1200] as const;

export function ZombieArena3dNavigationComparison() {
  const [ready, setReady] = useState(false);
  const [running, setRunning] = useState(false);
  const [frames, setFrames] = useState<number>(600);
  const [results, setResults] = useState<BenchmarkResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void initZombie3dWasm()
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

  const run = () => {
    if (!ready || running) return;
    setRunning(true);
    setError(null);

    window.setTimeout(() => {
      try {
        const astar = benchmark("astar", frames);
        const flowField = benchmark("flow-field", frames);
        setResults([astar, flowField]);
      } catch (reason) {
        setError(String(reason));
      } finally {
        setRunning(false);
      }
    }, 0);
  };

  const expansionRatio = useMemo(() => {
    if (!results) return null;
    const [astar, flow] = results;
    if (astar.expandedCells === 0) return null;
    return flow.expandedCells / astar.expandedCells;
  }, [results]);

  return (
    <section className="mt-8 overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-950">
      <div className="border-b border-zinc-800 p-5 sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-600">
          Navigation experiment · same Rust/WASM world
        </p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-5">
          <div className="max-w-3xl">
            <h2 className="text-2xl font-semibold text-zinc-100">
              Per-agent A* vs one shared flow field
            </h2>
            <p className="mt-3 text-sm leading-6 text-zinc-500">
              Both runs use the same seed, fixed timestep, stationary player, obstacle field, broad phase, zombie spawning, and local separation. Only the global navigation mode changes. Planning counters are deterministic; browser runtime is observational.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-600">
              Simulated frames
              <select
                value={frames}
                disabled={running}
                onChange={(event) => setFrames(Number(event.target.value))}
                className="mt-2 block rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-medium normal-case tracking-normal text-zinc-200 outline-none focus:border-zinc-500 disabled:opacity-50"
              >
                {FRAME_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {value} · {(value / 60).toFixed(0)} s
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={run}
              disabled={!ready || running}
              className="min-h-11 rounded-xl bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {running ? "Running…" : ready ? "Run comparison" : "Loading WASM…"}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="border-b border-red-900/50 bg-red-950/20 px-5 py-4 text-sm text-red-300 sm:px-6">
          Comparison failed: {error}
        </div>
      )}

      <div className="p-5 sm:p-6">
        {results ? (
          <>
            <div className="grid gap-4 lg:grid-cols-2">
              {results.map((result) => (
                <ResultCard key={result.mode} result={result} />
              ))}
            </div>
            <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900/35 p-4 text-sm leading-6 text-zinc-400">
              {expansionRatio === null ? (
                <p>No expansion ratio is available for this run.</p>
              ) : (
                <p>
                  The shared flow field expanded{" "}
                  <span className="font-mono font-semibold text-zinc-200">
                    {(expansionRatio * 100).toFixed(1)}%
                  </span>{" "}
                  as many navigation cells as all A* replans combined in this deterministic workload. It pays for a whole reachable cost field when rebuilt, then every zombie follows that shared result until the goal cell or obstacles change.
                </p>
              )}
            </div>
          </>
        ) : (
          <div className="grid min-h-44 place-items-center rounded-2xl border border-dashed border-zinc-800 px-6 text-center text-sm leading-6 text-zinc-600">
            Run the experiment to compare deterministic planning work. The playable arena above continues to use A* by default.
          </div>
        )}
      </div>
    </section>
  );
}

function ResultCard({ result }: { result: BenchmarkResult }) {
  const title = result.mode === "astar" ? "A* · per zombie" : "Flow field · shared";
  return (
    <article className="rounded-2xl border border-zinc-800 bg-zinc-900/35 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold text-zinc-100">{title}</h3>
        <span className="rounded-full border border-zinc-700 px-2.5 py-1 font-mono text-xs text-zinc-400">
          {result.frames} frames
        </span>
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-3">
        <Metric label={result.mode === "astar" ? "replans" : "field builds"} value={result.planningBuilds} />
        <Metric label="cells expanded" value={result.expandedCells} />
        <Metric label="follower steps" value={result.followerSteps} />
        <Metric label="steering adjustments" value={result.steeringAdjustments} />
        <Metric label="final zombies" value={result.finalZombies} />
        <Metric label="browser time" value={`${result.elapsedMs.toFixed(1)} ms`} />
      </dl>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-[0.13em] text-zinc-600">
        {label}
      </dt>
      <dd className="mt-1 font-mono text-sm font-semibold text-zinc-200">
        {typeof value === "number" ? value.toLocaleString() : value}
      </dd>
    </div>
  );
}

function benchmark(mode: NavigationMode, frames: number): BenchmarkResult {
  const world = new ZombieArena3dWorld(BROAD_PHASE, SEED);
  let planningBuilds = 0;
  let expandedCells = 0;
  let followerSteps = 0;
  let steeringAdjustments = 0;
  let finalZombies = 0;

  try {
    parseSnapshot(world.set_navigation_mode(mode));
    const started = performance.now();
    for (let frame = 0; frame < frames; frame += 1) {
      const snapshot = parseSnapshot(
        world.step_json(0, 0, 0, -0.04, -1, false, false),
      );
      if (mode === "astar") {
        planningBuilds += snapshot.stats.pathReplans;
        expandedCells += snapshot.stats.pathExpanded;
      } else {
        planningBuilds += snapshot.stats.flowFieldBuilds;
        expandedCells += snapshot.stats.flowFieldExpanded;
        followerSteps += snapshot.stats.flowFieldFollowers;
      }
      steeringAdjustments += snapshot.stats.steeringAdjustments;
      finalZombies = snapshot.stats.zombies;
    }
    return {
      mode,
      frames,
      elapsedMs: performance.now() - started,
      planningBuilds,
      expandedCells,
      followerSteps,
      steeringAdjustments,
      finalZombies,
    };
  } finally {
    world.free();
  }
}

function parseSnapshot(value: string): Snapshot {
  return JSON.parse(value) as Snapshot;
}
