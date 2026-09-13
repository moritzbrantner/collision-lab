# Collision Lab Roadmap

Collision Lab is an interactive laboratory for learning, comparing, testing, and visualizing collision-detection algorithms. It should not become a monolithic physics engine. The project exists to make algorithms understandable independently, combine them deliberately, measure them on deterministic workloads, and graduate reusable pieces into `rust-kernels`.

## Principles

1. **Rust is the source of truth.** Collision algorithms, traces, deterministic scenes, and work counters live in Rust. WASM exposes them; React, SVG, Three.js, and WebGPU-facing UI are presentation/experiment layers.
2. **Correctness before performance.** Optimized paths are differential-tested against simple reference implementations and must preserve exact pair-set parity.
3. **Keep dimensions orthogonal.** Motion, interaction meaning, collision layers, runtime state, geometry, acceleration structure, and compute backend are separate concerns.
4. **Explain before scaling.** An algorithm should be understandable with a handful of objects before it is shown against hundreds or thousands.
5. **Tracing is optional.** Debug and teaching APIs may allocate, but normal kernel consumers should not pay that cost.
6. **Prefer reusable kernels.** General algorithms/data structures belong in `rust-kernels`; scenarios, semantic interaction policy, experiments, analysis, and teaching UX belong in `collision-lab`.
7. **Visual helpers represent real state.** Grid cells, sweep planes, BVH nodes, fat AABBs, octree subdivisions, closest features, and similar helpers come from the actual Rust algorithm state rather than decorative reimplementations.
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
7. ✅ **Analytical narrow phase** — sphere–sphere and AABB–AABB exact relations exposed from `geometry-kernels`.
8. ✅ **2D OBB SAT** — four candidate axes, projected radii, signed overlap, and the first separating axis.
9. ✅ **3D OBB SAT** — all 15 candidate axes, including inactive parallel edge-cross axes.
10. ✅ **Closest-point primitive pairs** — sphere–AABB, sphere–capsule, and capsule–capsule using Rust-returned closest features, segment parameters, distance, and signed separation.

A separate `/convex/` page already prototypes support mappings, GJK, and EPA as an inspectable browser teaching model. Its collision decisions are not yet the authoritative shared Rust path. The next educational ownership slice should replace that prototype authority with the reusable Rust support/GJK foundation while preserving the visual walkthrough.

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
- named deterministic workloads including sparse, bad-grid, and everything-overlapping cases;
- world volume grows with object count to keep average density roughly stable where the workload calls for it;
- possible-pair counts, exact AABB tests, and percent avoided;
- log-scale scaling chart and exact table;
- Naive, Uniform Grid, Octree, Sweep-and-Prune, Static BVH, and Dynamic AABB Tree on the same scene snapshot.

Next Analysis additions:

- more adversarial workloads, especially fast movers and temporally coherent scenes;
- structure metrics: tree height, node count, memberships, active-set size, reinsertions;
- parameter sweeps: grid cell size, octree capacity/depth, dynamic-tree fat margin;
- automatic crossover detection;
- native Rust benchmark artifacts separate from WASM/browser execution;
- memory/allocation measurements.

### 4. Compute

A separate chapter for **where the same work executes**.

Implemented baseline:

- same deterministic naive all-pairs AABB workload on Rust/WASM and WebGPU;
- Uniform Grid on Rust/WASM and WebGPU so algorithmic pruning can be separated from hardware parallelism;
- exact pair-set parity through compact pair bitsets;
- grid work-parity checks for occupied cells and unique exact AABB tests;
- object counts `100, 250, 500, 1000, 2500, 5000`;
- median CPU/WASM and GPU end-to-end measurements;
- GPU preparation/upload, submit→readback, and GPU-pass timing when timestamp queries are available;
- crossover claims only when CPU/GPU pair-set parity is exact.

Next Compute work:

- compare additional CPU optimized broad phases against GPU naive and GPU-appropriate optimized versions;
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
- Named deterministic workloads for baseline-uniform, clustered, sparse, bad-grid, and everything-overlapping behavior.

### Next broad-phase work

1. **Multi-axis / temporally coherent Sweep-and-Prune** experiments.
2. **Richer structural analysis** across current algorithms before adding many near-duplicates.
3. **Fast-mover and temporal presets** that make retained-structure behavior measurable over multiple frames.
4. Add another spatial structure only when it teaches a genuinely different tradeoff—possible candidates include a loose octree or k-d/static partitioning.

## Narrow-phase roadmap

The direct primitive chapter is now coherent enough to move from special-case formulas toward a general convex pipeline.

Current status:

1. ✅ **Analytical primitives** — sphere–sphere and AABB–AABB.
2. ✅ **OBB + Separating Axis Theorem (SAT)** — focused 2D lesson and full 15-axis 3D relation.
3. ✅ **Capsules and common primitive pairs** — sphere–AABB, sphere–capsule, and capsule–capsule via reusable closest-point kernels.
4. 🟡 **Convex support mappings + GJK** — a browser teaching prototype exists, and `rust-kernels::geometry-kernels` now provides reusable support-map and deterministic GJK foundations; Collision Lab still needs to make that Rust path authoritative for the lesson and expose trace-quality simplex evidence.
5. 🟡 **EPA penetration depth and collision normal** — the browser teaching prototype demonstrates the idea, but an authoritative reusable Rust result/trace is still needed before Collision Lab should treat it as implemented geometry.
6. ⬜ **Contact manifolds**.
7. ⬜ **Triangle/mesh queries accelerated by BVHs**.

Immediate implementation sequence:

1. **Rust-owned GJK lesson** — consume the shared support-map/GJK kernel through WASM, expose support queries and simplex evolution, and differential-test collision decisions against appropriate primitive/SAT oracles.
2. **Rust-owned EPA** — add penetration depth/normal evidence on top of an intersecting GJK simplex, with deterministic termination/failure semantics.
3. **Contact generation** — turn a collision relation into stable contact points/manifolds before introducing any rigid-body response.
4. **Mesh queries** — combine triangle tests with BVH traversal without turning the broad phase and mesh acceleration structure into one undifferentiated system.

Each major narrow-phase topic should get the relevant views:

- Explanation: tiny geometry and step-by-step reasoning;
- Experiment: actual Rust implementation in 3D;
- Analysis: assumptions, operation counts, failure cases, and measured tradeoffs;
- Compute: only when CPU/GPU placement is a meaningful question.

GJK deserves an especially detailed visual treatment of the Minkowski difference and simplex evolution: point → line → triangle → tetrahedron → origin enclosed. The frontend may materialize/project teaching geometry, but support choices, simplex decisions, termination status, and intersection truth should come from Rust.

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
- Click inspection for objects, candidates, helper nodes, closest features, and rejection reasons.
- Presets named after the concept they teach, not arbitrary seeds.
- Glossary: AABB, broad phase, narrow phase, candidate pair, fat AABB, octree, BVH, capsule, support mapping, Minkowski difference, contact manifold, etc.
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
- closest-point and capsule primitives;
- SAT/support-map/GJK building blocks;
- EPA/contact-generation building blocks as they mature;
- nearest-neighbor/spatial-query helpers;
- deterministic trace/debug representations when broadly useful.

The same foundations should remain useful beyond collision detection: picking, visibility, ray tracing, AI perception, geometry processing, path planning, terrain queries, and other spatial workloads.
