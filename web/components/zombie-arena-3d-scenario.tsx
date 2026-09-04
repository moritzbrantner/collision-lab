"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import initZombie3dWasm, {
  ZombieArena3dWorld,
} from "../lib/zombie-arena-3d-wasm-pkg/zombie_arena_3d_wasm";

type Vec3 = [number, number, number];

type ActorSnapshot = {
  id: number;
  position: Vec3;
  half: Vec3;
  health: number;
  maxHealth: number;
};

type PlayerSnapshot = ActorSnapshot & {
  velocity: Vec3;
  aim: Vec3;
  grounded: boolean;
};

type WallSnapshot = {
  id: number;
  position: Vec3;
  half: Vec3;
  low: boolean;
};

type BulletSnapshot = {
  id: number;
  position: Vec3;
  previousPosition: Vec3;
  radius: number;
};

type PathSnapshot = {
  zombieId: number;
  waypoints: Vec3[];
};

type Arena3dSnapshot = {
  frame: number;
  algorithm: string;
  worldHalf: number;
  fixedDt: number;
  navCell: number;
  player: PlayerSnapshot;
  zombies: ActorSnapshot[];
  walls: WallSnapshot[];
  bullets: BulletSnapshot[];
  debug: {
    overlapPairs: [number, number][];
    sweeps: {
      from: Vec3;
      to: Vec3;
      hit: Vec3 | null;
      hitKind: "wall" | "zombie" | null;
    }[];
    navigation: {
      blocked: [number, number][];
      paths: PathSnapshot[];
    };
  };
  stats: {
    zombies: number;
    walls: number;
    bullets: number;
    kills: number;
    shots: number;
    jumps: number;
    possiblePairs: number;
    aabbTests: number;
    occupiedCells: number;
    overlaps: number;
    ccdTests: number;
    ccdHits: number;
    pathReplans: number;
    pathFound: number;
    pathExpanded: number;
    pathReplansTotal: number;
    pathExpandedTotal: number;
  };
  gameOver: boolean;
};

type RenderResources = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  player: THREE.Group;
  zombies: Map<number, THREE.Group>;
  walls: Map<number, THREE.Mesh>;
  bullets: Map<number, THREE.Mesh>;
  pathLines: Map<number, THREE.Line>;
  pathSignatures: Map<number, string>;
  pathGroup: THREE.Group;
  navGroup: THREE.Group;
  blockedMesh: THREE.InstancedMesh | null;
  resizeObserver: ResizeObserver;
  animationFrame: number;
};

const SEED = 0x5a173d;
const DEFAULT_ALGORITHM = "uniform-grid";
const ALGORITHMS = [
  ["naive", "Naive all-pairs"],
  ["uniform-grid", "Uniform Grid"],
  ["sweep-and-prune", "Sweep & Prune"],
  ["static-bvh", "Static BVH"],
  ["dynamic-aabb-tree", "Dynamic AABB Tree"],
  ["octree", "Octree"],
] as const;

const PLAYER_BODY_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0x0e7490,
  roughness: 0.7,
});
const PLAYER_ACCENT_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0xa5f3fc,
  roughness: 0.55,
});
const ZOMBIE_BODY_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0x4d7c0f,
  roughness: 0.92,
});
const ZOMBIE_HEAD_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0x84cc16,
  roughness: 0.88,
});
const WALL_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0x3f3f46,
  roughness: 0.96,
});
const LOW_WALL_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0x92400e,
  roughness: 0.9,
});
const BULLET_MATERIAL = new THREE.MeshBasicMaterial({ color: 0xfde68a });
const PATH_MATERIAL = new THREE.LineBasicMaterial({
  color: 0x22d3ee,
  transparent: true,
  opacity: 0.72,
});
const BLOCKED_MATERIAL = new THREE.MeshBasicMaterial({
  color: 0xef4444,
  transparent: true,
  opacity: 0.12,
  depthWrite: false,
});

