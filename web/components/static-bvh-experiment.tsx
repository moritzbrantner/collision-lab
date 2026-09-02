"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import initWasm, { DemoWorld } from "../lib/wasm-pkg/collision_wasm";

type Pair = [number, number];
type Bounds = { min: [number, number, number]; max: [number, number, number] };
type Body = Bounds & { id: number };
type Snapshot = { bodies: Body[]; pairs: Pair[] };
type BvhNode = {
  index: number;
  bounds: Bounds;
  depth: number;
  body: number | null;
  left: number | null;
  right: number | null;
  leafCount: number;
  isRoot: boolean;
};
type BvhStep = {
  left: number;
  right: number;
  kind: "descend" | "pruned" | "leaf-test";
  potentialPairs: number;
  pair: Pair | null;
  overlap: boolean;
};
type BvhTrace = {
  kind: "static-bvh";
  aabbTests: number;
  nodePairVisits: number;
  prunedPotentialPairs: number;
  representedPairs: number;
  nodes: BvhNode[];
  steps: BvhStep[];
};
type RenderResources = {
  scene: THREE.Scene;
  helperGroup: THREE.Group;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  stepHelpers: THREE.Box3Helper[];
  resizeObserver: ResizeObserver;
  animationFrame: number;
};

const OBJECTS = 48;
const WORLD_EXTENT = 24;
const HALF_EXTENT = 1.1;
const SEED = 1207;

