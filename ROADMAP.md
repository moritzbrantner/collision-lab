# Collision Lab Roadmap

Collision Lab is an interactive laboratory for learning, comparing, testing, and visualizing collision-detection algorithms. It should not become a monolithic physics engine. The project exists to make algorithms understandable independently, combine them deliberately, measure them on deterministic workloads, and graduate reusable pieces into `rust-kernels`.

## Principles

1. **Rust is the source of truth.** Collision algorithms, traces, deterministic scenes, and work counters live in Rust. WASM exposes them; React, SVG, Three.js, and WebGPU-facing UI are presentation/experiment layers.
2. **Correctness before performance.** Optimized paths are differential-tested against simple reference implementations and must preserve exact pair-set parity.
3. **Keep dimensions orthogonal.** Motion, interaction meaning, collision layers, runtime state, geometry, acceleration structure, and compute backend are separate concerns.
4. **Explain before scaling.** An algorithm should be understandable with a handful of objects before it is shown against hundreds or thousands.
5. **Tracing is optional.** Debug and teaching APIs may allocate, but normal kernel consumers should not pay that cost.
6. **Prefer reusable kernels.** General algorithms/data structures belong in `rust-kernels`; scenarios, semantic interaction policy, experiments, analysis, and teaching UX belong in `collision-lab`.
7. **Visual helpers represent real state.** Grid cells, sweep planes, BVH nodes, fat AABBs, octree subdivisions, and similar helpers come from the actual Rust algorithm state rather than decorative reimplementations.
8. **Algorithm and hardware are different axes.** A faster GPU implementation does not replace algorithmic comparison; Compute mode should make hardware parallelism and algorithmic pruning independently measurable.

## Four complementary modes

### 1. Explanation

A deliberately simplified teaching surface, usually 2D.

Implemented lessons:

1. ✅ **Naive all-pairs** — one unique pair at a time and `n(n-1)/2` growth.
2. ✅ **Uniform grid** — cell membership, duplicated candidates, deduplication, and exact tests.
3. ✅ **Sweep-and-prune** — intervals, sweep line, active set, expirations, and surviving exact tests.
4. ✅ **Static BVH** — real node-pair traversal with `descend`, `pruned`, and `leaf-test`; each prune quantifies how many descendant object pairs disappear.
5. ✅ **Dynamic AABB tree** — exact AABB versus fat AABB, contained motion, `escaped → reinserted`, changed tree nodes, and retained-tree pair parity.
6. ✅ **Octree** — the real eight 3D children projected as two 2×2 slices: four XY quadrants in the lower-Z half and four in the upper-Z half.

Explanation mode should keep using purpose-built deterministic scenes rather than anonymous random seeds where clarity benefits from it. Next educational work should emphasize named edge-case presets and later narrow-phase geometry.

### 2. Experiment

The 3D Rust/WASM/Three.js laboratory for realistic workloads.

Implemented:

- hundreds of bodies with deterministic fixed-timestep motion;
- static and dynamic `MotionKind`;
- `InteractionKind::{Solid, Sensor}`;
- world-owned collision-layer `InteractionMatrix` with live editing;
- brighter readable static/dynamic bodies;
- independently toggleable Bodies / Helpers / Solid links / Sensors;
- real helper geometry for grid structure, sweep plane, dynamic-tree fat bounds/changed nodes, octree subdivisions, and focused static-BVH traversal;
- pause/step execution traces;
- exact pair-set verification across broad phases.

Experiment should answer: **What is the algorithm doing in a realistic world, and when does it behave well?**

### 3. Analysis

Controlled deterministic comparisons of algorithmic work.

Implemented baseline:

- Rust/WASM work counters rather than browser rendering timing;
- object counts `50, 100, 250, 500, 1000`;
- uniform and clustered distributions;
- world volume grows with object count to keep average density roughly stable;
- possible-pair counts, exact AABB tests, and percent avoided;
- log-scale scaling chart and exact table;
- Naive, Uniform Grid, Octree, Sweep-and-Prune, Static BVH, and Dynamic AABB Tree on the same scene snapshot.

Next Analysis additions:

- named adversarial workloads;
- structure metrics: tree height, node count, memberships, active-set size, reinsertions;
- parameter sweeps: grid cell size, octree capacity/depth, dynamic-tree fat margin;
- automatic crossover detection;
- native Rust benchmark artifacts separate from WASM/browser execution;
- memory/allocation measurements.

### 4. Compute

A separate chapter for **where the same work executes**.

Implemented baseline:

- same deterministic naive all-pairs AABB workload on Rust/WASM and WebGPU;
- exact pair-set parity through compact pair bitsets;
- object counts `100, 250, 500, 1000, 2500, 5000`;
- median CPU/WASM and GPU end-to-end measurements;
- GPU preparation/upload, submit→readback, and GPU-pass timing when timestamp queries are available;
- crossover claims only when CPU/GPU pair-set parity is exact.

Next Compute work:

