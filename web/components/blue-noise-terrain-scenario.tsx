"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import initWasm, {
  BlueNoiseTerrainWorld,
} from "../lib/wasm-pkg/collision_wasm";

type Vec2 = [number, number];
type Vec3 = [number, number, number];

type TerrainData = {
  seed: number;
  gridSize: number;
  worldHalf: number;
  heightScale: number;
  sites: {
    position: Vec2;
    surfaceHeight: number;
    amplitude: number;
  }[];
  vertices: Vec3[];
  indices: number[];
  stats: {
    vertices: number;
    triangles: number;
    blueNoiseSites: number;
    candidatesPerSite: number;
    candidateEvaluations: number;
    heightContributions: number;
    minimumSiteDistance: number;
  };
};

type TerrainSnapshot = {
  frame: number;
  position: Vec3;
  velocityY: number;
  grounded: boolean;
  contact: {
    triangle: number;
    height: number;
    normal: Vec3;
    vertices: [Vec3, Vec3, Vec3];
  };
  triangleQueries: number;
  totalTriangleQueries: number;
};

type RenderResources = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  actor: THREE.Group;
  contact: THREE.Mesh;
  normal: THREE.ArrowHelper;
  wireframe: THREE.LineSegments;
  sites: THREE.InstancedMesh;
  contactTriangle: number | null;
  target: THREE.Vector3;
  contactOrigin: THREE.Vector3;
  normalDirection: THREE.Vector3;
};

const DEFAULT_SEED = 73;
const MAX_SEED = 4_294_967_295;
const FIXED_STEP_MS = 1000 / 60;

