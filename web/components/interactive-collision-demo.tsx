"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import initWasm, { DemoWorld } from "../lib/wasm-pkg/collision_wasm";

type AlgorithmId =
  | "naive"
  | "uniform-grid"
  | "sweep-and-prune"
  | "static-bvh"
  | "dynamic-aabb-tree";

type DemoBody = {
  id: number;
  min: [number, number, number];
  max: [number, number, number];
  motion: "static" | "dynamic";
  velocity: [number, number, number];
};

type DemoSnapshot = {
  algorithm: AlgorithmId;
  scenario: "uniform" | "clustered";
  frame: number;
  bodies: DemoBody[];
  pairs: [number, number][];
  counts: {
    static: number;
    dynamic: number;
  };
  stats: {
    aabbTests: number;
    occupiedCells: number | null;
  };
  possiblePairs: number;
};

type RenderResources = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  bodyMesh: THREE.InstancedMesh;
  fatMesh: THREE.InstancedMesh | null;
  pairLines: THREE.LineSegments;
  resizeObserver: ResizeObserver;
  animationFrame: number;
};

const ALGORITHMS: { value: AlgorithmId; label: string }[] = [
  { value: "naive", label: "Naive all-pairs" },
  { value: "uniform-grid", label: "Uniform grid" },
  { value: "sweep-and-prune", label: "Sweep and prune" },
  { value: "static-bvh", label: "Static BVH" },
  { value: "dynamic-aabb-tree", label: "Dynamic AABB tree" },
];

const FIXED_TIMESTEP_SECONDS = 1 / 30;

