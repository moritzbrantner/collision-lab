# collision-lab

A deterministic Rust playground for comparing collision-detection and spatial-indexing techniques.

The lab is intentionally separate from [`rust-kernels`](https://github.com/moritzbrantner/rust-kernels): reusable algorithms live there; scenarios, instrumentation, comparisons, and future visualization live here.

## MVP

The first experiment compares two broad phases from `spatial-kernels`:

- **naive** — checks every unique object pair and serves as the correctness oracle
- **uniform grid** — partitions 3D space into sparse cells and only AABB-tests objects that share at least one cell

Both algorithms must return the exact same deterministic set of overlapping AABB pairs. The lab reports how many AABB tests each performed, how many overlaps were found, occupied grid cells, elapsed time, and the percentage of tests eliminated by the grid.

The kernel dependency is pinned to the exact MVP revision so experiments remain reproducible.

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

```bash
cargo fmt --all --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all-features
```