export function BlueNoiseTerrainScenario() {
  const mountRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<BlueNoiseTerrainWorld | null>(null);
  const snapshotRef = useRef<TerrainSnapshot | null>(null);
  const resourcesRef = useRef<RenderResources | null>(null);
  const keysRef = useRef(new Set<string>());
  const jumpRef = useRef(false);
  const [terrain, setTerrain] = useState<TerrainData | null>(null);
  const [snapshot, setSnapshot] = useState<TerrainSnapshot | null>(null);
  const [seedDraft, setSeedDraft] = useState(String(DEFAULT_SEED));
  const [wireframeVisible, setWireframeVisible] = useState(true);
  const [sitesVisible, setSitesVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wasmReady, setWasmReady] = useState(false);

  const loadTerrain = useCallback((seed: number) => {
    const previous = worldRef.current;
    const world = new BlueNoiseTerrainWorld(seed);
    const nextTerrain = JSON.parse(world.terrain_json()) as TerrainData;
    const nextSnapshot = JSON.parse(world.snapshot_json()) as TerrainSnapshot;
    worldRef.current = world;
    previous?.free();
    snapshotRef.current = nextSnapshot;
    setTerrain(nextTerrain);
    setSnapshot(nextSnapshot);
    setSeedDraft(String(seed));
    setError(null);
    const url = new URL(window.location.href);
    url.searchParams.set("seed", String(seed));
    window.history.replaceState(null, "", url);
  }, []);

  useEffect(() => {
    let active = true;
    void initWasm()
      .then(() => {
        if (!active) return;
        setWasmReady(true);
        const seedParameter = new URL(window.location.href).searchParams.get("seed");
        const requestedSeed = seedParameter?.trim() ? Number(seedParameter) : Number.NaN;
        const seed = sanitizeSeed(requestedSeed) ?? DEFAULT_SEED;
        loadTerrain(seed);
      })
      .catch((reason: unknown) => {
        if (active) setError(String(reason));
      });
    return () => {
      active = false;
      worldRef.current?.free();
      worldRef.current = null;
    };
  }, [loadTerrain]);

  useEffect(() => {
    const isInteractive = (target: EventTarget | null) =>
      target instanceof Element &&
      target.closest("input, textarea, select, button, a, [contenteditable='true']") !== null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (isInteractive(event.target)) return;
      const key = event.key.toLowerCase();
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) {
        event.preventDefault();
        keysRef.current.add(key);
      }
      if (event.code === "Space") {
        event.preventDefault();
        jumpRef.current = true;
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      keysRef.current.delete(event.key.toLowerCase());
    };
    const clearKeys = () => keysRef.current.clear();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", clearKeys);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", clearKeys);
    };
  }, []);

  useEffect(() => {
    if (!wasmReady || !terrain) return;
    let animationFrame = 0;
    let previousTime = performance.now();
    let accumulator = 0;
    let publishedFrame = snapshotRef.current?.frame ?? 0;
    const tick = (time: number) => {
      accumulator += Math.min(time - previousTime, 100);
      previousTime = time;
      let steps = 0;
      while (accumulator >= FIXED_STEP_MS && steps < 5) {
        const world = worldRef.current;
        if (world) {
          const keys = keysRef.current;
          const moveX =
            Number(keys.has("d") || keys.has("arrowright")) -
            Number(keys.has("a") || keys.has("arrowleft"));
          const moveZ =
            Number(keys.has("s") || keys.has("arrowdown")) -
            Number(keys.has("w") || keys.has("arrowup"));
          const next = JSON.parse(
            world.step_json(moveX, moveZ, jumpRef.current),
          ) as TerrainSnapshot;
          jumpRef.current = false;
          snapshotRef.current = next;
          if (next.frame - publishedFrame >= 6) {
            publishedFrame = next.frame;
            setSnapshot(next);
          }
        }
        accumulator -= FIXED_STEP_MS;
        steps += 1;
      }
      if (steps === 5) accumulator = 0;
      animationFrame = requestAnimationFrame(tick);
    };
    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, [terrain, wasmReady]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !terrain) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x080b0e);
    scene.fog = new THREE.Fog(0x080b0e, 25, 58);
    const width = Math.max(mount.clientWidth, 320);
    const height = Math.max(mount.clientHeight, 520);
    const camera = new THREE.PerspectiveCamera(52, width / height, 0.08, 120);
    camera.position.set(11, 10, 14);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.replaceChildren(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xdbeafe, 0x172319, 1.8));
    const sun = new THREE.DirectionalLight(0xfff4d6, 2.7);
    sun.position.set(-10, 19, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -18;
    sun.shadow.camera.right = 18;
    sun.shadow.camera.top = 18;
    sun.shadow.camera.bottom = -18;
    scene.add(sun);

    const geometry = createTerrainGeometry(terrain);
    const terrainMesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        flatShading: true,
        roughness: 0.88,
      }),
    );
    terrainMesh.receiveShadow = true;
    scene.add(terrainMesh);

    const wireframe = new THREE.LineSegments(
      new THREE.WireframeGeometry(geometry),
      new THREE.LineBasicMaterial({ color: 0x334155, transparent: true, opacity: 0.3 }),
    );
    wireframe.visible = wireframeVisible;
    scene.add(wireframe);

    const sites = createSiteMarkers(terrain);
    sites.visible = sitesVisible;
    scene.add(sites);

    const actor = createWalker();
    scene.add(actor);
    const contact = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        color: 0x22d3ee,
        transparent: true,
        opacity: 0.48,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    scene.add(contact);
    const normal = new THREE.ArrowHelper(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(),
      1.25,
      0xf8fafc,
      0.32,
      0.2,
    );
    scene.add(normal);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI * 0.47;
    controls.minDistance = 5;
    controls.maxDistance = 30;
    const resources: RenderResources = {
      scene,
      camera,
      renderer,
      controls,
      actor,
      contact,
      normal,
      wireframe,
      sites,
      contactTriangle: null,
      target: new THREE.Vector3(),
      contactOrigin: new THREE.Vector3(),
      normalDirection: new THREE.Vector3(),
    };
    resourcesRef.current = resources;

    const resizeObserver = new ResizeObserver(() => {
      const nextWidth = Math.max(mount.clientWidth, 320);
      const nextHeight = Math.max(mount.clientHeight, 520);
      renderer.setSize(nextWidth, nextHeight);
      camera.aspect = nextWidth / nextHeight;
      camera.updateProjectionMatrix();
    });
    resizeObserver.observe(mount);

    let animationFrame = 0;
    const render = () => {
      const current = snapshotRef.current;
      if (current) updateTerrainEvidence(resources, current);
      controls.update();
      renderer.render(scene, camera);
      animationFrame = requestAnimationFrame(render);
    };
    render();

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      controls.dispose();
      disposeScene(scene);
      renderer.dispose();
      mount.replaceChildren();
      resourcesRef.current = null;
    };
  }, [terrain]);

  useEffect(() => {
    if (resourcesRef.current) resourcesRef.current.wireframe.visible = wireframeVisible;
  }, [wireframeVisible]);

  useEffect(() => {
    if (resourcesRef.current) resourcesRef.current.sites.visible = sitesVisible;
  }, [sitesVisible]);

  const slopeDegrees = useMemo(() => {
    if (!snapshot) return 0;
    return Math.acos(Math.min(1, Math.max(-1, snapshot.contact.normal[1]))) * (180 / Math.PI);
  }, [snapshot]);

  const regenerate = () => {
    if (seedDraft.trim() === "") {
      setError("Enter a seed before generating terrain.");
      return;
    }
    const seed = sanitizeSeed(Number(seedDraft));
    if (seed === null) {
      setError(`Seed must be an integer from 0 to ${MAX_SEED}.`);
      return;
    }
    try {
      loadTerrain(seed);
    } catch (reason) {
      setError(String(reason));
    }
  };

  const holdKey = (key: string, active: boolean) => {
    if (active) keysRef.current.add(key);
    else keysRef.current.delete(key);
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950">
      <div className="flex flex-wrap items-end gap-3 border-b border-zinc-800 bg-zinc-950/95 p-3">
        <label className="grid gap-1 text-xs font-medium text-zinc-400">
          Terrain seed
          <input
            type="number"
            min={0}
            max={MAX_SEED}
            step={1}
            value={seedDraft}
            onChange={(event) => setSeedDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") regenerate();
            }}
            className="w-36 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-zinc-100 outline-none focus:border-cyan-500"
          />
        </label>
        <button
          type="button"
          onClick={regenerate}
          disabled={!wasmReady}
          className="rounded-lg bg-cyan-300 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Generate
        </button>
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-sm text-zinc-300">
          <input
            type="checkbox"
            checked={wireframeVisible}
            onChange={(event) => setWireframeVisible(event.target.checked)}
            className="accent-cyan-300"
          />
          Mesh edges
        </label>
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-sm text-zinc-300">
          <input
            type="checkbox"
            checked={sitesVisible}
            onChange={(event) => setSitesVisible(event.target.checked)}
            className="accent-amber-300"
          />
          Blue-noise sites
        </label>
        {terrain && snapshot ? (
          <p className="ml-auto text-xs leading-5 text-zinc-500" aria-live="polite">
            {terrain.stats.triangles.toLocaleString()} triangles · {terrain.stats.blueNoiseSites} sites · active triangle {snapshot.contact.triangle} · slope {slopeDegrees.toFixed(1)}° · {snapshot.triangleQueries} queries/frame
          </p>
        ) : null}
      </div>

      {error ? (
        <p className="border-b border-red-900/70 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          {error}
        </p>
      ) : null}

      <div
        role="application"
        aria-label="Blue-noise triangle terrain collision scenario"
        className="relative min-h-[38rem] touch-none"
      >
        <div ref={mountRef} className="absolute inset-0" />
        {!terrain && !error ? (
          <div className="absolute inset-0 grid place-items-center text-sm text-zinc-500">
            Generating deterministic terrain…
          </div>
        ) : null}
        <div className="pointer-events-none absolute left-3 top-3 rounded-lg border border-zinc-700/80 bg-zinc-950/80 px-3 py-2 text-xs leading-5 text-zinc-300 backdrop-blur">
          <span className="hidden sm:inline">WASD / arrows move · Space jumps · Drag rotates · Wheel zooms</span>
          <span className="sm:hidden">Use the controls to move and jump</span>
          <br />
          Rust triangle {snapshot?.contact.triangle ?? "—"} · {snapshot?.grounded ? "grounded" : "airborne"}
        </div>
        <div className="absolute bottom-4 left-4 grid grid-cols-3 gap-2 sm:hidden">
          <span />
          <TouchButton label="Move forward" onHold={(active) => holdKey("w", active)}>↑</TouchButton>
          <span />
          <TouchButton label="Move left" onHold={(active) => holdKey("a", active)}>←</TouchButton>
          <TouchButton label="Move backward" onHold={(active) => holdKey("s", active)}>↓</TouchButton>
          <TouchButton label="Move right" onHold={(active) => holdKey("d", active)}>→</TouchButton>
        </div>
        <button
          type="button"
          onPointerDown={() => {
            jumpRef.current = true;
          }}
          className="absolute bottom-4 right-4 rounded-full border border-cyan-300/70 bg-cyan-950/85 px-5 py-4 text-sm font-semibold text-cyan-100 backdrop-blur sm:hidden"
        >
          Jump
        </button>
      </div>

      {terrain ? (
        <details className="border-t border-zinc-800 px-4 py-3 text-sm text-zinc-400">
          <summary className="cursor-pointer font-medium text-zinc-300">Deterministic generation evidence</summary>
          <p className="mt-3 max-w-4xl leading-6">
            Rust selected each site from {terrain.stats.candidatesPerSite} candidates by maximizing its wrapped distance from accepted sites, then built one indexed {terrain.gridSize} × {terrain.gridSize} heightfield. The walker samples the exact visible triangle; the highlighted face and normal come from that query.
          </p>
          <p className="mt-2 font-mono text-xs text-zinc-500">
            {terrain.stats.candidateEvaluations.toLocaleString()} candidate evaluations · {terrain.stats.heightContributions.toLocaleString()} height contributions · minimum wrapped site spacing {terrain.stats.minimumSiteDistance.toFixed(3)}
          </p>
        </details>
      ) : null}
    </section>
  );
}

