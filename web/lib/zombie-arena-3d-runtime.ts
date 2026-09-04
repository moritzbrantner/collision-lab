import initZombie3dWasm, {
  ZombieArena3dWorld,
} from "./zombie-arena-3d-wasm-pkg/zombie_arena_3d_wasm";

type ZombieArena3dWasm = Awaited<ReturnType<typeof initZombie3dWasm>>;
type SnapshotMethodName =
  | "snapshot_json"
  | "step_json"
  | "set_algorithm"
  | "build_json"
  | "remove_barricade_json";
type SnapshotMethod = (this: ZombieArena3dWorld, ...args: unknown[]) => string;
type InstrumentedPrototype = Record<SnapshotMethodName, SnapshotMethod> & Record<symbol, unknown>;

export const ZOMBIE_ARENA_3D_SNAPSHOT_EVENT = "zombie-arena-3d-snapshot";
export const ZOMBIE_ARENA_3D_LABEL = "Third-person 3D Zombie Arena";

const SNAPSHOT_METHODS: SnapshotMethodName[] = [
  "snapshot_json",
  "step_json",
  "set_algorithm",
  "build_json",
  "remove_barricade_json",
];
const DIAGNOSTICS_BRIDGE_FLAG = Symbol.for("collision-lab.zombie-arena-3d-diagnostics");
const MIN_DIAGNOSTICS_PUBLISH_INTERVAL_MS = 100;

let initialization: Promise<ZombieArena3dWasm> | null = null;
let lastDiagnosticsPublishAt = 0;

export function ensureZombieArena3dWasm(): Promise<ZombieArena3dWasm> {
  if (!initialization) {
    initialization = initZombie3dWasm().catch((reason: unknown) => {
      initialization = null;
      throw reason;
    });
  }

  return initialization.then((wasm) => {
    installDiagnosticsBridge();
    return wasm;
  });
}

function installDiagnosticsBridge() {
  if (typeof window === "undefined") return;

  const prototype = ZombieArena3dWorld.prototype as unknown as InstrumentedPrototype;
  if (prototype[DIAGNOSTICS_BRIDGE_FLAG]) return;

  for (const methodName of SNAPSHOT_METHODS) {
    const original = prototype[methodName];
    prototype[methodName] = function instrumentedSnapshotMethod(
      this: ZombieArena3dWorld,
      ...args: unknown[]
    ) {
      const raw = original.apply(this, args);
      publishGameplaySnapshot(raw);
      return raw;
    };
  }

  prototype[DIAGNOSTICS_BRIDGE_FLAG] = true;
}

function publishGameplaySnapshot(raw: string) {
  const captured = document.pointerLockElement;
  if (!(captured instanceof HTMLElement)) return;
  if (captured.getAttribute("aria-label") !== ZOMBIE_ARENA_3D_LABEL) return;

  const now = performance.now();
  if (now - lastDiagnosticsPublishAt < MIN_DIAGNOSTICS_PUBLISH_INTERVAL_MS) return;
  lastDiagnosticsPublishAt = now;

  window.dispatchEvent(
    new CustomEvent<string>(ZOMBIE_ARENA_3D_SNAPSHOT_EVENT, {
      detail: raw,
    }),
  );
}
