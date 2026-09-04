"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

import initCharacterWasm, {
  HumanoidAnimator,
} from "../lib/zombie-arena-character-wasm-pkg/zombie_arena_character_wasm";

type Vec3 = [number, number, number];
type Quat = [number, number, number, number];
type NodeSpec = {
  name: string;
  parent: number | null;
  translation: Vec3;
  rotation: Quat;
  scale: Vec3;
  part: {
    size: Vec3;
    offset: Vec3;
  };
};
type ModelSnapshot = {
  source: {
    geometry: string;
    animation: string;
    revision: string;
  };
  mesh: {
    vertices: Vec3[];
    indices: number[];
    vertexCount: number;
    triangleCount: number;
  };
  nodes: NodeSpec[];
  clips: {
    name: ClipName;
    duration: number;
    loops: boolean;
  }[];
};
type PoseSnapshot = {
  clip: ClipName;
  time: number;
  duration: number;
  nodes: {
    translation: Vec3;
    rotation: Quat;
    scale: Vec3;
  }[];
};
type ClipName = "idle" | "walk" | "attack" | "death";
type CharacterRuntime = {
  root: THREE.Group;
  joints: THREE.Group[];
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
};

const CLIPS: readonly [ClipName, string][] = [
  ["idle", "Idle"],
  ["walk", "Walk"],
  ["attack", "Attack"],
  ["death", "Death"],
];

