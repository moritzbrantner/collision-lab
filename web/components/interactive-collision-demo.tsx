"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import { InteractionMatrixEditor, type InteractionMatrixData } from "./interaction-matrix-editor";
import initWasm, { DemoWorld } from "../lib/wasm-pkg/collision_wasm";

type AlgorithmId =
  | "naive"
  | "uniform-grid"
  | "sweep-and-prune"
  | "static-bvh"
  | "dynamic-aabb-tree";

type Pair = [number, number];

type DemoBody = {
  id: number;
  min: [number, number, number];
  max: [number, number, number];
  motion: "static" | "dynamic";
  interaction: "solid" | "sensor";
  layer: string;
  layerBits: number;
  velocity: [number, number, number];
};

type DemoSnapshot = {
  algorithm: AlgorithmId;
  scenario: "uniform" | "clustered";
  frame: number;
  bodies: DemoBody[];
  pairs: Pair[];
  sensorPairs: Pair[];
  counts: {
    static: number;
    dynamic: number;
    solid: number;
    sensor: number;
  };
  stats: {
    aabbTests: number;
    occupiedCells: number | null;
    spatialOverlaps: number;
    filteredOut: number;
    interactionPairs: number;
    sensorPairs: number;
  };
  interactionMatrix: InteractionMatrixData;
  possiblePairs: number;
};

type GridTraceStep = {
  cell: [number, number, number];
  members: number[];
  candidateCount: number;
  testedCount: number;
  overlapCount: number;
  candidatePairs: Pair[];
  testedPairs: Pair[];
  overlappingPairs: Pair[];
};

type GridTrace = {
  kind: "uniform-grid";
  frame: number;
  aabbTests: number;
  cellSize: number;
  steps: GridTraceStep[];
};

type SweepTraceStep = {
  current: number;
  intervalMin: number;
  intervalMax: number;
  expired: number[];
  activeBeforeTests: number[];
  testedCount: number;
  overlapCount: number;
  testedPairs: Pair[];
  overlappingPairs: Pair[];
  activeAfter: number[];
};

type SweepTrace = {
  kind: "sweep-and-prune";
  frame: number;
  axis: "x";
  aabbTests: number;
  order: number[];
  steps: SweepTraceStep[];
};

type UnsupportedTrace = {
  kind: "unsupported";
  frame: number;
  algorithm: AlgorithmId;
};

type AlgorithmTrace = GridTrace | SweepTrace | UnsupportedTrace;