function TouchButton({
  children,
  label,
  onHold,
}: {
  children: string;
  label: string;
  onHold: (active: boolean) => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        onHold(true);
      }}
      onPointerUp={() => onHold(false)}
      onPointerCancel={() => onHold(false)}
      className="grid size-12 place-items-center rounded-xl border border-zinc-600 bg-zinc-950/85 text-xl text-zinc-100 backdrop-blur"
    >
      {children}
    </button>
  );
}

function sanitizeSeed(value: number): number | null {
  if (!Number.isInteger(value) || value < 0 || value > MAX_SEED) return null;
  return value;
}

function createTerrainGeometry(terrain: TerrainData) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(terrain.vertices.flat(), 3),
  );
  geometry.setIndex(terrain.indices);
  const colors: number[] = [];
  const low = new THREE.Color(0x21413c);
  const middle = new THREE.Color(0x5b7144);
  const high = new THREE.Color(0x9a8661);
  for (const [, height] of terrain.vertices) {
    const normalized = (height / terrain.heightScale + 1) * 0.5;
    const color = normalized < 0.5
      ? low.clone().lerp(middle, normalized * 2)
      : middle.clone().lerp(high, (normalized - 0.5) * 2);
    colors.push(color.r, color.g, color.b);
  }
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createSiteMarkers(terrain: TerrainData) {
  const markers = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.1, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xfbbf24 }),
    terrain.sites.length,
  );
  const matrix = new THREE.Matrix4();
  terrain.sites.forEach((site, index) => {
    matrix.makeTranslation(site.position[0], site.surfaceHeight + 0.12, site.position[1]);
    markers.setMatrixAt(index, matrix);
  });
  markers.instanceMatrix.needsUpdate = true;
  return markers;
}

