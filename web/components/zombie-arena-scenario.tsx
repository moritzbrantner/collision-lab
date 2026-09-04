"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import initZombieWasm, {
  ZombieArenaWorld,
} from "../lib/zombie-arena-wasm-pkg/zombie_arena_wasm";

type Vec2 = [number, number];

type ActorSnapshot = {
  id: number;
  position: Vec2;
  half: Vec2;
  health: number;
  maxHealth: number;
};

type PlayerSnapshot = ActorSnapshot & {
  aim: Vec2;
};

type WallSnapshot = {
  id: number;
  position: Vec2;
  half: Vec2;
  health: number;
  maxHealth: number;
  destructible: boolean;
};

type BulletSnapshot = {
  id: number;
  position: Vec2;
  previousPosition: Vec2;
  radius: number;
};

type SweepSnapshot = {
  from: Vec2;
  to: Vec2;
  hit: Vec2 | null;
  hitKind: "wall" | "zombie" | null;
};

type ArenaSnapshot = {
  frame: number;
  algorithm: string;
  worldHalf: number;
  fixedDt: number;
  buildGrid: number;
  player: PlayerSnapshot;
  zombies: ActorSnapshot[];
  walls: WallSnapshot[];
  bullets: BulletSnapshot[];
  debug: {
    overlapPairs: [number, number][];
    sweeps: SweepSnapshot[];
  };
  stats: {
    zombies: number;
    staticWalls: number;
    barricades: number;
    bullets: number;
    kills: number;
    shots: number;
    builds: number;
    possiblePairs: number;
    aabbTests: number;
    occupiedCells: number;
    overlaps: number;
    ccdTests: number;
    ccdHits: number;
    destroyedBarricades: number;
  };
  gameOver: boolean;
};

const WIDTH = 900;
const HEIGHT = 700;
const ARENA_SIDE = 650;
const ARENA_X = (WIDTH - ARENA_SIDE) / 2;
const ARENA_Y = 24;
const SEED = 0x5a17cafe;
const DEFAULT_ALGORITHM = "uniform-grid";
const ALGORITHMS = [
  ["naive", "Naive all-pairs"],
  ["uniform-grid", "Uniform Grid"],
  ["sweep-and-prune", "Sweep & Prune"],
  ["static-bvh", "Static BVH"],
  ["dynamic-aabb-tree", "Dynamic AABB Tree"],
  ["octree", "Octree"],
] as const;

