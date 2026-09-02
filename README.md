# collision-lab

A deterministic Rust playground for comparing collision-detection and spatial-indexing techniques.

**Algorithm guide:** https://moritzbrantner.github.io/collision-lab/

The lab is intentionally separate from [`rust-kernels`](https://github.com/moritzbrantner/rust-kernels): reusable algorithms live there; scenarios, instrumentation, comparisons, and visualization live here.

## MVP

The first experiment compares two broad phases from `spatial-kernels`:

- **naive** — checks every unique object pair and serves as the correctness oracle
- **uniform grid** — partitions 3D space into sparse cells and only AABB-tests objects that share at least one cell

Both algorithms must return the exact same deterministic set of overlapping AABB pairs. The lab reports how many AABB tests each performed, how many overlaps were found, occupied grid cells, elapsed time, and the percentage of tests eliminated by the grid.

The kernel dependency is pinned to the exact MVP revision so experiments remain reproducible.

## Algorithm guide

The `web/` application is a statically exported Next.js site for GitHub Pages. Each implemented algorithm gets its own explanation page with a visual model, complexity and memory characteristics, step-by-step behavior, pseudocode, strengths, tradeoffs, and a link to the reusable Rust kernel.

The initial catalog covers the naive broad phase and uniform grid. New collision kernels should add a catalog entry as part of their lab integration so the website remains the human-readable view of what the repository can do.

Run it locally with Bun:

```bash
cd web
bun install
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

## What this establishes

```text
deterministic scene generator
          │
          ├── naive O(n²) oracle
          │
          └── uniform grid
                  │
                  ▼
       exact pair-set parity check
                  │
                  ▼
       comparable operation metrics
```

This gives future sweep-and-prune, spatial-hash, BVH, and dynamic-AABB-tree implementations a fixed harness: they must match the oracle before their performance is interesting.

## Development

Rust gate:

```bash
cargo fmt --all --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all-features
```

Web gate:

```bash
cd web
bun install
bun run typecheck
bun run build
```