export function ZombieArenaCharacterLab() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const animatorRef = useRef<HumanoidAnimator | null>(null);
  const clipRef = useRef<ClipName>("walk");
  const clipStartedRef = useRef(0);
  const [clip, setClip] = useState<ClipName>("walk");
  const [model, setModel] = useState<ModelSnapshot | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    clipRef.current = clip;
    clipStartedRef.current = performance.now();
  }, [clip]);

  useEffect(() => {
    let cancelled = false;
    void initCharacterWasm()
      .then(() => {
        if (cancelled) return;
        const animator = new HumanoidAnimator();
        animatorRef.current = animator;
        setModel(JSON.parse(animator.model_json()) as ModelSnapshot);
        clipStartedRef.current = performance.now();
        setReady(true);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(String(reason));
      });

    return () => {
      cancelled = true;
      animatorRef.current?.free();
      animatorRef.current = null;
    };
  }, []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !ready || !model) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x09090b);

    const width = Math.max(mount.clientWidth, 320);
    const height = Math.max(mount.clientHeight, 420);
    const camera = new THREE.PerspectiveCamera(46, width / height, 0.1, 50);
    camera.position.set(4.2, 3.1, 6.8);
    camera.lookAt(0, 0.8, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.replaceChildren(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xdbeafe, 0x18181b, 1.8));
    const key = new THREE.DirectionalLight(0xffffff, 2.8);
    key.position.set(-4, 7, 5);
    key.castShadow = true;
    scene.add(key);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 6),
      new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const grid = new THREE.GridHelper(8, 16, 0x3f3f46, 0x27272a);
    grid.position.y = 0.01;
    scene.add(grid);

    const player = buildCharacter(
      model,
      new THREE.MeshStandardMaterial({ color: 0x0891b2, roughness: 0.72 }),
    );
    player.root.position.set(-1.35, 1.55, 0);
    scene.add(player.root);

    const zombie = buildCharacter(
      model,
      new THREE.MeshStandardMaterial({ color: 0x65a30d, roughness: 0.9 }),
    );
    zombie.root.position.set(1.35, 1.55, 0);
    zombie.root.scale.setScalar(0.96);
    scene.add(zombie.root);

    const resizeObserver = new ResizeObserver(() => {
      const nextWidth = Math.max(mount.clientWidth, 320);
      const nextHeight = Math.max(mount.clientHeight, 420);
      renderer.setSize(nextWidth, nextHeight);
      camera.aspect = nextWidth / nextHeight;
      camera.updateProjectionMatrix();
    });
    resizeObserver.observe(mount);

    let frameHandle = 0;
    const render = (now: number) => {
      const animator = animatorRef.current;
      if (animator) {
        const seconds = Math.max(0, now - clipStartedRef.current) / 1000;
        const pose = JSON.parse(
          animator.sample_pose_json(clipRef.current, seconds),
        ) as PoseSnapshot;
        applyPose(player, pose);
        applyPose(zombie, pose);
      }
      renderer.render(scene, camera);
      frameHandle = requestAnimationFrame(render);
    };
    frameHandle = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(frameHandle);
      resizeObserver.disconnect();
      scene.remove(player.root, zombie.root);
      disposeCharacter(player);
      disposeCharacter(zombie);
      floor.geometry.dispose();
      (floor.material as THREE.Material).dispose();
      renderer.dispose();
      mount.replaceChildren();
    };
  }, [model, ready]);

  if (error) {
    return (
      <section className="mt-8 rounded-3xl border border-red-900/60 bg-red-950/25 p-6 text-sm text-red-300">
        The 3d-lab humanoid preview could not start: {error}
      </section>
    );
  }

  return (
    <section className="mt-8 overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-950">
      <div className="border-b border-zinc-800 p-5 sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-600">
          3d-lab dogfood · procedural humanoid rig
        </p>
        <h2 className="mt-2 text-2xl font-semibold text-zinc-100">
          One renderer-independent model, two game character variants.
        </h2>
        <p className="mt-3 max-w-4xl text-sm leading-6 text-zinc-500">
          Player and zombie use the same 11-node articulated humanoid. The cube mesh comes from
          <code className="mx-1 text-zinc-300">three-d-core</code>, while hierarchy transforms,
          quaternion interpolation, keyframes, and animation clips are sampled by
          <code className="mx-1 text-zinc-300">three-d-animation</code> in Rust/WASM. Three.js only
          turns that model and pose data into visible objects.
        </p>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="p-4 sm:p-6">
          <div
            ref={mountRef}
            className="min-h-[28rem] overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950"
            aria-label="Player and zombie sharing the same procedural humanoid rig"
          />
          <div className="mt-4 flex flex-wrap gap-2">
            {CLIPS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setClip(value)}
                className={`rounded-xl border px-4 py-2 text-sm font-semibold transition ${
                  clip === value
                    ? "border-cyan-600/70 bg-cyan-950/35 text-cyan-200"
                    : "border-zinc-700 text-zinc-300 hover:border-zinc-500"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <aside className="border-t border-zinc-800 p-5 lg:border-l lg:border-t-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-600">
            Shared model
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Readout label="joints" value={model?.nodes.length ?? "…"} />
            <Readout label="mesh vertices" value={model?.mesh.vertexCount ?? "…"} />
            <Readout label="triangles" value={model?.mesh.triangleCount ?? "…"} />
            <Readout label="clips" value={model?.clips.length ?? "…"} />
          </div>

          <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900/35 p-4 text-xs leading-5 text-zinc-500">
            <p className="font-semibold text-zinc-300">Current clip: {clip}</p>
            <p className="mt-2">
              Idle, walk, and attack loop. Death is a one-shot clip that clamps at its final pose.
              Both characters receive the exact same Rust-sampled local joint transforms.
            </p>
          </div>

          <div className="mt-5 space-y-2 text-xs text-zinc-600">
            <div className="flex justify-between gap-3">
              <span>geometry owner</span>
              <code className="text-zinc-300">three-d-core</code>
            </div>
            <div className="flex justify-between gap-3">
              <span>animation owner</span>
              <code className="text-zinc-300">three-d-animation</code>
            </div>
            <div className="flex justify-between gap-3">
              <span>renderer</span>
              <code className="text-zinc-300">Three.js</code>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}

function buildCharacter(model: ModelSnapshot, material: THREE.Material): CharacterRuntime {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(model.mesh.vertices.flat(), 3),
  );
  geometry.setIndex(model.mesh.indices);
  geometry.computeVertexNormals();

  const root = new THREE.Group();
  const joints = model.nodes.map(() => new THREE.Group());
  model.nodes.forEach((node, index) => {
    const joint = joints[index];
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...node.part.offset);
    mesh.scale.set(...node.part.size);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    joint.add(mesh);

    if (node.parent === null) root.add(joint);
    else joints[node.parent]?.add(joint);
  });

  return { root, joints, geometry, material };
}

function applyPose(character: CharacterRuntime, pose: PoseSnapshot) {
  pose.nodes.forEach((node, index) => {
    const joint = character.joints[index];
    if (!joint) return;
    joint.position.set(...node.translation);
    joint.quaternion.set(...node.rotation);
    joint.scale.set(...node.scale);
  });
}

function disposeCharacter(character: CharacterRuntime) {
  character.geometry.dispose();
  character.material.dispose();
}

function Readout({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/35 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.13em] text-zinc-600">
        {label}
      </div>
      <div className="mt-1 font-mono text-sm text-zinc-200">{value}</div>
    </div>
  );
}