export function ZombieArenaScenario() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const worldRef = useRef<ZombieArenaWorld | null>(null);
  const keysRef = useRef(new Set<string>());
  const mouseRef = useRef<Vec2>([5, 0]);
  const shootRef = useRef(false);
  const [snapshot, setSnapshot] = useState<ArenaSnapshot | null>(null);
  const [algorithm, setAlgorithm] = useState(DEFAULT_ALGORITHM);
  const [paused, setPaused] = useState(false);
  const [buildMode, setBuildMode] = useState(false);
  const [cursorWorld, setCursorWorld] = useState<Vec2>([5, 0]);
  const [showColliders, setShowColliders] = useState(false);
  const [showPairs, setShowPairs] = useState(false);
  const [showCcd, setShowCcd] = useState(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void initZombieWasm()
      .then(() => {
        if (cancelled) return;
        const world = new ZombieArenaWorld(DEFAULT_ALGORITHM, SEED);
        worldRef.current = world;
        setSnapshot(parseSnapshot(world.snapshot_json()));
        setReady(true);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(String(reason));
      });

    return () => {
      cancelled = true;
      worldRef.current?.free();
      worldRef.current = null;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === "w" || key === "a" || key === "s" || key === "d") {
        keysRef.current.add(key);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      keysRef.current.delete(event.key.toLowerCase());
    };
    const onBlur = () => {
      keysRef.current.clear();
      shootRef.current = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  useEffect(() => {
    if (!ready || paused) return;
    let frameHandle = 0;
    let previous = performance.now();
    let accumulator = 0;
    const fixedMs = 1000 / 60;

    const frame = (now: number) => {
      const elapsed = Math.min(100, now - previous);
      previous = now;
      accumulator += elapsed;
      let steps = 0;
      const world = worldRef.current;
      while (world && accumulator >= fixedMs && steps < 5) {
        const keys = keysRef.current;
        const moveX = Number(keys.has("d")) - Number(keys.has("a"));
        const moveY = Number(keys.has("w")) - Number(keys.has("s"));
        const aim = mouseRef.current;
        const next = world.step_json(moveX, moveY, aim[0], aim[1], shootRef.current);
        setSnapshot(parseSnapshot(next));
        accumulator -= fixedMs;
        steps += 1;
      }
      if (steps === 5) accumulator = 0;
      frameHandle = requestAnimationFrame(frame);
    };

    frameHandle = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(frameHandle);
  }, [paused, ready]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !snapshot) return;
    drawArena(canvas, snapshot, {
      showColliders,
      showPairs,
      showCcd,
      buildMode,
      cursorWorld,
    });
  }, [buildMode, cursorWorld, showCcd, showColliders, showPairs, snapshot]);

  const broadPhaseAvoided = useMemo(() => {
    if (!snapshot || snapshot.stats.possiblePairs === 0) return 0;
    return Math.max(
      0,
      100 * (1 - snapshot.stats.aabbTests / snapshot.stats.possiblePairs),
    );
  }, [snapshot]);

  const restart = () => {
    const previous = worldRef.current;
    const world = new ZombieArenaWorld(algorithm, SEED);
    worldRef.current = world;
    previous?.free();
    setSnapshot(parseSnapshot(world.snapshot_json()));
    setPaused(false);
    shootRef.current = false;
    keysRef.current.clear();
  };

  const changeAlgorithm = (next: string) => {
    setAlgorithm(next);
    const world = worldRef.current;
    if (!world) return;
    try {
      setSnapshot(parseSnapshot(world.set_algorithm(next)));
    } catch (reason) {
      setError(String(reason));
    }
  };

  const pointerWorld = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const worldHalf = snapshot?.worldHalf ?? 12;
    if (!canvas) return [0, 0] as Vec2;
    const rect = canvas.getBoundingClientRect();
    const canvasX = ((event.clientX - rect.left) / rect.width) * WIDTH;
    const canvasY = ((event.clientY - rect.top) / rect.height) * HEIGHT;
    return canvasToWorld([canvasX, canvasY], worldHalf);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const world = pointerWorld(event);
    mouseRef.current = world;
    setCursorWorld(world);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    const worldPosition = pointerWorld(event);
    mouseRef.current = worldPosition;
    setCursorWorld(worldPosition);
    if (buildMode) {
      const world = worldRef.current;
      if (!world) return;
      try {
        setSnapshot(parseSnapshot(world.build_json(worldPosition[0], worldPosition[1])));
      } catch (reason) {
        setError(String(reason));
      }
      return;
    }
    shootRef.current = true;
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    shootRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  if (error) {
    return (
      <div className="rounded-3xl border border-red-900/60 bg-red-950/25 p-6 text-sm text-red-300">
        Zombie Arena could not start: {error}
      </div>
    );
  }

  if (!ready || !snapshot) {
    return (
      <div className="grid min-h-[34rem] place-items-center rounded-3xl border border-zinc-800 bg-zinc-950 text-sm text-zinc-500">
        Loading the deterministic Rust/WASM arena…
      </div>
    );
  }

  return (
    <section className="overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-950">
      <div className="border-b border-zinc-800 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-600">
              Playable scenario · deterministic Rust/WASM
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-zinc-100">
              Survive while the collision pipeline stays visible.
            </h2>
            <p className="mt-3 text-sm leading-6 text-zinc-500">
              WASD moves. Aim with the pointer and hold click to fire. Switch to Build mode and click a grid cell to place a barricade. Zombies use direct pursuit with axis-separated obstacle sliding, then chew through anything you build.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setPaused((value) => !value)}
              className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-zinc-500"
            >
              {paused ? "Resume" : "Pause"}
            </button>
            <button
              type="button"
              onClick={restart}
              className="rounded-xl bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-white"
            >
              Restart
            </button>
          </div>
        </div>
      </div>

      <div className="grid xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 p-4 sm:p-6">
          <canvas
            ref={canvasRef}
            width={WIDTH}
            height={HEIGHT}
            tabIndex={0}
            aria-label="Top-down Zombie Arena collision scenario"
            onPointerMove={onPointerMove}
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onContextMenu={(event) => event.preventDefault()}
            className="aspect-[9/7] w-full touch-none rounded-2xl border border-zinc-800 bg-zinc-950 outline-none focus:border-zinc-500"
          />

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-500">
            <span>WASD · pointer aim · hold click = pistol</span>
            <span className="font-mono">
              fixed dt {(snapshot.fixedDt * 1000).toFixed(2)} ms · frame {snapshot.frame}
            </span>
          </div>
        </div>

        <aside className="border-t border-zinc-800 p-5 xl:border-l xl:border-t-0">
          <label
            className="block text-xs font-semibold uppercase tracking-[0.16em] text-zinc-600"
            htmlFor="arena-algorithm"
          >
            Broad phase
          </label>
          <select
            id="arena-algorithm"
            value={algorithm}
            onChange={(event) => changeAlgorithm(event.target.value)}
            className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-200 outline-none focus:border-zinc-500"
          >
            {ALGORITHMS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs leading-5 text-zinc-600">
            The game state should remain equivalent while the broad-phase implementation changes.
          </p>

          <button
            type="button"
            onClick={() => {
              shootRef.current = false;
              setBuildMode((value) => !value);
            }}
            className={`mt-5 w-full rounded-xl border px-4 py-3 text-sm font-semibold transition ${
              buildMode
                ? "border-amber-600/70 bg-amber-950/35 text-amber-200"
                : "border-zinc-700 text-zinc-300 hover:border-zinc-500"
            }`}
          >
            {buildMode ? "Build mode: ON" : "Build barricades"}
          </button>
          <p className="mt-2 text-xs leading-5 text-zinc-600">
            {buildMode
              ? "Click an empty snapped cell. Barricades have 100 HP and zombies can destroy them."
              : "Turn this on to place 1×1 collision blocks on the arena grid."}
          </p>

          <div className="mt-5 grid grid-cols-2 gap-2">
            <Metric
              label="health"
              value={`${Math.ceil(snapshot.player.health)} / ${snapshot.player.maxHealth}`}
            />
            <Metric label="zombies" value={String(snapshot.stats.zombies)} />
            <Metric label="kills" value={String(snapshot.stats.kills)} />
            <Metric label="barricades" value={String(snapshot.stats.barricades)} />
          </div>

          <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900/35 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-600">
              Collision workload
            </p>
            <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-4">
              <Stat
                label="possible pairs"
                value={snapshot.stats.possiblePairs.toLocaleString()}
              />
              <Stat
                label="AABB tests"
                value={snapshot.stats.aabbTests.toLocaleString()}
              />
              <Stat label="avoided" value={`${broadPhaseAvoided.toFixed(1)}%`} />
              <Stat label="overlaps" value={snapshot.stats.overlaps.toLocaleString()} />
              <Stat label="CCD tests" value={snapshot.stats.ccdTests.toLocaleString()} />
              <Stat label="CCD hits" value={snapshot.stats.ccdHits.toLocaleString()} />
            </div>
            {snapshot.stats.occupiedCells > 0 && (
              <p className="mt-3 border-t border-zinc-800 pt-3 text-xs text-zinc-500">
                Uniform Grid occupied cells:{" "}
                <span className="font-mono text-zinc-300">
                  {snapshot.stats.occupiedCells}
                </span>
              </p>
            )}
          </div>

          <div className="mt-5 space-y-2">
            <Toggle
              label="Collider boxes"
              checked={showColliders}
              onChange={setShowColliders}
            />
            <Toggle
              label="Exact overlap links"
              checked={showPairs}
              onChange={setShowPairs}
            />
            <Toggle
              label="Projectile CCD sweeps"
              checked={showCcd}
              onChange={setShowCcd}
            />
          </div>

          {snapshot.stats.destroyedBarricades > 0 && (
            <div className="mt-5 rounded-xl border border-amber-900/60 bg-amber-950/25 p-3 text-xs text-amber-200">
              {snapshot.stats.destroyedBarricades} barricade
              {snapshot.stats.destroyedBarricades === 1 ? "" : "s"} destroyed this tick.
            </div>
          )}

          {snapshot.gameOver && (
            <div className="mt-5 rounded-xl border border-red-900/60 bg-red-950/25 p-4">
              <p className="font-semibold text-red-200">The arena was overrun.</p>
              <p className="mt-1 text-xs leading-5 text-red-300/75">
                Restart replays the same deterministic spawn sequence from the same seed.
              </p>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/35 p-3">
      <div className="font-mono text-sm font-semibold text-zinc-200">{value}</div>
      <div className="mt-1 text-[10px] uppercase tracking-wide text-zinc-600">
        {label}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-sm font-semibold text-zinc-200">{value}</div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wide text-zinc-600">
        {label}
      </div>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4 rounded-xl border border-zinc-800 px-3 py-2 text-sm text-zinc-400">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-zinc-200"
      />
    </label>
  );
}

function parseSnapshot(value: string): ArenaSnapshot {
  return JSON.parse(value) as ArenaSnapshot;
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "SELECT" ||
    target.tagName === "TEXTAREA"
  );
}

