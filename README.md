# collision-lab

A deterministic Rust playground for learning, comparing, and visualizing collision-detection and spatial-indexing techniques.

**Website:** https://moritzbrantner.github.io/collision-lab/

**Roadmap:** [ROADMAP.md](ROADMAP.md)

The lab is intentionally separate from [`rust-kernels`](https://github.com/moritzbrantner/rust-kernels): reusable algorithms live there; scenarios, instrumentation, semantic interaction policy, comparisons, and visualization live here.

## Four modes

### Explanation mode

`/explain/` is the teaching surface. It uses small deterministic scenes, 2D diagrams, and projected 3D geometry to walk through real Rust algorithm decisions one step at a time. It now covers broad-phase pruning from naive all-pairs through grids, sweep-and-prune, BVHs, dynamic AABB trees, and octrees, followed by narrow-phase analytical primitives and 2D/3D OBB SAT.

The web layer does not reimplement collision decisions. It obtains overlap results, execution traces, axes, projections, and work counters from Rust/WASM, then projects that state into SVG.

### Experiment mode

`/demo/` is the full Rust/WASM/Three.js laboratory. It supports deterministic moving scenes, static and dynamic bodies, solid and sensor interactions, a live world-level interaction matrix, broad-phase metrics, and paused execution traces.

### Analysis mode

`/analysis/` compares deterministic algorithmic work across scene sizes and distributions using Rust/WASM counters rather than browser rendering time.

### Compute mode

`/compute/` separates algorithmic pruning from execution hardware by comparing equivalent Rust/WASM and WebGPU workloads with exact pair-set parity.

Explanation teaches **why** an algorithm works. Experiment explores **when** it works well. Analysis measures **how much work** it performs. Compute asks **where that work should execute**.

## Current broad phases

- **naive** — checks every unique object pair and serves as the correctness oracle
- **uniform grid** — partitions 3D space into sparse cells and only AABB-tests objects that share at least one cell
- **sweep-and-prune** — sorts intervals and tests only the active set
- **static BVH** — hierarchically rejects groups of bounds
- **dynamic AABB tree** — retains a balanced hierarchy across moving frames using fat AABBs
- **octree** — recursively subdivides crowded 3D regions into eight children

All optimized broad phases are differential-tested against the naive reference and must return the exact same deterministic set of overlapping AABB pairs.

## Current narrow phases

- **sphere ↔ sphere** — exact squared-center-distance test
- **AABB ↔ AABB** — exact interval overlap on all three world axes
- **2D OBB SAT** — four local face axes with explicit 1D projection evidence
- **3D OBB SAT** — six face axes plus nine edge-cross axes, including explicit handling of degenerate parallel cross products

Reusable geometry mechanisms live in `rust-kernels::geometry-kernels`; Collision Lab owns the teaching scenes and visual evidence.

## Website development

The `web/` application is a statically exported Next.js site for GitHub Pages.

Run it locally with Bun:

```bash
cd web
bun install
bun run wasm
bun run dev
```

## Run the 10,000-object experiment

```bash
cargo run --release -- --objects 10000 --cell-size 2.5 --scenario uniform --seed 42
```

Try a deliberately harder distribution:

```bash
cargo run --release -- --objects 10000 --cell-size 2.5 --scenario clustered --seed 42
```

Explore grid-size sensitivity:

```bash
for size in 0.5 1 2 5 10 25; do
  cargo run --release -- --objects 10000 --cell-size "$size" --seed 42
done
```

Use `--help` for all parameters.

## Architecture

```text
rust-kernels
     │
     │ reusable spatial + geometry algorithms + optional traces
     ▼
collision-lab Rust
     │
     ├── deterministic scenes / motion / interaction policy
     ├── correctness and benchmark harness
     │
     └── wasm-bindgen
             │
             ▼
        WebAssembly
         ↙       ↘
      SVG        Three.js
 explanation    experiment
```

## Development gates

Rust gate:

```bash
cargo fmt --all --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all-features
cargo check --manifest-path wasm/Cargo.toml --target wasm32-unknown-unknown
```

Web gate:

```bash
cd web
bun install
bun run wasm
bun run typecheck
bun run build
```