export function ZombieArena3dScenario() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<ZombieArena3dWorld | null>(null);
  const renderRef = useRef<RenderResources | null>(null);
  const snapshotRef = useRef<Arena3dSnapshot | null>(null);
  const keysRef = useRef(new Set<string>());
  const shootRef = useRef(false);
  const jumpRequestedRef = useRef(false);
  const cameraYawRef = useRef(0);
  const cameraPitchRef = useRef(-0.12);
  const aimRef = useRef<Vec3>([0, -0.04, -1]);
  const [snapshot, setSnapshot] = useState<Arena3dSnapshot | null>(null);
  const [algorithm, setAlgorithm] = useState(DEFAULT_ALGORITHM);
  const [paused, setPaused] = useState(false);
  const [showPaths, setShowPaths] = useState(true);
  const [showNavGrid, setShowNavGrid] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void initZombie3dWasm()
      .then(() => {
        if (cancelled) return;
        const world = new ZombieArena3dWorld(DEFAULT_ALGORITHM, SEED);
        worldRef.current = world;
        const next = parseSnapshot(world.snapshot_json());
        snapshotRef.current = next;
        setSnapshot(next);
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
      if (["w", "a", "s", "d"].includes(key)) keysRef.current.add(key);
      if (event.code === "Space" && !event.repeat) {
        jumpRequestedRef.current = true;
        event.preventDefault();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      keysRef.current.delete(event.key.toLowerCase());
    };
    const onBlur = () => {
      keysRef.current.clear();
      shootRef.current = false;
      jumpRequestedRef.current = false;
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
        const forwardInput = Number(keys.has("w")) - Number(keys.has("s"));
        const rightInput = Number(keys.has("d")) - Number(keys.has("a"));
        const yaw = cameraYawRef.current;
        const forwardX = Math.sin(yaw);
        const forwardZ = -Math.cos(yaw);
        const rightX = -forwardZ;
        const rightZ = forwardX;
        const moveX = forwardX * forwardInput + rightX * rightInput;
        const moveZ = forwardZ * forwardInput + rightZ * rightInput;
        const aim = aimRef.current;
        const jump = jumpRequestedRef.current;
        jumpRequestedRef.current = false;
        const next = parseSnapshot(
          world.step_json(
            moveX,
            moveZ,
            aim[0],
            aim[1],
            aim[2],
            jump,
            shootRef.current,
          ),
        );
        snapshotRef.current = next;
        setSnapshot(next);
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
    const mount = mountRef.current;
    if (!mount || !ready) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x09090b);
    scene.fog = new THREE.Fog(0x09090b, 18, 43);

    const width = Math.max(mount.clientWidth, 320);
    const height = Math.max(mount.clientHeight, 520);
    const camera = new THREE.PerspectiveCamera(58, width / height, 0.08, 100);
    camera.position.set(0.8, 3.5, 5.5);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.replaceChildren(renderer.domElement);

    const hemisphere = new THREE.HemisphereLight(0xdbeafe, 0x18181b, 1.7);
    scene.add(hemisphere);
    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.position.set(-8, 16, 9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -18;
    sun.shadow.camera.right = 18;
    sun.shadow.camera.top = 18;
    sun.shadow.camera.bottom = -18;
    scene.add(sun);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(28, 28),
      new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const navGroup = new THREE.Group();
    const grid = new THREE.GridHelper(26, 26, 0x3f3f46, 0x27272a);
    grid.position.y = 0.018;
    navGroup.add(grid);
    navGroup.visible = false;
    scene.add(navGroup);

    const pathGroup = new THREE.Group();
    scene.add(pathGroup);

    const player = makePlayer();
    scene.add(player);

    const resources: RenderResources = {
      scene,
      camera,
      renderer,
      player,
      zombies: new Map(),
      walls: new Map(),
      bullets: new Map(),
      pathLines: new Map(),
      pathSignatures: new Map(),
      pathGroup,
      navGroup,
      blockedMesh: null,
      resizeObserver: new ResizeObserver(() => undefined),
      animationFrame: 0,
    };

    const resizeObserver = new ResizeObserver(() => {
      const nextWidth = Math.max(mount.clientWidth, 320);
      const nextHeight = Math.max(mount.clientHeight, 520);
      renderer.setSize(nextWidth, nextHeight);
      camera.aspect = nextWidth / nextHeight;
      camera.updateProjectionMatrix();
    });
    resizeObserver.observe(mount);
    resources.resizeObserver = resizeObserver;
    renderRef.current = resources;

    let animationFrame = 0;
    const render = () => {
      const current = snapshotRef.current;
      if (current) {
        updateCameraAndAim(
          resources.camera,
          current.player,
          cameraYawRef,
          cameraPitchRef,
          aimRef,
        );
      }
      renderer.render(scene, camera);
      animationFrame = requestAnimationFrame(render);
      resources.animationFrame = animationFrame;
    };
    render();

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      disposeResources(resources);
      renderer.dispose();
      mount.replaceChildren();
      renderRef.current = null;
    };
  }, [ready]);

  useEffect(() => {
    const resources = renderRef.current;
    if (!resources || !snapshot) return;
    syncSnapshot(resources, snapshot);
  }, [snapshot]);

  useEffect(() => {
    const resources = renderRef.current;
    if (!resources) return;
    resources.pathGroup.visible = showPaths;
  }, [showPaths]);

  useEffect(() => {
    const resources = renderRef.current;
    if (!resources) return;
    resources.navGroup.visible = showNavGrid;
  }, [showNavGrid]);

  const broadPhaseAvoided = useMemo(() => {
    if (!snapshot || snapshot.stats.possiblePairs === 0) return 0;
    return Math.max(
      0,
      100 * (1 - snapshot.stats.aabbTests / snapshot.stats.possiblePairs),
    );
  }, [snapshot]);

  const restart = () => {
    const previous = worldRef.current;
    const world = new ZombieArena3dWorld(algorithm, SEED);
    worldRef.current = world;
    previous?.free();
    const next = parseSnapshot(world.snapshot_json());
    snapshotRef.current = next;
    setSnapshot(next);
    setPaused(false);
    shootRef.current = false;
    jumpRequestedRef.current = false;
    keysRef.current.clear();
    cameraYawRef.current = 0;
    cameraPitchRef.current = -0.12;
  };

  const changeAlgorithm = (nextAlgorithm: string) => {
    setAlgorithm(nextAlgorithm);
    const world = worldRef.current;
    if (!world) return;
    try {
      const next = parseSnapshot(world.set_algorithm(nextAlgorithm));
      snapshotRef.current = next;
      setSnapshot(next);
    } catch (reason) {
      setError(String(reason));
    }
  };

  if (error) {
    return (
      <div className="rounded-3xl border border-red-900/60 bg-red-950/25 p-6 text-sm text-red-300">
        Zombie Arena 3D could not start: {error}
      </div>
    );
  }

  if (!ready || !snapshot) {
    return (
      <div className="grid min-h-[36rem] place-items-center rounded-3xl border border-zinc-800 bg-zinc-950 text-sm text-zinc-500">
        Loading the deterministic Rust/WASM 3D arena…
      </div>
    );
  }

  return (
    <section className="overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-950">
      <div className="border-b border-zinc-800 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-600">
              Playable scenario · deterministic Rust/WASM · Three.js
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-zinc-100">
              Third-person shooting with real vertical physics and A* pursuit.
            </h2>
            <p className="mt-3 text-sm leading-6 text-zinc-500">
              Click the arena to focus. Move the pointer to rotate the over-the-shoulder camera, use WASD to move, Space to jump, and hold click to fire. Zombies replan deterministic A* paths around the 3D obstacle field while collision and projectile CCD stay in Rust.
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
          <div
            ref={mountRef}
            tabIndex={0}
            role="application"
            aria-label="Third-person 3D Zombie Arena"
            onPointerMove={(event) => {
              if (document.activeElement !== event.currentTarget) return;
              cameraYawRef.current -= event.movementX * 0.0032;
              cameraPitchRef.current = THREE.MathUtils.clamp(
                cameraPitchRef.current - event.movementY * 0.0026,
                -0.48,
                0.3,
              );
            }}
            onPointerDown={(event) => {
              event.currentTarget.focus();
              event.currentTarget.setPointerCapture(event.pointerId);
              shootRef.current = true;
            }}
            onPointerUp={(event) => {
              shootRef.current = false;
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
            onPointerCancel={() => {
              shootRef.current = false;
            }}
            onContextMenu={(event) => event.preventDefault()}
            className="relative min-h-[34rem] cursor-crosshair overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 outline-none focus:border-zinc-500"
          >
            <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-200/80">
              <span className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-100" />
            </div>
            {snapshot.gameOver && (
              <div className="pointer-events-none absolute inset-x-6 top-6 z-10 rounded-2xl border border-red-900/70 bg-red-950/85 p-4 text-center text-sm font-semibold text-red-200 backdrop-blur">
                Run over — restart to replay the same deterministic seed.
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-500">
            <span>WASD · Space jump · pointer camera · hold click fire</span>
            <span className="font-mono">
              fixed dt {(snapshot.fixedDt * 1000).toFixed(2)} ms · frame {snapshot.frame}
            </span>
          </div>
        </div>

        <aside className="border-t border-zinc-800 p-5 xl:border-l xl:border-t-0">
          <label
            className="block text-xs font-semibold uppercase tracking-[0.16em] text-zinc-600"
            htmlFor="arena-3d-algorithm"
          >
            Broad phase
          </label>
          <select
            id="arena-3d-algorithm"
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
            A* owns navigation; this selector still swaps the collision broad phase without changing gameplay state.
          </p>

          <div className="mt-5 grid grid-cols-2 gap-2">
            <Metric
              label="health"
              value={`${Math.ceil(snapshot.player.health)} / ${snapshot.player.maxHealth}`}
            />
            <Metric label="zombies" value={snapshot.stats.zombies} />
            <Metric label="kills" value={snapshot.stats.kills} />
            <Metric label="height" value={snapshot.player.position[1].toFixed(2)} />
          </div>

          <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900/35 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-600">
              A* navigation
            </p>
            <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-4">
              <Stat label="replans/frame" value={snapshot.stats.pathReplans} />
              <Stat label="paths found" value={snapshot.stats.pathFound} />
              <Stat label="cells expanded" value={snapshot.stats.pathExpanded} />
              <Stat label="total replans" value={snapshot.stats.pathReplansTotal} />
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900/35 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-600">
              3D collision workload
            </p>
            <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-4">
              <Stat label="possible pairs" value={snapshot.stats.possiblePairs} />
              <Stat label="AABB tests" value={snapshot.stats.aabbTests} />
              <Stat label="avoided" value={`${broadPhaseAvoided.toFixed(1)}%`} />
              <Stat label="overlaps" value={snapshot.stats.overlaps} />
              <Stat label="CCD tests" value={snapshot.stats.ccdTests} />
              <Stat label="CCD hits" value={snapshot.stats.ccdHits} />
            </div>
          </div>

          <label className="mt-5 flex cursor-pointer items-center gap-3 rounded-xl border border-zinc-800 px-3 py-2.5 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={showPaths}
              onChange={(event) => setShowPaths(event.target.checked)}
              className="h-4 w-4 accent-zinc-100"
            />
            Show A* paths
          </label>
          <label className="mt-2 flex cursor-pointer items-center gap-3 rounded-xl border border-zinc-800 px-3 py-2.5 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={showNavGrid}
              onChange={(event) => setShowNavGrid(event.target.checked)}
              className="h-4 w-4 accent-zinc-100"
            />
            Show navigation grid
          </label>

          <p className="mt-5 text-xs leading-5 text-zinc-600">
            The player can jump onto low crates; zombies deliberately remain ground agents and route around every blocked navigation cell. That keeps 3D physics and ground navigation as separate concerns.
          </p>
        </aside>
      </div>
    </section>
  );
}

function syncSnapshot(resources: RenderResources, snapshot: Arena3dSnapshot) {
  updateActor(resources.player, snapshot.player.position, snapshot.player.aim);
  syncWalls(resources, snapshot.walls);
  syncZombies(resources, snapshot.zombies);
  syncBullets(resources, snapshot.bullets);
  syncNavigation(resources, snapshot);
}

function syncWalls(resources: RenderResources, walls: WallSnapshot[]) {
  const live = new Set(walls.map((wall) => wall.id));
  for (const [id, mesh] of resources.walls) {
    if (live.has(id)) continue;
    resources.scene.remove(mesh);
    mesh.geometry.dispose();
    resources.walls.delete(id);
  }

  for (const wall of walls) {
    let mesh = resources.walls.get(wall.id);
    if (!mesh) {
      mesh = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        wall.low ? LOW_WALL_MATERIAL : WALL_MATERIAL,
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      resources.scene.add(mesh);
      resources.walls.set(wall.id, mesh);
    }
    mesh.position.set(...wall.position);
    mesh.scale.set(wall.half[0] * 2, wall.half[1] * 2, wall.half[2] * 2);
  }
}

function syncZombies(resources: RenderResources, zombies: ActorSnapshot[]) {
  const live = new Set(zombies.map((zombie) => zombie.id));
  for (const [id, group] of resources.zombies) {
    if (live.has(id)) continue;
    resources.scene.remove(group);
    disposeObject(group);
    resources.zombies.delete(id);
  }

  for (const zombie of zombies) {
    let group = resources.zombies.get(zombie.id);
    if (!group) {
      group = makeZombie();
      resources.scene.add(group);
      resources.zombies.set(zombie.id, group);
    }
    group.position.set(...zombie.position);
    const path = resources.pathLines.get(zombie.id);
    const next = path?.geometry.getAttribute("position");
    if (next && next.count > 0) {
      const nextX = next.getX(0);
      const nextZ = next.getZ(0);
      const dx = nextX - zombie.position[0];
      const dz = nextZ - zombie.position[2];
      if (Math.abs(dx) + Math.abs(dz) > 0.001) {
        group.rotation.y = Math.atan2(dx, dz);
      }
    }
  }
}

function syncBullets(resources: RenderResources, bullets: BulletSnapshot[]) {
  const live = new Set(bullets.map((bullet) => bullet.id));
  for (const [id, mesh] of resources.bullets) {
    if (live.has(id)) continue;
    resources.scene.remove(mesh);
    mesh.geometry.dispose();
    resources.bullets.delete(id);
  }

  for (const bullet of bullets) {
    let mesh = resources.bullets.get(bullet.id);
    if (!mesh) {
      mesh = new THREE.Mesh(
        new THREE.SphereGeometry(Math.max(0.06, bullet.radius), 8, 6),
        BULLET_MATERIAL,
      );
      resources.scene.add(mesh);
      resources.bullets.set(bullet.id, mesh);
    }
    mesh.position.set(...bullet.position);
  }
}

function syncNavigation(resources: RenderResources, snapshot: Arena3dSnapshot) {
  if (!resources.blockedMesh) {
    const blocked = snapshot.debug.navigation.blocked;
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(snapshot.navCell * 0.88, 0.025, snapshot.navCell * 0.88),
      BLOCKED_MATERIAL,
      blocked.length,
    );
    const matrix = new THREE.Matrix4();
    blocked.forEach(([x, z], index) => {
      matrix.makeTranslation(x * snapshot.navCell, 0.03, z * snapshot.navCell);
      mesh.setMatrixAt(index, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    resources.navGroup.add(mesh);
    resources.blockedMesh = mesh;
  }

  const live = new Set(snapshot.debug.navigation.paths.map((path) => path.zombieId));
  for (const [id, line] of resources.pathLines) {
    if (live.has(id)) continue;
    resources.pathGroup.remove(line);
    line.geometry.dispose();
    resources.pathLines.delete(id);
    resources.pathSignatures.delete(id);
  }

  for (const path of snapshot.debug.navigation.paths) {
    const signature = path.waypoints
      .map(([x, , z]) => `${x.toFixed(2)},${z.toFixed(2)}`)
      .join(";");
    if (resources.pathSignatures.get(path.zombieId) === signature) continue;

    const previous = resources.pathLines.get(path.zombieId);
    if (previous) {
      resources.pathGroup.remove(previous);
      previous.geometry.dispose();
    }
    const points = path.waypoints.map(
      ([x, y, z]) => new THREE.Vector3(x, Math.max(0.08, y - 0.75), z),
    );
    if (points.length >= 2) {
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        PATH_MATERIAL,
      );
      resources.pathGroup.add(line);
      resources.pathLines.set(path.zombieId, line);
    } else {
      resources.pathLines.delete(path.zombieId);
    }
    resources.pathSignatures.set(path.zombieId, signature);
  }
}

function updateActor(group: THREE.Group, position: Vec3, aim: Vec3) {
  group.position.set(...position);
  const horizontal = Math.hypot(aim[0], aim[2]);
  if (horizontal > 0.0001) {
    group.rotation.y = Math.atan2(-aim[0], -aim[2]);
  }
  const gun = group.getObjectByName("gun");
  if (gun) gun.rotation.x = -Math.asin(THREE.MathUtils.clamp(aim[1], -1, 1));
}

function updateCameraAndAim(
  camera: THREE.PerspectiveCamera,
  player: PlayerSnapshot,
  yawRef: { current: number },
  pitchRef: { current: number },
  aim: { current: Vec3 },
) {
  const yaw = yawRef.current;
  const pitch = pitchRef.current;
  const horizontalForward = new THREE.Vector3(Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new THREE.Vector3(-horizontalForward.z, 0, horizontalForward.x);
  const playerPosition = new THREE.Vector3(...player.position);
  const desired = playerPosition
    .clone()
    .addScaledVector(horizontalForward, -5.2)
    .addScaledVector(right, 0.85)
    .add(new THREE.Vector3(0, 2.55, 0));
  camera.position.lerp(desired, 0.18);

  const rawAim = new THREE.Vector3(
    Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    -Math.cos(yaw) * Math.cos(pitch),
  ).normalize();
  const convergence = camera.position.clone().addScaledVector(rawAim, 28);
  const muzzle = playerPosition.clone().add(new THREE.Vector3(0, 0.28, 0));
  const playerAim = convergence.sub(muzzle).normalize();
  aim.current = [playerAim.x, playerAim.y, playerAim.z];
  camera.lookAt(camera.position.clone().add(rawAim));
}

function makePlayer() {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.34, 1.05, 6, 10),
    PLAYER_BODY_MATERIAL,
  );
  body.castShadow = true;
  group.add(body);

  const gunPivot = new THREE.Group();
  gunPivot.name = "gun";
  gunPivot.position.set(0.28, 0.2, 0.08);
  const gun = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.12, 0.85),
    PLAYER_ACCENT_MATERIAL,
  );
  gun.position.z = -0.42;
  gun.castShadow = true;
  gunPivot.add(gun);
  group.add(gunPivot);
  return group;
}

function makeZombie() {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.36, 0.78, 5, 8),
    ZOMBIE_BODY_MATERIAL,
  );
  body.position.y = -0.08;
  body.castShadow = true;
  group.add(body);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.31, 12, 8),
    ZOMBIE_HEAD_MATERIAL,
  );
  head.position.y = 0.68;
  head.castShadow = true;
  group.add(head);
  return group;
}

function disposeResources(resources: RenderResources) {
  resources.pathLines.forEach((line) => line.geometry.dispose());
  resources.bullets.forEach((mesh) => mesh.geometry.dispose());
  resources.walls.forEach((mesh) => mesh.geometry.dispose());
  resources.zombies.forEach(disposeObject);
  disposeObject(resources.player);
  resources.blockedMesh?.geometry.dispose();
  resources.scene.traverse((object) => {
    if (object instanceof THREE.Mesh && object.geometry) object.geometry.dispose();
  });
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) child.geometry.dispose();
  });
}

function parseSnapshot(value: string): Arena3dSnapshot {
  return JSON.parse(value) as Arena3dSnapshot;
}

function isEditableTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/35 px-3 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-600">
        {label}
      </div>
      <div className="mt-1 font-mono text-sm font-semibold text-zinc-200">{value}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-zinc-600">{label}</div>
      <div className="mt-1 font-mono text-xs font-semibold text-zinc-300">{value}</div>
    </div>
  );
}