function createWalker() {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.34, 1.02, 6, 12),
    new THREE.MeshStandardMaterial({ color: 0x22d3ee, roughness: 0.45 }),
  );
  body.castShadow = true;
  group.add(body);
  const heading = new THREE.Mesh(
    new THREE.ConeGeometry(0.14, 0.36, 8),
    new THREE.MeshStandardMaterial({ color: 0xf8fafc }),
  );
  heading.rotation.x = -Math.PI / 2;
  heading.position.set(0, 0.18, -0.48);
  heading.castShadow = true;
  group.add(heading);
  return group;
}

function updateTerrainEvidence(resources: RenderResources, snapshot: TerrainSnapshot) {
  resources.actor.position.set(...snapshot.position);
  resources.target.set(
    snapshot.position[0],
    snapshot.position[1] - 0.2,
    snapshot.position[2],
  );
  resources.controls.target.lerp(
    resources.target,
    0.12,
  );

  if (resources.contactTriangle !== snapshot.contact.triangle) {
    const positions = snapshot.contact.vertices.flatMap(([x, y, z]) => [x, y + 0.012, z]);
    resources.contact.geometry.dispose();
    resources.contact.geometry = new THREE.BufferGeometry();
    resources.contact.geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    resources.contact.geometry.setIndex([0, 1, 2]);
    resources.contact.geometry.computeVertexNormals();
    resources.contactTriangle = snapshot.contact.triangle;
  }

  resources.contactOrigin.set(
    snapshot.position[0],
    snapshot.contact.height + 0.04,
    snapshot.position[2],
  );
  resources.normal.position.copy(resources.contactOrigin);
  resources.normalDirection.set(...snapshot.contact.normal);
  resources.normal.setDirection(resources.normalDirection);
}

function disposeScene(scene: THREE.Scene) {
  scene.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) material.dispose();
    }
  });
}