export function InteractiveCollisionDemo({
  initialAlgorithm = "uniform-grid",
}: {
  initialAlgorithm?: AlgorithmId;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<DemoWorld | null>(null);
  const renderRef = useRef<RenderResources | null>(null);
  const [wasmReady, setWasmReady] = useState(false);
  const [algorithm, setAlgorithm] = useState<AlgorithmId>(initialAlgorithm);
  const [scenario, setScenario] = useState<"uniform" | "clustered">("clustered");
  const [objects, setObjects] = useState(220);
  const [cellSize, setCellSize] = useState(4);
  const [fatMargin, setFatMargin] = useState(1.5);
  const [dynamicFraction, setDynamicFraction] = useState(0.35);
  const [speed, setSpeed] = useState(8);
  const [seed, setSeed] = useState(42);
  const [isPlaying, setIsPlaying] = useState(true);
  const [snapshot, setSnapshot] = useState<DemoSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const worldExtent = 28;
  const halfExtent = 1.15;

  useEffect(() => {
    let active = true;
    initWasm()
      .then(() => {
        if (active) setWasmReady(true);
      })
      .catch((reason: unknown) => {
        if (active) setError(String(reason));
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!wasmReady) return;

    try {
      worldRef.current?.free();
      const world = new DemoWorld(
        scenario,
        objects,
        cellSize,
        fatMargin,
        seed,
        worldExtent,
        halfExtent,
        dynamicFraction,
        speed,
      );
      worldRef.current = world;
      setSnapshot(JSON.parse(world.snapshot_json(algorithm)) as DemoSnapshot);
      setError(null);
    } catch (reason) {
      setError(String(reason));
    }

    return () => {
      worldRef.current?.free();
      worldRef.current = null;
    };
    // `algorithm` intentionally does not recreate the deterministic world.
    // Switching broad phases should inspect the same simulation frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wasmReady, scenario, objects, cellSize, fatMargin, seed, dynamicFraction, speed]);

  useEffect(() => {
    const world = worldRef.current;
    if (!world) return;
    try {
      setSnapshot(JSON.parse(world.snapshot_json(algorithm)) as DemoSnapshot);
      setError(null);
    } catch (reason) {
      setError(String(reason));
    }
  }, [algorithm]);

  useEffect(() => {
    if (!isPlaying || !wasmReady) return;

    const timer = window.setInterval(() => {
      const world = worldRef.current;
      if (!world) return;
      try {
        setSnapshot(
          JSON.parse(world.step_json(algorithm, FIXED_TIMESTEP_SECONDS)) as DemoSnapshot,
        );
        setError(null);
      } catch (reason) {
        setIsPlaying(false);
        setError(String(reason));
      }
    }, 1000 / 30);

    return () => window.clearInterval(timer);
  }, [algorithm, isPlaying, wasmReady]);

  const collidingIds = useMemo(() => {
    const ids = new Set<number>();
    for (const [a, b] of snapshot?.pairs ?? []) {
      ids.add(a);
      ids.add(b);
    }
    return ids;
  }, [snapshot]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x09090b);

    const width = Math.max(mount.clientWidth, 320);
    const height = Math.max(mount.clientHeight, 420);
    const camera = new THREE.PerspectiveCamera(48, width / height, 0.1, 500);
    camera.position.set(worldExtent * 1.45, worldExtent * 1.15, worldExtent * 1.45);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    mount.replaceChildren(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 0, 0);

    scene.add(new THREE.AmbientLight(0xffffff, 1.5));
    scene.add(new THREE.AxesHelper(8));

    const worldBox = new THREE.Box3(
      new THREE.Vector3(-worldExtent, -worldExtent, -worldExtent),
      new THREE.Vector3(worldExtent, worldExtent, worldExtent),
    );
    scene.add(new THREE.Box3Helper(worldBox, 0x3f3f46));

    if (algorithm === "uniform-grid") {
      const divisions = Math.max(4, Math.min(40, Math.round((worldExtent * 2) / cellSize)));
      scene.add(new THREE.GridHelper(worldExtent * 2, divisions, 0x71717a, 0x27272a));
    }

    if (algorithm === "sweep-and-prune") {
      const sweepGeometry = new THREE.BoxGeometry(0.12, worldExtent * 2, worldExtent * 2);
      const sweepMaterial = new THREE.MeshBasicMaterial({
        color: 0x60a5fa,
        transparent: true,
        opacity: 0.1,
      });
      scene.add(new THREE.Mesh(sweepGeometry, sweepMaterial));
    }

    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshBasicMaterial({ wireframe: true, vertexColors: true });
    const bodyMesh = new THREE.InstancedMesh(geometry, material, objects);
    bodyMesh.count = 0;
    bodyMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(bodyMesh);

    let fatMesh: THREE.InstancedMesh | null = null;
    if (algorithm === "dynamic-aabb-tree") {
      const fatGeometry = new THREE.BoxGeometry(1, 1, 1);
      const fatMaterial = new THREE.MeshBasicMaterial({
        color: 0xa78bfa,
        wireframe: true,
        transparent: true,
        opacity: 0.12,
      });
      fatMesh = new THREE.InstancedMesh(fatGeometry, fatMaterial, objects);
      fatMesh.count = 0;
      scene.add(fatMesh);
    }

    const pairGeometry = new THREE.BufferGeometry();
    const pairMaterial = new THREE.LineBasicMaterial({
      color: 0xef4444,
      transparent: true,
      opacity: 0.45,
    });
    const pairLines = new THREE.LineSegments(pairGeometry, pairMaterial);
    scene.add(pairLines);

    let animationFrame = 0;
    const render = () => {
      controls.update();
      renderer.render(scene, camera);
      animationFrame = window.requestAnimationFrame(render);
      if (renderRef.current) renderRef.current.animationFrame = animationFrame;
    };
    render();

    const resizeObserver = new ResizeObserver(() => {
      const nextWidth = Math.max(mount.clientWidth, 320);
      const nextHeight = Math.max(mount.clientHeight, 420);
      renderer.setSize(nextWidth, nextHeight);
      camera.aspect = nextWidth / nextHeight;
      camera.updateProjectionMatrix();
    });
    resizeObserver.observe(mount);

    renderRef.current = {
      scene,
      camera,
      renderer,
      controls,
      bodyMesh,
      fatMesh,
      pairLines,
      resizeObserver,
      animationFrame,
    };

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      controls.dispose();
      scene.traverse((object) => {
        if (
          object instanceof THREE.Mesh ||
          object instanceof THREE.LineSegments ||
          object instanceof THREE.InstancedMesh
        ) {
          object.geometry.dispose();
          const objectMaterial = object.material;
          if (Array.isArray(objectMaterial)) {
            objectMaterial.forEach((entry) => entry.dispose());
          } else {
            objectMaterial.dispose();
          }
        }
      });
      renderer.dispose();
      renderRef.current = null;
      mount.replaceChildren();
    };
  }, [algorithm, cellSize, fatMargin, objects, worldExtent]);

  useEffect(() => {
    const resources = renderRef.current;
    if (!resources || !snapshot) return;

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const staticColor = new THREE.Color(0x71717a);
    const dynamicColor = new THREE.Color(0x22d3ee);
    const collisionColor = new THREE.Color(0xf87171);
    const centers = new Map<number, THREE.Vector3>();

    resources.bodyMesh.count = snapshot.bodies.length;
    snapshot.bodies.forEach((body, index) => {
      position.set(
        (body.min[0] + body.max[0]) * 0.5,
        (body.min[1] + body.max[1]) * 0.5,
        (body.min[2] + body.max[2]) * 0.5,
      );
      scale.set(
        body.max[0] - body.min[0],
        body.max[1] - body.min[1],
        body.max[2] - body.min[2],
      );
      matrix.compose(position, quaternion, scale);
      resources.bodyMesh.setMatrixAt(index, matrix);
      const baseColor = body.motion === "dynamic" ? dynamicColor : staticColor;
      resources.bodyMesh.setColorAt(
        index,
        collidingIds.has(body.id) ? collisionColor : baseColor,
      );
      centers.set(body.id, position.clone());
    });
    resources.bodyMesh.instanceMatrix.needsUpdate = true;
    if (resources.bodyMesh.instanceColor) resources.bodyMesh.instanceColor.needsUpdate = true;

    if (resources.fatMesh) {
      resources.fatMesh.count = snapshot.bodies.length;
      snapshot.bodies.forEach((body, index) => {
        position.set(
          (body.min[0] + body.max[0]) * 0.5,
          (body.min[1] + body.max[1]) * 0.5,
          (body.min[2] + body.max[2]) * 0.5,
        );
        scale.set(
          body.max[0] - body.min[0] + fatMargin * 2,
          body.max[1] - body.min[1] + fatMargin * 2,
          body.max[2] - body.min[2] + fatMargin * 2,
        );
        matrix.compose(position, quaternion, scale);
        resources.fatMesh?.setMatrixAt(index, matrix);
      });
      resources.fatMesh.instanceMatrix.needsUpdate = true;
    }

    const visiblePairs = snapshot.pairs.slice(0, 1500);
    const positions = new Float32Array(visiblePairs.length * 6);
    visiblePairs.forEach(([a, b], index) => {
      const left = centers.get(a);
      const right = centers.get(b);
      if (!left || !right) return;
      const offset = index * 6;
      positions[offset] = left.x;
      positions[offset + 1] = left.y;
      positions[offset + 2] = left.z;
      positions[offset + 3] = right.x;
      positions[offset + 4] = right.y;
      positions[offset + 5] = right.z;
    });
    resources.pairLines.geometry.dispose();
    const pairGeometry = new THREE.BufferGeometry();
    pairGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    resources.pairLines.geometry = pairGeometry;
  }, [collidingIds, fatMargin, snapshot]);

  const reduction =
    snapshot && snapshot.possiblePairs > 0
      ? 100 * (1 - snapshot.stats.aabbTests / snapshot.possiblePairs)
      : 0;

  const stepOnce = () => {
    const world = worldRef.current;
    if (!world) return;
    try {
      setSnapshot(
        JSON.parse(world.step_json(algorithm, FIXED_TIMESTEP_SECONDS)) as DemoSnapshot,
      );
      setError(null);
    } catch (reason) {
      setError(String(reason));
    }
  };

  return (
    <section className="overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-950">
      <div className="grid lg:grid-cols-[20rem_1fr]">
        <div className="border-b border-zinc-800 p-5 lg:border-b-0 lg:border-r">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
            Rust → WASM → Three.js
          </p>
          <h2 className="mt-2 text-xl font-semibold text-zinc-100">Live collision playground</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-500">
            Static bodies stay fixed. Dynamic bodies move in deterministic fixed timesteps. Rust owns both motion and collision results.
          </p>

          <label className="mt-6 block text-xs font-semibold text-zinc-400">
            Algorithm
            <select
              value={algorithm}
              onChange={(event) => setAlgorithm(event.target.value as AlgorithmId)}
              className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
            >
              {ALGORITHMS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <label className="mt-4 block text-xs font-semibold text-zinc-400">
            Scene
            <select
              value={scenario}
              onChange={(event) => setScenario(event.target.value as "uniform" | "clustered")}
              className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
            >
              <option value="uniform">Uniform</option>
              <option value="clustered">Clustered</option>
            </select>
          </label>

          <Control label={`Objects · ${objects}`} min={40} max={600} step={20} value={objects} onChange={setObjects} />
          <Control
            label={`Moving · ${Math.round(dynamicFraction * 100)}%`}
            min={0}
            max={1}
            step={0.05}
            value={dynamicFraction}
            onChange={setDynamicFraction}
          />
          <Control label={`Speed · ${speed.toFixed(1)}`} min={0} max={20} step={0.5} value={speed} onChange={setSpeed} />
          <Control label={`Grid cell · ${cellSize.toFixed(1)}`} min={1} max={12} step={0.5} value={cellSize} onChange={setCellSize} />
          <Control label={`Fat margin · ${fatMargin.toFixed(1)}`} min={0} max={5} step={0.25} value={fatMargin} onChange={setFatMargin} />

          <div className="mt-5 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setIsPlaying((value) => !value)}
              className="rounded-lg bg-zinc-100 px-3 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-white"
            >
              {isPlaying ? "Pause" : "Play"}
            </button>
            <button
              type="button"
              onClick={stepOnce}
              disabled={isPlaying}
              className="rounded-lg border border-zinc-700 px-3 py-2 text-sm font-semibold text-zinc-200 transition hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Step
            </button>
          </div>
          <button
            type="button"
            onClick={() => setSeed((value) => value + 1)}
            className="mt-2 w-full rounded-lg border border-zinc-700 px-3 py-2 text-sm font-semibold text-zinc-200 transition hover:border-zinc-500"
          >
            Regenerate · seed {seed}
          </button>

          <div className="mt-5 flex flex-wrap gap-x-4 gap-y-2 text-xs text-zinc-500">
            <Legend colorClass="bg-zinc-500" label="Static" />
            <Legend colorClass="bg-cyan-400" label="Dynamic" />
            <Legend colorClass="bg-red-400" label="Colliding" />
          </div>

          <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
            <Metric label="Frame" value={snapshot?.frame.toLocaleString() ?? "—"} />
            <Metric label="Overlaps" value={snapshot?.pairs.length.toLocaleString() ?? "—"} />
            <Metric label="Static" value={snapshot?.counts.static.toLocaleString() ?? "—"} />
            <Metric label="Dynamic" value={snapshot?.counts.dynamic.toLocaleString() ?? "—"} />
            <Metric label="AABB tests" value={snapshot?.stats.aabbTests.toLocaleString() ?? "—"} />
            <Metric label="Tests avoided" value={snapshot ? `${reduction.toFixed(2)}%` : "—"} />
          </dl>

          {error && (
            <p className="mt-5 rounded-lg border border-red-900/50 bg-red-950/30 p-3 text-xs leading-5 text-red-300">
              {error}
            </p>
          )}
        </div>

        <div className="relative min-h-[34rem]">
          <div ref={mountRef} className="absolute inset-0" />
          {!snapshot && !error && (
            <div className="absolute inset-0 grid place-items-center text-sm text-zinc-500">
              Loading Rust/WASM…
            </div>
          )}
          <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg bg-zinc-950/80 px-3 py-2 text-xs text-zinc-500 backdrop-blur">
            Drag to orbit · scroll to zoom · Pause then Step to inspect frames
          </div>
        </div>
      </div>
    </section>
  );
}

function Control({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="mt-4 block text-xs font-semibold text-zinc-400">
      {label}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-2 w-full accent-zinc-200"
      />
    </label>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
      <dt className="text-[11px] uppercase tracking-wide text-zinc-600">{label}</dt>
      <dd className="mt-1 font-mono text-zinc-200">{value}</dd>
    </div>
  );
}

function Legend({ colorClass, label }: { colorClass: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${colorClass}`} />
      {label}
    </span>
  );
}
