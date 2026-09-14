"use client";

import { useEffect, useRef, useState } from "react";

type RendererKind = "three" | "three-webgpu" | "wgpu";
type DemoBody = {
  min: [number, number, number];
  max: [number, number, number];
};
type DemoSnapshot = {
  bodies: DemoBody[];
};
type Statistics = {
  mean: number;
  median: number;
  p95: number;
};
type BrowserEnvironment = {
  userAgent: string;
  hardwareConcurrency: number;
  devicePixelRatio: number;
};
export type RendererProfileResult = {
  done: true;
  renderer: RendererKind;
  backend: string;
  objects: number;
  warmupFrames: number;
  measuredFrames: number;
  resolution: [number, number];
  rendererInitializationMs: number;
  navigationToReadyMs: number;
  loadedResourceBytes: number;
  jsHeapUsedBytes: number | null;
  renderCpuMs: Statistics;
  simulationTransferMs: Statistics;
  frameIntervalMs: Statistics;
  gpuRenderMs: Statistics | null;
  gpuTimingSamples: number;
  gpuTimingNote: string;
  environment: BrowserEnvironment;
  note: string;
};

declare global {
  interface Window {
    __collisionRendererProfile?: RendererProfileResult;
  }
}

type DemoWorldHandle = {
  snapshot_json(algorithm: string): string;
  step_json(algorithm: string, timestepSeconds: number): string;
  free(): void;
};

type RendererAdapter = {
  backend: string;
  render(instances: Float32Array<ArrayBuffer>): void;
  measureGpuFrame?: (instances: Float32Array<ArrayBuffer>) => Promise<number | null>;
  gpuTimingNote: string;
  dispose(): void;
};

type DisjointTimerQueryExtension = {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
};

const WIDTH = 960;
const HEIGHT = 540;
const WORLD_EXTENT = 28;
const FIXED_TIMESTEP_SECONDS = 1 / 60;
const DEFAULT_OBJECTS = 1000;
const MAX_OBJECTS = 20_000;
const DEFAULT_PROFILE_FRAMES = 180;
const WARMUP_FRAMES = 30;
const GPU_TIMING_SAMPLES = 12;
const OBJECT_TIERS = [100, 1000, 5000, 20_000] as const;

const RENDERER_LABELS: Record<RendererKind, string> = {
  three: "Three.js / WebGL2",
  "three-webgpu": "Three.js / WebGPU",
  wgpu: "Rust/WASM + wgpu",
};