- WebGPU Uniform Grid so hardware parallelism can be separated from algorithmic pruning;
- compare CPU optimized broad phases against GPU naive and GPU optimized versions;
- characterize transfer/readback overhead and GPU crossover points;
- later consider WebGPU for narrow-phase batches where parallel structure is a good fit.

## Broad-phase status

### Implemented kernels and traces

- Naive O(n²) oracle.
- Uniform Grid / spatial hash semantics.
- Sweep-and-Prune with deterministic execution trace.
- Static BVH.
- `bvh-trace-kernels` companion trace with node snapshots, traversal decisions, exact leaf-test parity, and the accounting invariant `pruned potential pairs + leaf tests = all possible pairs`.
- Dynamic AABB Tree with fat AABBs, balancing, retained updates, and before/after structural traces.
- Octree with configurable depth/capacity, candidate deduplication, deterministic node snapshots, and eight-way helper visualization.

### Next broad-phase work

1. **Named deterministic presets** for teaching and analysis: sparse, clustered, bad-grid, everything-overlapping, fast-movers, and other meaningful cases.
2. **Multi-axis / temporally coherent Sweep-and-Prune** experiments.
3. **Richer structural analysis** across current algorithms before adding many near-duplicates.
4. Add another spatial structure only when it teaches a genuinely different tradeoff—possible candidates include a loose octree or k-d/static partitioning.

## Narrow-phase roadmap

Broad-phase teaching coverage is now coherent enough to begin the next chapter deliberately.

Recommended order:

1. **Analytical primitives** — sphere–sphere and AABB–AABB.
2. **OBB + Separating Axis Theorem (SAT)**.
3. **Capsules and common primitive pairs**.
4. **Convex support mappings**.
5. **GJK intersection testing**.
6. **EPA penetration depth and collision normal**.
7. **Contact manifolds**.
8. **Triangle/mesh queries accelerated by BVHs**.

Each major narrow-phase topic should get the relevant views:

- Explanation: tiny geometry and step-by-step reasoning;
- Experiment: actual Rust implementation in 3D;
- Analysis: assumptions, operation counts, failure cases, and measured tradeoffs;
- Compute: only when CPU/GPU placement is a meaningful question.

GJK deserves an especially detailed visual treatment of the Minkowski difference and simplex evolution: point → line → triangle → tetrahedron → origin enclosed.

## Continuous collision detection

After discrete narrow-phase behavior is established:

- ray vs AABB / triangle;
- swept AABB and swept sphere/capsule;
- time of impact;
- selective CCD for fast/small bodies;
- tunneling demonstrations comparing discrete and continuous detection.

## Scene and interaction model

Keep these separate:

- `MotionKind`: Static, Dynamic, later Kinematic.
- `InteractionKind`: Solid, Sensor.
- `CollisionLayer`: World, Actor, later Projectile / Vehicle / Terrain / etc.
- `InteractionMatrix`: world-owned policy deciding which layer pairs are eligible.
- Runtime state: awake/sleeping and similar transient state.

Future scene work:

- more layers and reusable matrix presets;
- named scene presets assigning layer independently from motion;
- clearer visualization of spatial overlaps filtered out by semantic policy;
- kinematic bodies only when a concrete lesson or experiment needs them.

## Physics response — deliberately later

Stay at reliable contacts for a substantial period before adding a rigid-body solver.

When it arrives, keep the pipeline explicit:

`broad phase → narrow phase → contacts → islands → solver`

Possible later topics: mass/inverse mass, impulses, restitution, friction, constraints, sleeping, physics islands, and deterministic solver experiments.

## Educational UX roadmap

- Shareable URLs encoding mode + algorithm + preset + step.
- Side-by-side naive vs optimized views.
- Small equations and counters that update with object count.
- Click inspection for objects, candidates, helper nodes, and rejection reasons.
- Presets named after the concept they teach, not arbitrary seeds.
- Glossary: AABB, broad phase, narrow phase, candidate pair, fat AABB, octree, BVH, support mapping, Minkowski difference, contact manifold, etc.
- Keyboard stepping for traces.
- Optional “why was this pair rejected?” annotations.

## Benchmark and correctness roadmap

- Preserve deterministic seeds/configuration in reports.
- Maintain simple/reference oracles for differential testing.
- Add property tests for geometry invariants.
- Add adversarial and worst-case workloads.
- Separate operation counters from wall-clock timing.
- Benchmark native Rust independently from WASM/browser rendering.
- Use external libraries such as Rapier as reference oracles where useful without delegating the implementation to them.

## Reuse through `rust-kernels`

Collision Lab should continue dogfooding reusable components rather than growing private algorithm copies. Candidates include:

- spatial hashes and grids;
- octrees and other hierarchical spatial partitions;
- sweep structures;
- BVHs and dynamic AABB trees;
- rays/intersection primitives;
- SAT/GJK/EPA building blocks;
- nearest-neighbor/spatial-query helpers;
- deterministic trace/debug representations when broadly useful.

The same foundations should remain useful beyond collision detection: picking, visibility, ray tracing, AI perception, geometry processing, path planning, terrain queries, and other spatial workloads.