function drawArena(
  canvas: HTMLCanvasElement,
  snapshot: ArenaSnapshot,
  options: {
    showColliders: boolean;
    showPairs: boolean;
    showCcd: boolean;
    buildMode: boolean;
    cursorWorld: Vec2;
  },
) {
  const context = canvas.getContext("2d");
  if (!context) return;
  const half = snapshot.worldHalf;
  context.clearRect(0, 0, WIDTH, HEIGHT);
  context.fillStyle = "#09090b";
  context.fillRect(0, 0, WIDTH, HEIGHT);

  context.save();
  context.beginPath();
  context.rect(ARENA_X, ARENA_Y, ARENA_SIDE, ARENA_SIDE);
  context.clip();

  const gridStep = (snapshot.buildGrid / (half * 2)) * ARENA_SIDE;
  context.strokeStyle = "rgba(82,82,91,0.18)";
  context.lineWidth = 1;
  for (let x = ARENA_X; x <= ARENA_X + ARENA_SIDE + 0.1; x += gridStep) {
    context.beginPath();
    context.moveTo(x, ARENA_Y);
    context.lineTo(x, ARENA_Y + ARENA_SIDE);
    context.stroke();
  }
  for (let y = ARENA_Y; y <= ARENA_Y + ARENA_SIDE + 0.1; y += gridStep) {
    context.beginPath();
    context.moveTo(ARENA_X, y);
    context.lineTo(ARENA_X + ARENA_SIDE, y);
    context.stroke();
  }

  if (options.showPairs) drawPairLinks(context, snapshot);

  for (const wall of snapshot.walls) {
    const [x, y, width, height] = worldRect(wall.position, wall.half, half);
    if (wall.destructible) {
      const healthRatio = wall.maxHealth > 0 ? wall.health / wall.maxHealth : 0;
      context.fillStyle =
        healthRatio > 0.5 ? "#92400e" : healthRatio > 0.2 ? "#9a3412" : "#7f1d1d";
      context.strokeStyle = "#f59e0b";
    } else {
      context.fillStyle = "#27272a";
      context.strokeStyle = "#52525b";
    }
    context.lineWidth = 1.5;
    context.fillRect(x, y, width, height);
    context.strokeRect(x, y, width, height);
    if (wall.destructible && wall.health < wall.maxHealth) {
      drawHealthBar(
        context,
        [x, y - 6],
        width,
        wall.health / wall.maxHealth,
        "#f59e0b",
      );
    }
  }

  for (const zombie of snapshot.zombies) {
    const center = worldToCanvas(zombie.position, half);
    const radius = (zombie.half[0] / half / 2) * ARENA_SIDE;
    context.beginPath();
    context.arc(center[0], center[1], radius, 0, Math.PI * 2);
    context.fillStyle = zombie.health > 1 ? "#3f6212" : "#713f12";
    context.fill();
    context.strokeStyle = "#84cc16";
    context.lineWidth = 1.5;
    context.stroke();
    context.beginPath();
    context.arc(
      center[0] - radius * 0.25,
      center[1] - radius * 0.15,
      Math.max(1.5, radius * 0.08),
      0,
      Math.PI * 2,
    );
    context.arc(
      center[0] + radius * 0.25,
      center[1] - radius * 0.15,
      Math.max(1.5, radius * 0.08),
      0,
      Math.PI * 2,
    );
    context.fillStyle = "#d9f99d";
    context.fill();
  }

  const playerCenter = worldToCanvas(snapshot.player.position, half);
  const playerRadius = (snapshot.player.half[0] / half / 2) * ARENA_SIDE;
  context.beginPath();
  context.arc(playerCenter[0], playerCenter[1], playerRadius, 0, Math.PI * 2);
  context.fillStyle = "#0e7490";
  context.fill();
  context.strokeStyle = "#67e8f9";
  context.lineWidth = 2;
  context.stroke();
  const aimEnd = worldToCanvas(
    [
      snapshot.player.position[0] + snapshot.player.aim[0] * 0.9,
      snapshot.player.position[1] + snapshot.player.aim[1] * 0.9,
    ],
    half,
  );
  context.beginPath();
  context.moveTo(playerCenter[0], playerCenter[1]);
  context.lineTo(aimEnd[0], aimEnd[1]);
  context.strokeStyle = "#a5f3fc";
  context.lineWidth = 3;
  context.stroke();

  for (const bullet of snapshot.bullets) {
    const center = worldToCanvas(bullet.position, half);
    context.beginPath();
    context.arc(
      center[0],
      center[1],
      Math.max(2.5, (bullet.radius / (half * 2)) * ARENA_SIDE),
      0,
      Math.PI * 2,
    );
    context.fillStyle = "#fde68a";
    context.fill();
  }

  if (options.showCcd) {
    for (const sweep of snapshot.debug.sweeps) {
      const from = worldToCanvas(sweep.from, half);
      const to = worldToCanvas(sweep.to, half);
      context.beginPath();
      context.moveTo(from[0], from[1]);
      context.lineTo(to[0], to[1]);
      context.strokeStyle = sweep.hit
        ? "rgba(251,191,36,0.9)"
        : "rgba(253,230,138,0.35)";
      context.lineWidth = sweep.hit ? 2 : 1;
      context.stroke();
      if (sweep.hit) {
        const hit = worldToCanvas(sweep.hit, half);
        context.beginPath();
        context.arc(hit[0], hit[1], 4, 0, Math.PI * 2);
        context.fillStyle = sweep.hitKind === "zombie" ? "#fb7185" : "#f59e0b";
        context.fill();
      }
    }
  }

  if (options.showColliders) {
    context.strokeStyle = "rgba(244,244,245,0.55)";
    context.lineWidth = 1;
    drawCollider(context, snapshot.player.position, snapshot.player.half, half);
    for (const zombie of snapshot.zombies) {
      drawCollider(context, zombie.position, zombie.half, half);
    }
    for (const wall of snapshot.walls) {
      drawCollider(context, wall.position, wall.half, half);
    }
  }

  if (options.buildMode) {
    const snapped: Vec2 = [
      Math.round(options.cursorWorld[0] / snapshot.buildGrid) * snapshot.buildGrid,
      Math.round(options.cursorWorld[1] / snapshot.buildGrid) * snapshot.buildGrid,
    ];
    const [x, y, width, height] = worldRect(snapped, [0.48, 0.48], half);
    context.save();
    context.setLineDash([7, 5]);
    context.fillStyle = "rgba(245,158,11,0.18)";
    context.strokeStyle = "rgba(251,191,36,0.9)";
    context.lineWidth = 2;
    context.fillRect(x, y, width, height);
    context.strokeRect(x, y, width, height);
    context.restore();
  }

  context.restore();
  context.strokeStyle = "#3f3f46";
  context.lineWidth = 2;
  context.strokeRect(ARENA_X, ARENA_Y, ARENA_SIDE, ARENA_SIDE);

  const healthRatio = snapshot.player.health / snapshot.player.maxHealth;
  drawHealthBar(
    context,
    [ARENA_X, ARENA_Y + ARENA_SIDE + 18],
    ARENA_SIDE,
    healthRatio,
    healthRatio > 0.35 ? "#22d3ee" : "#fb7185",
  );
  context.fillStyle = "#a1a1aa";
  context.font = "12px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.textAlign = "left";
  context.fillText(
    `PLAYER ${Math.ceil(snapshot.player.health)} HP`,
    ARENA_X,
    ARENA_Y + ARENA_SIDE + 43,
  );
  context.textAlign = "right";
  context.fillText(
    `${snapshot.stats.kills} KILLS · ${snapshot.stats.zombies} ACTIVE`,
    ARENA_X + ARENA_SIDE,
    ARENA_Y + ARENA_SIDE + 43,
  );

  if (snapshot.gameOver) {
    context.fillStyle = "rgba(9,9,11,0.72)";
    context.fillRect(ARENA_X, ARENA_Y, ARENA_SIDE, ARENA_SIDE);
    context.fillStyle = "#fecaca";
    context.font = "600 34px Arial, sans-serif";
    context.textAlign = "center";
    context.fillText("ARENA OVERRUN", WIDTH / 2, HEIGHT / 2 - 10);
    context.fillStyle = "#a1a1aa";
    context.font = "15px Arial, sans-serif";
    context.fillText(
      "Restart to replay the same deterministic wave.",
      WIDTH / 2,
      HEIGHT / 2 + 24,
    );
  }
}