export function RendererComparison() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rendererKind, setRendererKind] = useState<RendererKind>("three");
  const [objects, setObjects] = useState(DEFAULT_OBJECTS);
  const [profileFrames, setProfileFrames] = useState(DEFAULT_PROFILE_FRAMES);
  const [profileMode, setProfileMode] = useState(false);
  const [status, setStatus] = useState("Loading Rust/WASM…");
  const [profile, setProfile] = useState<RendererProfileResult | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedRenderer = parseRendererKind(params.get("renderer"));
    const requestedObjects = Number(params.get("objects"));
    const requestedFrames = Number(params.get("frames"));
    setRendererKind(requestedRenderer);
    if (Number.isFinite(requestedObjects) && requestedObjects >= 40) {
      setObjects(Math.min(MAX_OBJECTS, Math.round(requestedObjects)));
    }
    if (Number.isFinite(requestedFrames) && requestedFrames >= 30) {
      setProfileFrames(Math.min(1200, Math.round(requestedFrames)));
    }
    setProfileMode(params.get("profile") === "1");
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderCanvas: HTMLCanvasElement = canvas;

    let active = true;
    let animationFrame = 0;
    let world: DemoWorldHandle | null = null;
    let adapter: RendererAdapter | null = null;

    async function run() {
      try {
        setProfile(null);
        window.__collisionRendererProfile = undefined;
        const resourceStart = performance.now();
        setStatus(`Initializing ${RENDERER_LABELS[rendererKind]}…`);

        const collisionModule = await import("../lib/wasm-pkg/collision_wasm");
        await collisionModule.default();
        if (!active) return;

        world = new collisionModule.DemoWorld(
          "clustered",
          objects,
          4,
          1.5,
          42,
          WORLD_EXTENT,
          1.15,
          0.7,
          8,
          0,
        ) as DemoWorldHandle;
        const initialSnapshot = JSON.parse(world.snapshot_json("uniform-grid")) as DemoSnapshot;
        const packed = packInstances(initialSnapshot);

        const rendererInitializationStarted = performance.now();
        adapter = await createRenderer(rendererKind, renderCanvas, objects, profileMode);
        const rendererInitializationMs = performance.now() - rendererInitializationStarted;
        if (!active) {
          adapter.dispose();
          adapter = null;
          return;
        }
        adapter.render(packed);
        const navigationToReadyMs = performance.now();
        const loadedResourceBytes = loadedBytesSince(resourceStart);
        setStatus(profileMode ? "Profiling deterministic renderer workload…" : "Running deterministic scene");

        let frame = 0;
        let previousTimestamp: number | null = null;
        let lastInstances = packed;
        const renderCpuSamples: number[] = [];
        const simulationTransferSamples: number[] = [];
        const frameIntervalSamples: number[] = [];

        const completeProfile = async () => {
          if (!active || !adapter) return;
          const gpuSamples: number[] = [];
          if (adapter.measureGpuFrame) {
            setStatus("Collecting separate GPU timing samples…");
            for (let index = 0; index < GPU_TIMING_SAMPLES && active; index += 1) {
              const value = await adapter.measureGpuFrame(lastInstances);
              if (value !== null && Number.isFinite(value) && value >= 0) gpuSamples.push(value);
            }
          }
          if (!active) return;

          const result: RendererProfileResult = {
            done: true,
            renderer: rendererKind,
            backend: adapter.backend,
            objects,
            warmupFrames: WARMUP_FRAMES,
            measuredFrames: profileFrames,
            resolution: [WIDTH, HEIGHT],
            rendererInitializationMs,
            navigationToReadyMs,
            loadedResourceBytes,
            jsHeapUsedBytes: readJsHeapUsedBytes(),
            renderCpuMs: statistics(renderCpuSamples),
            simulationTransferMs: statistics(simulationTransferSamples),
            frameIntervalMs: statistics(frameIntervalSamples),
            gpuRenderMs: gpuSamples.length > 0 ? statistics(gpuSamples) : null,
            gpuTimingSamples: gpuSamples.length,
            gpuTimingNote: adapter.gpuTimingNote,
            environment: {
              userAgent: navigator.userAgent,
              hardwareConcurrency: navigator.hardwareConcurrency,
              devicePixelRatio: window.devicePixelRatio,
            },
            note: "CPU submission and RAF cadence are measured separately from optional GPU query samples. CI software-GPU results are regression evidence, not hardware-GPU claims.",
          };
          window.__collisionRendererProfile = result;
          setProfile(result);
          setStatus("Profile complete");
        };

        const tick = (timestamp: number) => {
          if (!active || !world || !adapter) return;

          const updateStarted = performance.now();
          const snapshot = JSON.parse(
            world.step_json("uniform-grid", FIXED_TIMESTEP_SECONDS),
          ) as DemoSnapshot;
          const instances = packInstances(snapshot);
          const updateElapsed = performance.now() - updateStarted;
          lastInstances = instances;

          const renderStarted = performance.now();
          adapter.render(instances);
          const renderElapsed = performance.now() - renderStarted;

          if (frame >= WARMUP_FRAMES) {
            simulationTransferSamples.push(updateElapsed);
            renderCpuSamples.push(renderElapsed);
            if (previousTimestamp !== null) {
              frameIntervalSamples.push(timestamp - previousTimestamp);
            }
          }
          previousTimestamp = timestamp;
          frame += 1;

          if (profileMode && frame >= WARMUP_FRAMES + profileFrames) {
            void completeProfile();
            return;
          }

          animationFrame = window.requestAnimationFrame(tick);
        };

        animationFrame = window.requestAnimationFrame(tick);
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : String(reason);
        setStatus(`Renderer failed: ${message}`);
      }
    }

    void run();

    return () => {
      active = false;
      window.cancelAnimationFrame(animationFrame);
      adapter?.dispose();
      world?.free();
    };
  }, [objects, profileFrames, profileMode, rendererKind]);

  const selectRenderer = (kind: RendererKind) => {
    updateQuery({ renderer: kind, objects });
    setRendererKind(kind);
  };

  const selectObjects = (count: number) => {
    updateQuery({ renderer: rendererKind, objects: count });
    setObjects(count);
  };

  const updateQuery = ({ renderer, objects: nextObjects }: { renderer: RendererKind; objects: number }) => {
    const params = new URLSearchParams(window.location.search);
    params.set("renderer", renderer);
    params.set("objects", String(nextObjects));
    if (profileMode) {
      params.set("profile", "1");
      params.set("frames", String(profileFrames));
    }
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  };

  return (
    <section className="overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-950">
      <div className="border-b border-zinc-800 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
              Same Rust scene · three renderer boundaries
            </p>
            <h2 className="mt-2 text-xl font-semibold text-zinc-100">Renderer comparison</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-500">
              All paths consume the same deterministic DemoWorld snapshots. The benchmark separates legacy Three.js/WebGL2, Three.js/WebGPU, and the Rust/WASM wgpu BrowserWebGPU path.
            </p>
          </div>
          <div className="flex flex-wrap gap-1 rounded-xl border border-zinc-800 bg-zinc-900 p-1">
            {(Object.keys(RENDERER_LABELS) as RendererKind[]).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => selectRenderer(kind)}
                aria-pressed={rendererKind === kind}
                className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${rendererKind === kind ? "bg-zinc-100 text-zinc-950" : "text-zinc-400 hover:text-zinc-100"}`}
              >
                {RENDERER_LABELS[kind]}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
          <span>Object tier:</span>
          {OBJECT_TIERS.map((count) => (
            <button
              key={count}
              type="button"
              onClick={() => selectObjects(count)}
              aria-pressed={objects === count}
              className={`rounded-lg border px-2.5 py-1.5 font-mono transition ${objects === count ? "border-zinc-500 bg-zinc-800 text-zinc-100" : "border-zinc-800 text-zinc-500 hover:text-zinc-200"}`}
            >
              {count.toLocaleString()}
            </button>
          ))}
        </div>
      </div>

      <div className="relative aspect-video bg-[#0c0d10]">
        <canvas
          ref={canvasRef}
          width={WIDTH}
          height={HEIGHT}
          className="h-full w-full"
          aria-label={`${RENDERER_LABELS[rendererKind]} collision renderer`}
        />
        <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg border border-zinc-800 bg-zinc-950/90 px-3 py-2 text-xs text-zinc-400 backdrop-blur">
          {rendererPath(rendererKind)}
        </div>
        <div className="pointer-events-none absolute right-3 top-3 rounded-lg border border-zinc-800 bg-zinc-950/90 px-3 py-2 text-xs text-zinc-400 backdrop-blur">
          {objects.toLocaleString()} bodies · 960×540 · {status}
        </div>
      </div>

      {profile && (
        <div className="border-t border-zinc-800 p-5" data-profile-result>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Measured browser run</p>
          <p className="mt-1 text-xs text-zinc-600">Actual backend: {profile.backend}</p>
          <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <ProfileMetric label="Render CPU median" value={`${profile.renderCpuMs.median.toFixed(3)} ms`} />
            <ProfileMetric label="Frame interval median" value={`${profile.frameIntervalMs.median.toFixed(3)} ms`} />
            <ProfileMetric label="Renderer init" value={`${profile.rendererInitializationMs.toFixed(1)} ms`} />
            <ProfileMetric
              label="GPU median"
              value={profile.gpuRenderMs ? `${profile.gpuRenderMs.median.toFixed(3)} ms` : "not available"}
            />
          </div>
          <p className="mt-3 text-xs leading-5 text-zinc-600">{profile.gpuTimingNote}</p>
          <p className="mt-1 text-xs leading-5 text-zinc-600">{profile.note}</p>
        </div>
      )}
    </section>
  );
}

async function createRenderer(
  kind: RendererKind,
  canvas: HTMLCanvasElement,
  maxInstances: number,
  profileMode: boolean,
): Promise<RendererAdapter> {
  if (kind === "three") return createThreeWebGlRenderer(canvas, maxInstances, profileMode);
  if (kind === "three-webgpu") return createThreeWebGpuRenderer(canvas, maxInstances, profileMode);
  return createWgpuRenderer(canvas, maxInstances);
}

async function createThreeWebGlRenderer(
  canvas: HTMLCanvasElement,
  maxInstances: number,
  profileMode: boolean,
): Promise<RendererAdapter> {
  const THREE = await import("three");
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0c0d10);
  const camera = new THREE.PerspectiveCamera(48, WIDTH / HEIGHT, 0.1, 500);
  camera.position.set(WORLD_EXTENT * 1.45, WORLD_EXTENT * 1.15, WORLD_EXTENT * 1.45);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(1);
  renderer.setSize(WIDTH, HEIGHT, false);

  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshBasicMaterial({ color: 0x67e8f9 });
  const mesh = new THREE.InstancedMesh(geometry, material, maxInstances);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  scene.add(mesh);

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const gl = renderer.getContext();
  const timerExtension = profileMode
    ? (gl.getExtension("EXT_disjoint_timer_query_webgl2") as DisjointTimerQueryExtension | null)
    : null;

  const updateInstances = (instances: Float32Array<ArrayBuffer>) => {
    const count = instances.length / 6;
    mesh.count = count;
    for (let index = 0; index < count; index += 1) {
      const offset = index * 6;
      position.set(instances[offset], instances[offset + 1], instances[offset + 2]);
      scale.set(instances[offset + 3], instances[offset + 4], instances[offset + 5]);
      matrix.compose(position, rotation, scale);
      mesh.setMatrixAt(index, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };

  return {
    backend: "Three.js WebGLRenderer / WebGL2",
    render(instances) {
      updateInstances(instances);
      renderer.render(scene, camera);
    },
    measureGpuFrame: timerExtension
      ? async (instances) => {
          updateInstances(instances);
          const query = gl.createQuery();
          if (!query) return null;
          gl.beginQuery(timerExtension.TIME_ELAPSED_EXT, query);
          renderer.render(scene, camera);
          gl.endQuery(timerExtension.TIME_ELAPSED_EXT);
          return waitForWebGlTimer(gl, timerExtension, query);
        }
      : undefined,
    gpuTimingNote: timerExtension
      ? "GPU samples use EXT_disjoint_timer_query_webgl2 in a separate timing phase."
      : "GPU timestamps are unavailable because EXT_disjoint_timer_query_webgl2 is not exposed by this browser/GPU.",
    dispose() {
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    },
  };
}

async function createThreeWebGpuRenderer(
  canvas: HTMLCanvasElement,
  maxInstances: number,
  profileMode: boolean,
): Promise<RendererAdapter> {
  if (!("gpu" in navigator)) throw new Error("WebGPU is not exposed by this browser");

  const THREE = await import("three/webgpu");
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0c0d10);
  const camera = new THREE.PerspectiveCamera(48, WIDTH / HEIGHT, 0.1, 500);
  camera.position.set(WORLD_EXTENT * 1.45, WORLD_EXTENT * 1.15, WORLD_EXTENT * 1.45);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();

  const renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: "high-performance",
    outputBufferType: THREE.UnsignedByteType,
    trackTimestamp: profileMode,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(WIDTH, HEIGHT, false);
  await renderer.init();

  const backend = renderer.backend as typeof renderer.backend & {
    isWebGPUBackend?: boolean;
    trackTimestamp: boolean;
    resolveTimestampsAsync(type?: string): Promise<number>;
  };
  if (backend.isWebGPUBackend !== true) {
    renderer.dispose();
    throw new Error("Three.js WebGPURenderer fell back from WebGPU; refusing to mislabel the benchmark");
  }
  const canMeasureGpu = profileMode && backend.trackTimestamp;
  backend.trackTimestamp = false;

  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshBasicMaterial({ color: 0x67e8f9 });
  const mesh = new THREE.InstancedMesh(geometry, material, maxInstances);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  scene.add(mesh);

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const updateInstances = (instances: Float32Array<ArrayBuffer>) => {
    const count = instances.length / 6;
    mesh.count = count;
    for (let index = 0; index < count; index += 1) {
      const offset = index * 6;
      position.set(instances[offset], instances[offset + 1], instances[offset + 2]);
      scale.set(instances[offset + 3], instances[offset + 4], instances[offset + 5]);
      matrix.compose(position, rotation, scale);
      mesh.setMatrixAt(index, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };

  return {
    backend: "Three.js WebGPURenderer / WebGPU",
    render(instances) {
      updateInstances(instances);
      renderer.render(scene, camera);
    },
    measureGpuFrame: canMeasureGpu
      ? async (instances) => {
          updateInstances(instances);
          backend.trackTimestamp = true;
          renderer.render(scene, camera);
          try {
            const duration = await backend.resolveTimestampsAsync("render");
            return Number.isFinite(duration) && duration >= 0 ? duration : null;
          } finally {
            backend.trackTimestamp = false;
          }
        }
      : undefined,
    gpuTimingNote: canMeasureGpu
      ? "GPU samples use Three.js WebGPU backend timestamp queries in a separate timing phase."
      : "GPU timestamps are unavailable because the active WebGPU backend does not expose timestamp queries.",
    dispose() {
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    },
  };
}

async function createWgpuRenderer(
  canvas: HTMLCanvasElement,
  maxInstances: number,
): Promise<RendererAdapter> {
  if (!("gpu" in navigator)) {
    throw new Error("WebGPU is not exposed by this browser");
  }
  const wgpuModule = await import("../lib/wgpu-wasm-pkg/collision_wgpu_wasm");
  await wgpuModule.default();
  const renderer = await wgpuModule.create_renderer(canvas, WIDTH, HEIGHT, maxInstances);
  return {
    backend: "Rust/WASM wgpu / BrowserWebGPU",
    render(instances) {
      renderer.render(instances);
    },
    gpuTimingNote: "GPU timestamps are not yet exposed across the Rust/WASM wgpu boundary; CPU/RAF metrics remain authoritative for this path in this slice.",
    dispose() {
      renderer.free();
    },
  };
}

async function waitForWebGlTimer(
  gl: WebGL2RenderingContext,
  extension: DisjointTimerQueryExtension,
  query: WebGLQuery,
): Promise<number | null> {
  const deadline = performance.now() + 3000;
  while (performance.now() < deadline) {
    const available = gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE) as boolean;
    const disjoint = gl.getParameter(extension.GPU_DISJOINT_EXT) as boolean;
    if (available) {
      const elapsedNanoseconds = gl.getQueryParameter(query, gl.QUERY_RESULT) as number;
      gl.deleteQuery(query);
      return disjoint ? null : elapsedNanoseconds / 1_000_000;
    }
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  }
  gl.deleteQuery(query);
  return null;
}

function parseRendererKind(value: string | null): RendererKind {
  if (value === "three-webgpu" || value === "wgpu") return value;
  return "three";
}

function rendererPath(kind: RendererKind): string {
  if (kind === "three-webgpu") return "Rust → WASM snapshot → Three.js/WebGPU";
  if (kind === "wgpu") return "Rust → WASM snapshot → Rust/WASM wgpu → WebGPU";
  return "Rust → WASM snapshot → Three.js/WebGL2";
}

function loadedBytesSince(startTime: number): number {
  return performance
    .getEntriesByType("resource")
    .filter((entry): entry is PerformanceResourceTiming => entry instanceof PerformanceResourceTiming)
    .filter((entry) => entry.startTime >= startTime)
    .reduce((total, entry) => total + Math.max(entry.encodedBodySize, entry.transferSize, 0), 0);
}

function readJsHeapUsedBytes(): number | null {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory;
  return typeof memory?.usedJSHeapSize === "number" ? memory.usedJSHeapSize : null;
}

function packInstances(snapshot: DemoSnapshot): Float32Array<ArrayBuffer> {
  const packed = new Float32Array(snapshot.bodies.length * 6);
  snapshot.bodies.forEach((body, index) => {
    const offset = index * 6;
    packed[offset] = (body.min[0] + body.max[0]) * 0.5;
    packed[offset + 1] = (body.min[1] + body.max[1]) * 0.5;
    packed[offset + 2] = (body.min[2] + body.max[2]) * 0.5;
    packed[offset + 3] = body.max[0] - body.min[0];
    packed[offset + 4] = body.max[1] - body.min[1];
    packed[offset + 5] = body.max[2] - body.min[2];
  });
  return packed;
}

function statistics(samples: number[]): Statistics {
  if (samples.length === 0) return { mean: 0, median: 0, p95: 0 };
  const sorted = [...samples].sort((left, right) => left - right);
  const mean = samples.reduce((sum, sample) => sum + sample, 0) / samples.length;
  const percentile = (fraction: number) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
  return {
    mean,
    median: percentile(0.5),
    p95: percentile(0.95),
  };
}

function ProfileMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-1 font-mono text-zinc-200">{value}</dd>
    </div>
  );
}
