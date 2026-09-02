# collision-lab

A deterministic Rust playground for learning, comparing, and visualizing collision-detection and spatial-indexing techniques.

**Website:** https://moritzbrantner.github.io/collision-lab/

**Roadmap:** [ROADMAP.md](ROADMAP.md)

The lab is intentionally separate from [`rust-kernels`](https://github.com/moritzbrantner/rust-kernels): reusable algorithms live there; scenarios, instrumentation, semantic interaction policy, comparisons, and visualization live here.

## Two modes

### Explanation mode

`/explain/` is a simplified 2D teaching surface. It uses a tiny deterministic scene with labeled rectangles and walks through algorithm decisions one step at a time. The first slice covers naive all-pairs, uniform grid, and sweep-and-prune.

The web layer does not reimplement optimized collision algorithms. It obtains overlap results and execution traces from the same Rust/WASM implementation used elsewhere in the lab, then projects those results into SVG.

### Experiment mode

`/demo/` is the full Rust/WASM/Three.js laboratory. It supports deterministic moving scenes, static and dynamic bodies, solid and sensor interactions, a live world-level interaction matrix, broad-phase metrics, and paused execution traces.

Explanation mode teaches **why** an algorithm works. Experiment mode explores **when** it works well.

## Current broad phases

- **naive** — checks every unique object pair and serves as the correctness oracle
- **uniform grid** — partitions 3D space into sparse cells and only AABB-tests objects that share at least one cell
- **sweep-and-prune** — sorts intervals and tests only the active set
- **static BVH** — hierarchically rejects groups of bounds
- **dynamic AABB tree** — retains a balanced hierarchy across moving frames using fat AABBs

All optimized broad phases are differential-tested against the naive reference and must return the exact same deterministic set of overlapping AABB pairs.

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
     │ reusable spatial algorithms + optional traces
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