function drawPairLinks(
  context: CanvasRenderingContext2D,
  snapshot: ArenaSnapshot,
) {
  const positions = new Map<number, Vec2>();
  positions.set(snapshot.player.id, snapshot.player.position);
  for (const zombie of snapshot.zombies) positions.set(zombie.id, zombie.position);
  for (const wall of snapshot.walls) positions.set(wall.id, wall.position);

  context.strokeStyle = "rgba(244,63,94,0.42)";
  context.lineWidth = 1.25;
  for (const [leftId, rightId] of snapshot.debug.overlapPairs) {
    const left = positions.get(leftId);
    const right = positions.get(rightId);
    if (!left || !right) continue;
    const a = worldToCanvas(left, snapshot.worldHalf);
    const b = worldToCanvas(right, snapshot.worldHalf);
    context.beginPath();
    context.moveTo(a[0], a[1]);
    context.lineTo(b[0], b[1]);
    context.stroke();
  }
}

function drawCollider(
  context: CanvasRenderingContext2D,
  position: Vec2,
  half: Vec2,
  worldHalf: number,
) {
  const [x, y, width, height] = worldRect(position, half, worldHalf);
  context.strokeRect(x, y, width, height);
}

function drawHealthBar(
  context: CanvasRenderingContext2D,
  origin: Vec2,
  width: number,
  ratio: number,
  fill: string,
) {
  const safeRatio = Math.max(0, Math.min(1, ratio));
  context.fillStyle = "#18181b";
  context.fillRect(origin[0], origin[1], width, 4);
  context.fillStyle = fill;
  context.fillRect(origin[0], origin[1], width * safeRatio, 4);
}

