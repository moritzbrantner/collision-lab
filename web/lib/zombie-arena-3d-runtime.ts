import initZombie3dWasm from "./zombie-arena-3d-wasm-pkg/zombie_arena_3d_wasm";

type ZombieArena3dWasm = Awaited<ReturnType<typeof initZombie3dWasm>>;

let initialization: Promise<ZombieArena3dWasm> | null = null;

export function ensureZombieArena3dWasm(): Promise<ZombieArena3dWasm> {
  if (!initialization) {
    initialization = initZombie3dWasm().catch((reason: unknown) => {
      initialization = null;
      throw reason;
    });
  }
  return initialization;
}