type RenderResources = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  bodyMesh: THREE.InstancedMesh;
  sensorMesh: THREE.InstancedMesh;
  fatMesh: THREE.InstancedMesh | null;
  pairLines: THREE.LineSegments;
  sensorPairLines: THREE.LineSegments;
  tracePairLines: THREE.LineSegments;
  sweepPlane: THREE.Mesh | null;
  traceCellHelper: THREE.Box3Helper | null;
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
const SENSOR_OUTLINE_PADDING = 0.22;

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
  const [sensorFraction, setSensorFraction] = useState(0.15);
  const [speed, setSpeed] = useState(8);
  const [seed, setSeed] = useState(42);
  const [isPlaying, setIsPlaying] = useState(true);
  const [snapshot, setSnapshot] = useState<DemoSnapshot | null>(null);
  const [trace, setTrace] = useState<AlgorithmTrace | null>(null);
  const [traceStepIndex, setTraceStepIndex] = useState(0);
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
        sensorFraction,
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
    // Switching broad phases should inspect the same world instead of recreating it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    wasmReady,
    scenario,
    objects,
    cellSize,
    fatMargin,
    seed,
    dynamicFraction,
    sensorFraction,
    speed,
  ]);

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

  useEffect(() => {
    const world = worldRef.current;
    if (isPlaying || !world || !snapshot) {
      setTrace(null);
      setTraceStepIndex(0);
      return;
    }

    try {
      setTrace(JSON.parse(world.trace_json(algorithm)) as AlgorithmTrace);
      setTraceStepIndex(0);
      setError(null);
    } catch (reason) {
      setError(String(reason));
    }
  }, [algorithm, isPlaying, snapshot]);

  const currentTraceStep = useMemo(() => {
    if (!trace || trace.kind === "unsupported") return null;
    if (trace.steps.length === 0) return null;
    return trace.steps[Math.min(traceStepIndex, trace.steps.length - 1)];
  }, [trace, traceStepIndex]);

  const collidingIds = useMemo(() => idsFromPairs(snapshot?.pairs ?? []), [snapshot]);

  const traceFocus = useMemo(() => {
    const active = new Set<number>();
    const current = new Set<number>();
    const overlaps = new Set<number>();
    const testedPairs: Pair[] = [];

    if (trace?.kind === "uniform-grid" && currentTraceStep) {
      const step = currentTraceStep as GridTraceStep;
      step.members.forEach((id) => active.add(id));
      step.overlappingPairs.flat().forEach((id) => overlaps.add(id));
      testedPairs.push(...step.testedPairs);
    } else if (trace?.kind === "sweep-and-prune" && currentTraceStep) {
      const step = currentTraceStep as SweepTraceStep;
      current.add(step.current);
      step.activeBeforeTests.forEach((id) => active.add(id));
      step.overlappingPairs.flat().forEach((id) => overlaps.add(id));
      testedPairs.push(...step.testedPairs);
    }

    return { active, current, overlaps, testedPairs };
  }, [currentTraceStep, trace]);

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
    scene.add(
      new THREE.Box3Helper(
        new THREE.Box3(
          new THREE.Vector3(-worldExtent, -worldExtent, -worldExtent),
          new THREE.Vector3(worldExtent, worldExtent, worldExtent),
        ),
        0x3f3f46,
      ),
    );

    if (algorithm === "uniform-grid") {
      const divisions = Math.max(4, Math.min(40, Math.round((worldExtent * 2) / cellSize)));
      scene.add(new THREE.GridHelper(worldExtent * 2, divisions, 0x71717a, 0x27272a));
    }

    let sweepPlane: THREE.Mesh | null = null;
    if (algorithm === "sweep-and-prune") {
      const sweepGeometry = new THREE.BoxGeometry(0.12, worldExtent * 2, worldExtent * 2);
      const sweepMaterial = new THREE.MeshBasicMaterial({
        color: 0x60a5fa,
        transparent: true,
        opacity: 0.12,
      });
      sweepPlane = new THREE.Mesh(sweepGeometry, sweepMaterial);
      scene.add(sweepPlane);
    }

    const bodyMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ wireframe: true, vertexColors: true }),
      objects,
    );
    bodyMesh.count = 0;
    bodyMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(bodyMesh);

    const sensorMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({
        color: 0xe879f9,
        wireframe: true,
        transparent: true,
        opacity: 0.65,
      }),
      objects,
    );
    sensorMesh.count = 0;
    sensorMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(sensorMesh);

    let fatMesh: THREE.InstancedMesh | null = null;
    if (algorithm === "dynamic-aabb-tree") {
      fatMesh = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial({
          color: 0xa78bfa,
          wireframe: true,
          transparent: true,
          opacity: 0.12,
        }),
        objects,
      );
      fatMesh.count = 0;
      scene.add(fatMesh);
    }

    const pairLines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.45 }),
    );
    scene.add(pairLines);

    const sensorPairLines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xe879f9, transparent: true, opacity: 0.8 }),
    );
    scene.add(sensorPairLines);

    const tracePairLines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.9 }),
    );
    scene.add(tracePairLines);

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
      sensorMesh,
      fatMesh,
      pairLines,
      sensorPairLines,
      tracePairLines,
      sweepPlane,
      traceCellHelper: null,
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
          if (Array.isArray(objectMaterial)) objectMaterial.forEach((entry) => entry.dispose());
          else objectMaterial.dispose();
        }
      });
      renderer.dispose();
      renderRef.current = null;
      mount.replaceChildren();
    };
  }, [algorithm, cellSize, objects, worldExtent]);

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
    const activeColor = new THREE.Color(0xa78bfa);
    const currentColor = new THREE.Color(0xfacc15);
    const centers = new Map<number, THREE.Vector3>();

    resources.bodyMesh.count = snapshot.bodies.length;
    let sensorIndex = 0;
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

      let color = body.motion === "dynamic" ? dynamicColor : staticColor;
      if (collidingIds.has(body.id)) color = collisionColor;
      if (traceFocus.active.has(body.id)) color = activeColor;
      if (traceFocus.overlaps.has(body.id)) color = collisionColor;
      if (traceFocus.current.has(body.id)) color = currentColor;
      resources.bodyMesh.setColorAt(index, color);
      centers.set(body.id, position.clone());

      if (body.interaction === "sensor") {
        scale.set(
          body.max[0] - body.min[0] + SENSOR_OUTLINE_PADDING,
          body.max[1] - body.min[1] + SENSOR_OUTLINE_PADDING,
          body.max[2] - body.min[2] + SENSOR_OUTLINE_PADDING,
        );
        matrix.compose(position, quaternion, scale);
        resources.sensorMesh.setMatrixAt(sensorIndex, matrix);
        sensorIndex += 1;
      }
    });
    resources.bodyMesh.instanceMatrix.needsUpdate = true;
    if (resources.bodyMesh.instanceColor) resources.bodyMesh.instanceColor.needsUpdate = true;
    resources.sensorMesh.count = sensorIndex;
    resources.sensorMesh.instanceMatrix.needsUpdate = true;

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

    const sensorKeys = new Set(snapshot.sensorPairs.map(pairKey));
    const solidPairs = snapshot.pairs.filter((pair) => !sensorKeys.has(pairKey(pair)));
    replaceLineGeometry(resources.pairLines, solidPairs.slice(0, 1500), centers);
    replaceLineGeometry(resources.sensorPairLines, snapshot.sensorPairs.slice(0, 1500), centers);
    replaceLineGeometry(resources.tracePairLines, traceFocus.testedPairs, centers);
  }, [collidingIds, fatMargin, snapshot, traceFocus]);

  useEffect(() => {
    const resources = renderRef.current;
    if (!resources) return;

    if (resources.traceCellHelper) {
      resources.scene.remove(resources.traceCellHelper);
      resources.traceCellHelper.geometry.dispose();
      const material = resources.traceCellHelper.material;
      if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
      else material.dispose();
      resources.traceCellHelper = null;
    }

    if (trace?.kind === "uniform-grid" && currentTraceStep) {
      const step = currentTraceStep as GridTraceStep;
      const [x, y, z] = step.cell;
      const helper = new THREE.Box3Helper(
        new THREE.Box3(
          new THREE.Vector3(x * cellSize, y * cellSize, z * cellSize),
          new THREE.Vector3((x + 1) * cellSize, (y + 1) * cellSize, (z + 1) * cellSize),
        ),
        0xfacc15,
      );
      resources.scene.add(helper);
      resources.traceCellHelper = helper;
    }

    if (resources.sweepPlane) {
      resources.sweepPlane.position.x =
        trace?.kind === "sweep-and-prune" && currentTraceStep
          ? (currentTraceStep as SweepTraceStep).intervalMin
          : 0;
    }
  }, [cellSize, currentTraceStep, trace]);

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

  const toggleLayerInteraction = (leftBits: number, rightBits: number, allowed: boolean) => {
    const world = worldRef.current;
    if (!world) return;
    try {
      world.set_layer_interaction(leftBits, rightBits, allowed);
      setSnapshot(JSON.parse(world.snapshot_json(algorithm)) as DemoSnapshot);
      setError(null);
    } catch (reason) {
      setError(String(reason));
    }
  };

  return (
    <section className="overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-950">
      <div className="grid lg:grid-cols-[22rem_1fr]">
        <div className="border-b border-zinc-800 p-5 lg:border-b-0 lg:border-r">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
            Rust → WASM → Three.js
          </p>
          <h2 className="mt-2 text-xl font-semibold text-zinc-100">Live collision playground</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-500">
            Motion, interaction meaning, and layer eligibility are independent. Sensor bodies are marked separately and never change how broad-phase geometry is computed.
          </p>

          <label className="mt-6 block text-xs font-semibold text-zinc-400">
            Algorithm
            <select
              value={algorithm}
              onChange={(event) => setAlgorithm(event.target.value as AlgorithmId)}
              className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
            >
              {ALGORITHMS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
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
          <Control label={`Moving · ${Math.round(dynamicFraction * 100)}%`} min={0} max={1} step={0.05} value={dynamicFraction} onChange={setDynamicFraction} />
          <Control label={`Sensors · ${Math.round(sensorFraction * 100)}%`} min={0} max={1} step={0.05} value={sensorFraction} onChange={setSensorFraction} />
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
              Simulation step
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
            <Legend colorClass="bg-red-400" label="Solid interaction" />
            <Legend colorClass="bg-fuchsia-400" label="Sensor / sensor interaction" />
            <Legend colorClass="bg-violet-400" label="Trace active" />
            <Legend colorClass="bg-yellow-400" label="Trace current" />
          </div>

          <InteractionMatrixEditor
            matrix={snapshot?.interactionMatrix ?? null}
            spatialOverlaps={snapshot?.stats.spatialOverlaps ?? null}
            filteredOut={snapshot?.stats.filteredOut ?? null}
            interactionPairs={snapshot?.stats.interactionPairs ?? null}
            sensorPairs={snapshot?.stats.sensorPairs ?? null}
            onToggle={toggleLayerInteraction}
          />

          <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
            <Metric label="Frame" value={snapshot?.frame.toLocaleString() ?? "—"} />
            <Metric label="Interactions" value={snapshot?.pairs.length.toLocaleString() ?? "—"} />
            <Metric label="Static" value={snapshot?.counts.static.toLocaleString() ?? "—"} />
            <Metric label="Dynamic" value={snapshot?.counts.dynamic.toLocaleString() ?? "—"} />
            <Metric label="Solid bodies" value={snapshot?.counts.solid.toLocaleString() ?? "—"} />
            <Metric label="Sensor bodies" value={snapshot?.counts.sensor.toLocaleString() ?? "—"} />
            <Metric label="AABB tests" value={snapshot?.stats.aabbTests.toLocaleString() ?? "—"} />
            <Metric label="Tests avoided" value={snapshot ? `${reduction.toFixed(2)}%` : "—"} />
          </dl>

          {error && (
            <p className="mt-5 rounded-lg border border-red-900/50 bg-red-950/30 p-3 text-xs leading-5 text-red-300">{error}</p>
          )}
        </div>

        <div className="relative min-h-[42rem]">
          <div ref={mountRef} className="absolute inset-0" />
          {!snapshot && !error && (
            <div className="absolute inset-0 grid place-items-center text-sm text-zinc-500">Loading Rust/WASM…</div>
          )}
          {!isPlaying && snapshot && (
            <TraceInspector trace={trace} stepIndex={traceStepIndex} onStepChange={setTraceStepIndex} />
          )}
          {isPlaying && (
            <div className="pointer-events-none absolute right-3 top-3 rounded-lg border border-zinc-800 bg-zinc-950/85 px-3 py-2 text-xs text-zinc-500 backdrop-blur">
              Pause the simulation to inspect kernel execution.
            </div>
          )}
          <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg bg-zinc-950/80 px-3 py-2 text-xs text-zinc-500 backdrop-blur">
            Drag to orbit · scroll to zoom
          </div>
        </div>
      </div>
    </section>
  );
}