function worldRect(
  position: Vec2,
  halfExtent: Vec2,
  worldHalf: number,
): [number, number, number, number] {
  const min = worldToCanvas(
    [position[0] - halfExtent[0], position[1] + halfExtent[1]],
    worldHalf,
  );
  const max = worldToCanvas(
    [position[0] + halfExtent[0], position[1] - halfExtent[1]],
    worldHalf,
  );
  return [min[0], min[1], max[0] - min[0], max[1] - min[1]];
}

function worldToCanvas(position: Vec2, worldHalf: number): Vec2 {
  return [
    ARENA_X + ((position[0] + worldHalf) / (worldHalf * 2)) * ARENA_SIDE,
    ARENA_Y + ((worldHalf - position[1]) / (worldHalf * 2)) * ARENA_SIDE,
  ];
}

function canvasToWorld(position: Vec2, worldHalf: number): Vec2 {
  const x =
    ((position[0] - ARENA_X) / ARENA_SIDE) * (worldHalf * 2) - worldHalf;
  const y =
    worldHalf - ((position[1] - ARENA_Y) / ARENA_SIDE) * (worldHalf * 2);
  return [
    Math.max(-worldHalf, Math.min(worldHalf, x)),
    Math.max(-worldHalf, Math.min(worldHalf, y)),
  ];
}
