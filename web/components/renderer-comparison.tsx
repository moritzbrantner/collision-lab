"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

import initCollisionWasm, { DemoWorld } from "../lib/wasm-pkg/collision_wasm";
import initWgpuWasm, {
  create_renderer,
  type WgpuRenderer,
} from "../lib/wgpu-wasm-pkg/collision_wgpu_wasm";

type RendererKind = "three" | "wgpu";
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
export type RendererProfileResult = {
  done: true;
  renderer: RendererKind;
  objects: number;
  warmupFrames: number;
  measuredFrames: number;
  resolution: [number, number];
  renderCpuMs: Statistics;
  simulationTransferMs: Statistics;
  frameIntervalMs: Statistics;
  note: string;
};

declare global {
  interface Window {
    __collisionRendererProfile?: RendererProfileResult;
  }
}

type RendererAdapter = {
  render(instances: Float32Array<ArrayBuffer>): void;
  dispose(): void;
};

const WIDTH = 960;
const HEIGHT = 540;
const WORLD_EXTENT = 28;
const FIXED_TIMESTEP_SECONDS = 1 / 60;
const DEFAULT_OBJECTS = 1000;
const DEFAULT_PROFILE_FRAMES = 180;
const WARMUP_FRAMES = 30;

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
    const requestedRenderer = params.get("renderer");
    const requestedObjects = Number(params.get("objects"));
    const requestedFrames = Number(params.get("frames"));
    setRendererKind(requestedRenderer === "wgpu" ? "wgpu" : "three");
    if (Number.isFinite(requestedObjects) && requestedObjects >= 40) {
      setObjects(Math.min(5000, Math.round(requestedObjects)));
    }
    if (Number.isFinite(requestedFrames) && requestedFrames >= 30) {
      setProfileFrames(Math.min(1200, Math.round(requestedFrames)));
    }
    setProfileMode(params.get("profile") === "1");
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let active = true;
    let animationFrame = 0;
    let world: DemoWorld | null = null;
    let adapter: RendererAdapter | null = null;

    async function run() {
      try {
        setProfile(null);
        window.__collisionRendererProfile = undefined;
        setStatus(`Initializing ${rendererKind === "three" ? "Three.js/WebGL" : "Rust/WASM/wgpu"}…`);
        await initCollisionWasm();
        if (!active) return;

        world = new DemoWorld(
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
        );
        const initialSnapshot = JSON.parse(world.snapshot_json("uniform-grid")) as DemoSnapshot;
        const packed = packInstances(initialSnapshot);

        adapter = rendererKind === "three"
          ? createThreeRenderer(canvas, objects)
          : await createWgpuRenderer(canvas, objects);
        if (!active) {
          adapter.dispose();
          adapter = null;
          return;
        }
        adapter.render(packed);
        setStatus(profileMode ? "Profiling deterministic renderer workload…" : "Running deterministic scene");

        let frame = 0;
        let previousTimestamp: number | null = null;
        const renderCpuSamples: number[] = [];
        const simulationTransferSamples: number[] = [];
        const frameIntervalSamples: number[] = [];

        const tick = (timestamp: number) => {
          if (!active || !world || !adapter) return;

          const updateStarted = performance.now();
          const snapshot = JSON.parse(
            world.step_json("uniform-grid", FIXED_TIMESTEP_SECONDS),
          ) as DemoSnapshot;
          const instances = packInstances(snapshot);
          const updateElapsed = performance.now() - updateStarted;

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
            const result: RendererProfileResult = {
              done: true,
              renderer: rendererKind,
              objects,
              warmupFrames: WARMUP_FRAMES,
              measuredFrames: profileFrames,
              resolution: [WIDTH, HEIGHT],
              renderCpuMs: statistics(renderCpuSamples),
              simulationTransferMs: statistics(simulationTransferSamples),
              frameIntervalMs: statistics(frameIntervalSamples),
              note: "CPU-side submission and requestAnimationFrame cadence; no GPU timestamp query is claimed.",
            };
            window.__collisionRendererProfile = result;
            setProfile(result);
            setStatus("Profile complete");
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
    const params = new URLSearchParams(window.location.search);
    params.set("renderer", kind);
    params.set("objects", String(objects));
    if (profileMode) {
      params.set("profile", "1");
      params.set("frames", String(profileFrames));
    }
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
    setRendererKind(kind);
  };

  return (
    <section className="overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-950">
      <div className="border-b border-zinc-800 p-5 sm:flex sm:items-center sm:justify-between sm:gap-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
            Same Rust scene · different renderer boundary
          </p>
          <h2 className="mt-2 text-xl font-semibold text-zinc-100">Renderer A/B canary</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-500">
            Both variants consume the same deterministic DemoWorld snapshots. Three.js owns one WebGL renderer; the second path crosses into a Rust crate compiled to WASM and renders through wgpu&apos;s BrowserWebGPU backend.
          </p>
        </div>
        <div className="mt-4 flex shrink-0 rounded-xl border border-zinc-800 bg-zinc-900 p-1 sm:mt-0">
          <button
            type="button"
            onClick={() => selectRenderer("three")}
            aria-pressed={rendererKind === "three"}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${rendererKind === "three" ? "bg-zinc-100 text-zinc-950" : "text-zinc-400 hover:text-zinc-100"}`}
          >
            Three.js
          </button>
          <button
            type="button"
            onClick={() => selectRenderer("wgpu")}
            aria-pressed={rendererKind === "wgpu"}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${rendererKind === "wgpu" ? "bg-zinc-100 text-zinc-950" : "text-zinc-400 hover:text-zinc-100"}`}
          >
            WASM + wgpu
          </button>
        </div>
      </div>

      <div className="relative aspect-video bg-[#0c0d10]">
        <canvas
          ref={canvasRef}
          width={WIDTH}
          height={HEIGHT}
          className="h-full w-full"
          aria-label={`${rendererKind === "three" ? "Three.js" : "Rust WASM wgpu"} collision renderer`}
        />
        <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg border border-zinc-800 bg-zinc-950/90 px-3 py-2 text-xs text-zinc-400 backdrop-blur">
          {rendererKind === "three" ? "Rust → WASM snapshot → Three.js/WebGL" : "Rust → WASM snapshot → Rust/WASM wgpu → WebGPU"}
        </div>
        <div className="pointer-events-none absolute right-3 top-3 rounded-lg border border-zinc-800 bg-zinc-950/90 px-3 py-2 text-xs text-zinc-400 backdrop-blur">
          {objects.toLocaleString()} bodies · 960×540 · {status}
        </div>
      </div>

      {profile && (
        <div className="border-t border-zinc-800 p-5" data-profile-result>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Measured browser run</p>
          <div className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
            <ProfileMetric label="Render CPU median" value={`${profile.renderCpuMs.median.toFixed(3)} ms`} />
            <ProfileMetric label="Render CPU p95" value={`${profile.renderCpuMs.p95.toFixed(3)} ms`} />
            <ProfileMetric label="Frame interval median" value={`${profile.frameIntervalMs.median.toFixed(3)} ms`} />
          </div>
          <p className="mt-3 text-xs leading-5 text-zinc-600">{profile.note}</p>
        </div>
      )}
    </section>
  );
}

function createThreeRenderer(canvas: HTMLCanvasElement, maxInstances: number): RendererAdapter {
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

  return {
    render(instances) {
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
      renderer.render(scene, camera);
    },
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
  await initWgpuWasm();
  const renderer = await create_renderer(canvas, WIDTH, HEIGHT, maxInstances);
  return {
    render(instances) {
      renderer.render(instances);
    },
    dispose() {
      freeWgpuRenderer(renderer);
    },
  };
}

function freeWgpuRenderer(renderer: WgpuRenderer) {
  renderer.free();
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