function TraceInspector({
  trace,
  stepIndex,
  onStepChange,
}: {
  trace: AlgorithmTrace | null;
  stepIndex: number;
  onStepChange: (index: number) => void;
}) {
  if (!trace) {
    return <TraceCard>Computing the Rust execution trace…</TraceCard>;
  }
  if (trace.kind === "unsupported") {
    return (
      <TraceCard>
        <p className="font-semibold text-zinc-200">Trace coming next</p>
        <p className="mt-2 leading-5 text-zinc-500">
          This first inspector covers uniform grid and sweep-and-prune. BVH traversal and dynamic-tree mutation traces are the next batch.
        </p>
      </TraceCard>
    );
  }

  const maxIndex = Math.max(0, trace.steps.length - 1);
  const index = Math.min(stepIndex, maxIndex);
  const step = trace.steps[index];

  return (
    <div className="absolute right-3 top-3 z-10 w-[min(24rem,calc(100%-1.5rem))] rounded-2xl border border-zinc-700 bg-zinc-950/95 p-4 text-xs shadow-2xl backdrop-blur">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-semibold uppercase tracking-[0.16em] text-zinc-500">Kernel execution trace</p>
          <p className="mt-1 text-sm font-semibold text-zinc-100">
            {trace.kind === "uniform-grid" ? "Uniform grid" : "Sweep and prune"}
          </p>
        </div>
        <span className="font-mono text-zinc-500">{index + 1}/{trace.steps.length}</span>
      </div>

      <input
        type="range"
        min={0}
        max={maxIndex}
        value={index}
        onChange={(event) => onStepChange(Number(event.target.value))}
        className="mt-4 w-full accent-yellow-300"
      />
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button type="button" disabled={index === 0} onClick={() => onStepChange(index - 1)} className="rounded-lg border border-zinc-700 px-3 py-2 text-zinc-300 disabled:opacity-30">← Previous</button>
        <button type="button" disabled={index === maxIndex} onClick={() => onStepChange(index + 1)} className="rounded-lg border border-zinc-700 px-3 py-2 text-zinc-300 disabled:opacity-30">Next →</button>
      </div>

      {trace.kind === "uniform-grid" ? (
        <GridStepDetails step={step as GridTraceStep} />
      ) : (
        <SweepStepDetails step={step as SweepTraceStep} />
      )}
    </div>
  );
}