export function StaticBvhExperiment() {
  const mountRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<DemoWorld | null>(null);
  const renderRef = useRef<RenderResources | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [trace, setTrace] = useState<BvhTrace | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [showHierarchy, setShowHierarchy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void initWasm()
      .then(() => {
        if (!active) return;
        const world = new DemoWorld(
          "uniform",
          OBJECTS,
          4,
          1,
          SEED,
          WORLD_EXTENT,
          HALF_EXTENT,
          0,
          0,
          0,
        );
        world.set_layer_interaction(1, 1, true);
        worldRef.current = world;
        setSnapshot(JSON.parse(world.snapshot_json("static-bvh")) as Snapshot);
        setTrace(JSON.parse(world.trace_json("static-bvh")) as BvhTrace);
      })
      .catch((reason: unknown) => setError(String(reason)));

    return () => {
      active = false;
      worldRef.current?.free();
      worldRef.current = null;
    };
  }, []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !snapshot) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0c0d10);
    const width = Math.max(mount.clientWidth, 320);
    const height = Math.max(mount.clientHeight, 460);
    const camera = new THREE.PerspectiveCamera(48, width / height, 0.1, 400);
    camera.position.set(40, 32, 40);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    mount.replaceChildren(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 0, 0);

    const helperGroup = new THREE.Group();
    scene.add(helperGroup);
    helperGroup.add(boundsHelper({ min: [-WORLD_EXTENT, -WORLD_EXTENT, -WORLD_EXTENT], max: [WORLD_EXTENT, WORLD_EXTENT, WORLD_EXTENT] }, 0x52525b));
    scene.add(new THREE.AxesHelper(7));

    const bodyMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0xe4e4e7, wireframe: true, transparent: true, opacity: 0.8 }),
      snapshot.bodies.length,
    );
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    snapshot.bodies.forEach((body, index) => {
      applyBounds(body, matrix, position, scale, quaternion);
      bodyMesh.setMatrixAt(index, matrix);
    });
    bodyMesh.instanceMatrix.needsUpdate = true;
    scene.add(bodyMesh);

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
      const nextHeight = Math.max(mount.clientHeight, 460);
      renderer.setSize(nextWidth, nextHeight);
      camera.aspect = nextWidth / nextHeight;
      camera.updateProjectionMatrix();
    });
    resizeObserver.observe(mount);

    renderRef.current = {
      scene,
      helperGroup,
      renderer,
      camera,
      controls,
      stepHelpers: [],
      resizeObserver,
      animationFrame,
    };

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      controls.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
          object.geometry.dispose();
          const material = object.material;
          if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
          else material.dispose();
        }
      });
      renderer.dispose();
      renderRef.current = null;
      mount.replaceChildren();
    };
  }, [snapshot]);

  const current = useMemo(() => {
    if (!trace?.steps.length) return null;
    return trace.steps[Math.min(stepIndex, trace.steps.length - 1)];
  }, [stepIndex, trace]);

  useEffect(() => {
    const resources = renderRef.current;
    if (!resources || !trace || !current) return;

    resources.stepHelpers.forEach((helper) => disposeHelper(resources.helperGroup, helper));
    resources.stepHelpers = [];
    resources.helperGroup.visible = showHierarchy;
    if (!showHierarchy) return;

    const left = trace.nodes[current.left];
    const right = trace.nodes[current.right];
    const [leftColor, rightColor] = stepColors(current);
    const leftHelper = boundsHelper(left.bounds, leftColor);
    const rightHelper = boundsHelper(right.bounds, rightColor);
    resources.helperGroup.add(leftHelper, rightHelper);
    resources.stepHelpers.push(leftHelper, rightHelper);
  }, [current, showHierarchy, trace]);

  if (error) {
    return <div className="rounded-2xl border border-red-900/60 bg-red-950/30 p-6 text-sm text-red-300">{error}</div>;
  }
  if (!snapshot || !trace || !current) {
    return <div className="grid min-h-[30rem] place-items-center rounded-3xl border border-zinc-800 bg-zinc-950 text-sm text-zinc-500">Loading static BVH experiment…</div>;
  }

  const leftNode = trace.nodes[current.left];
  const rightNode = trace.nodes[current.right];
  const maxStep = Math.max(0, trace.steps.length - 1);

  return (
    <section className="overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-950">
      <div className="grid lg:grid-cols-[20rem_minmax(0,1fr)]">
        <aside className="border-b border-zinc-800 p-5 lg:border-b-0 lg:border-r">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-600">Focused experiment · Static BVH</p>
          <h2 className="mt-2 text-xl font-semibold text-zinc-100">Traverse the real hierarchy.</h2>
          <p className="mt-3 text-sm leading-6 text-zinc-500">
            The white wireframes are scene objects. The two colored helper boxes are the exact BVH nodes Rust is comparing at this traversal step.
          </p>

          <label className="mt-5 flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-sm text-zinc-300">
            <input type="checkbox" checked={showHierarchy} onChange={(event) => setShowHierarchy(event.target.checked)} className="h-4 w-4 accent-zinc-100" />
            Show current node bounds
          </label>

          <div className="mt-5 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-zinc-600">Decision</span>
              <span className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${decisionClass(current.kind)}`}>{current.kind}</span>
            </div>
            <p className="mt-3 text-sm leading-6 text-zinc-300">{decisionText(current, leftNode, rightNode)}</p>
          </div>

          <input type="range" min={0} max={maxStep} value={Math.min(stepIndex, maxStep)} onChange={(event) => setStepIndex(Number(event.target.value))} className="mt-5 w-full accent-zinc-100" />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button type="button" disabled={stepIndex === 0} onClick={() => setStepIndex((value) => Math.max(0, value - 1))} className="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-300 disabled:opacity-30">← Previous</button>
            <button type="button" disabled={stepIndex >= maxStep} onClick={() => setStepIndex((value) => Math.min(maxStep, value + 1))} className="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-300 disabled:opacity-30">Next →</button>
          </div>
          <div className="mt-2 text-center font-mono text-xs text-zinc-600">{stepIndex + 1} / {trace.steps.length}</div>

          <dl className="mt-5 grid grid-cols-2 gap-2">
            <Metric label="Exact tests" value={trace.aabbTests} />
            <Metric label="Node visits" value={trace.nodePairVisits} />
            <Metric label="Pairs pruned" value={trace.prunedPotentialPairs} />
            <Metric label="This step" value={current.potentialPairs} />
          </dl>
        </aside>

        <div className="relative min-h-[36rem]">
          <div ref={mountRef} className="absolute inset-0" />
          <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg bg-zinc-950/85 px-3 py-2 text-xs text-zinc-500 backdrop-blur">
            Drag to orbit · scroll to zoom · orange/red means subtree prune
          </div>
        </div>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
      <dt className="text-[10px] uppercase tracking-wide text-zinc-600">{label}</dt>
      <dd className="mt-1 font-mono text-sm text-zinc-200">{value.toLocaleString()}</dd>
    </div>
  );
}

function decisionText(step: BvhStep, left: BvhNode, right: BvhNode) {
  if (step.kind === "pruned") {
    return `These parent bounds are separate, so ${step.potentialPairs.toLocaleString()} leaf pair${step.potentialPairs === 1 ? "" : "s"} vanish immediately (${left.leafCount} × ${right.leafCount}).`;
  }
  if (step.kind === "leaf-test") {
    return step.overlap ? "Both nodes are leaves and their exact AABBs overlap." : "Both nodes are leaves; the exact AABB test rejects the pair.";
  }
  return `The parent bounds overlap, so Rust descends. This node pair still represents ${step.potentialPairs.toLocaleString()} possible leaf pairs.`;
}

function decisionClass(kind: BvhStep["kind"]) {
  if (kind === "pruned") return "border-orange-700/60 bg-orange-950/40 text-orange-300";
  if (kind === "leaf-test") return "border-yellow-700/60 bg-yellow-950/30 text-yellow-300";
  return "border-cyan-800/60 bg-cyan-950/30 text-cyan-300";
}

function stepColors(step: BvhStep): [number, number] {
  if (step.kind === "pruned") return [0xfb923c, 0xef4444];
  if (step.kind === "leaf-test") return step.overlap ? [0xfb7185, 0xfb7185] : [0xfacc15, 0xfacc15];
  return [0x22d3ee, 0xc084fc];
}

function boundsHelper(bounds: Bounds, color: number) {
  return new THREE.Box3Helper(
    new THREE.Box3(
      new THREE.Vector3(bounds.min[0], bounds.min[1], bounds.min[2]),
      new THREE.Vector3(bounds.max[0], bounds.max[1], bounds.max[2]),
    ),
    color,
  );
}

function applyBounds(
  bounds: Bounds,
  matrix: THREE.Matrix4,
  position: THREE.Vector3,
  scale: THREE.Vector3,
  quaternion: THREE.Quaternion,
) {
  position.set(
    (bounds.min[0] + bounds.max[0]) * 0.5,
    (bounds.min[1] + bounds.max[1]) * 0.5,
    (bounds.min[2] + bounds.max[2]) * 0.5,
  );
  scale.set(
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2],
  );
  matrix.compose(position, quaternion, scale);
}

function disposeHelper(parent: THREE.Object3D, helper: THREE.Box3Helper) {
  parent.remove(helper);
  helper.geometry.dispose();
  const material = helper.material;
  if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
  else material.dispose();
}