function GridStepDetails({ step }: { step: GridTraceStep }) {
  return (
    <div className="mt-4 space-y-3">
      <TraceMetric label="Cell" value={`(${step.cell.join(", ")})`} />
      <TraceMetric label="Members" value={`${step.members.length} · ${formatIds(step.members)}`} />
      <div className="grid grid-cols-3 gap-2">
        <SmallMetric label="Candidates" value={step.candidateCount} />
        <SmallMetric label="New tests" value={step.testedCount} />
        <SmallMetric label="Overlaps" value={step.overlapCount} />
      </div>
      <PairPreview label="New exact tests" pairs={step.testedPairs} />
      <PairPreview label="Overlaps found here" pairs={step.overlappingPairs} />
    </div>
  );
}

function SweepStepDetails({ step }: { step: SweepTraceStep }) {
  return (
    <div className="mt-4 space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <SmallMetric label="Current body" value={step.current} />
        <SmallMetric label="New tests" value={step.testedCount} />
      </div>
      <TraceMetric label="X interval" value={`${step.intervalMin.toFixed(2)} → ${step.intervalMax.toFixed(2)}`} />
      <TraceMetric label="Expired" value={formatIds(step.expired)} />
      <TraceMetric label="Active before tests" value={formatIds(step.activeBeforeTests)} />
      <PairPreview label="Pairs tested" pairs={step.testedPairs} />
      <PairPreview label="Overlaps found" pairs={step.overlappingPairs} />
    </div>
  );
}

function TraceCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute right-3 top-3 z-10 w-[min(22rem,calc(100%-1.5rem))] rounded-2xl border border-zinc-800 bg-zinc-950/95 p-4 text-xs text-zinc-400 shadow-2xl backdrop-blur">
      {children}
    </div>
  );
}

function Control({ label, min, max, step, value, onChange }: { label: string; min: number; max: number; step: number; value: number; onChange: (value: number) => void }) {
  return (
    <label className="mt-4 block text-xs font-semibold text-zinc-400">
      {label}
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} className="mt-2 w-full accent-zinc-200" />
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

function SmallMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-2">
      <div className="text-[10px] uppercase tracking-wide text-zinc-600">{label}</div>
      <div className="mt-1 font-mono text-zinc-200">{value}</div>
    </div>
  );
}

function TraceMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-zinc-600">{label}</div>
      <div className="mt-1 break-words font-mono leading-5 text-zinc-300">{value || "—"}</div>
    </div>
  );
}

function PairPreview({ label, pairs }: { label: string; pairs: Pair[] }) {
  return <TraceMetric label={label} value={pairs.length ? pairs.map(([a, b]) => `${a}↔${b}`).join(" · ") : "—"} />;
}

function Legend({ colorClass, label }: { colorClass: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${colorClass}`} />
      {label}
    </span>
  );
}

function idsFromPairs(pairs: Pair[]) {
  const ids = new Set<number>();
  pairs.forEach(([a, b]) => {
    ids.add(a);
    ids.add(b);
  });
  return ids;
}

function pairKey([a, b]: Pair) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function formatIds(ids: number[]) {
  if (ids.length === 0) return "—";
  const preview = ids.slice(0, 20).join(", ");
  return ids.length > 20 ? `${preview}, … +${ids.length - 20}` : preview;
}

function replaceLineGeometry(
  lines: THREE.LineSegments,
  pairs: Pair[],
  centers: Map<number, THREE.Vector3>,
) {
  const positions = new Float32Array(pairs.length * 6);
  pairs.forEach(([a, b], index) => {
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
  lines.geometry.dispose();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  lines.geometry = geometry;
}
