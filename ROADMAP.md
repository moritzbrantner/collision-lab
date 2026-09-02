# Collision Lab Roadmap

Collision Lab is an interactive laboratory for learning, comparing, testing, and visualizing collision-detection algorithms. The long-term goal is not to become a monolithic physics engine. It should remain a place where algorithms and data structures can be understood independently, combined deliberately, measured against deterministic workloads, and reused through `rust-kernels`.

## Principles

1. **Rust is the source of truth.** Collision algorithms, traces, deterministic scene behavior, and measured work counters live in Rust. WebAssembly exposes them to the browser. React/Three.js/SVG are presentation layers.
2. **Correctness before performance.** Optimized algorithms are differential-tested against simple reference implementations and must preserve exact pair-set parity.
3. **Keep dimensions orthogonal.** Motion, interaction meaning, collision layers, runtime state, and geometry are separate concepts rather than one cross-product enum.
4. **Explain before simulating everything.** The lab should make an algorithm understandable with a handful of objects before showing it running against hundreds or thousands.
5. **Tracing is optional.** Debug/explanation APIs may allocate and expose internal structure, but normal kernel consumers should not pay that cost.
6. **Prefer reusable kernels.** General algorithms and data structures belong in `rust-kernels`; scenario generation, semantic interaction policy, experiments, analysis, and teaching UX belong in `collision-lab`.
7. **Visual helpers represent real data structures.** Grid cells, sweep planes, hierarchy boxes, fat AABBs, traversal nodes, and similar helpers should come from the actual Rust algorithm state rather than decorative reimplementations.

## Three complementary modes

### Explanation mode

A deliberately simplified 2D teaching surface.

- 5–8 labeled rectangles instead of hundreds of anonymous 3D objects.
- Hand-designed or fixed deterministic scenes that make the relevant edge case obvious.
- Large Previous / Next / Reset controls and a scrubber.
- One algorithmic idea per view.
- Explicit labels such as `candidate`, `rejected`, `active`, `pruned`, `overlap`, and `exact test`.
- Rust/WASM remains the source of overlap results and execution traces; the web UI projects those traces into 2D SVG.
- Prefer diagrams that can be understood without already knowing collision-detection terminology.

Current explanation sequence:

1. ✅ **Naive all-pairs** — show why `n(n-1)/2` grows quickly and highlight one pair at a time.
2. ✅ **Uniform grid** — show cell membership, duplicated candidates across cells, candidate deduplication, and exact AABB tests.
3. ✅ **Sweep-and-prune** — show X intervals, the sweep line, the active set, expirations, and which full AABB tests remain.
4. ⏭️ **Static BVH** — show node-pair traversal and make whole-subtree pruning visually obvious.
5. ⏭️ **Dynamic AABB tree** — show exact AABB versus fat AABB, contained movement, reinsertion, and structural changes.
6. ⏭️ **Octree** — use a small 2D quadtree-style projection first, then relate it to the eight-child 3D octree shown in Experiment mode.

Later explanation scenes should cover adversarial cases: bad grid cell size, clustered objects, elongated objects, everything overlapping, and fast-moving objects.

### Experiment mode

The 3D Rust/WASM/Three.js playground is the realistic laboratory.

- Hundreds or thousands of objects.
- Static and dynamic motion.
- Solid and sensor interactions.
- Editable world-level interaction matrix.
- Deterministic fixed-timestep simulation.
- Broad-phase metrics and exact pair parity.
- Pause-and-inspect execution traces.
- Workload controls for density, speed, grid size, fat margin, and scene distribution.
- Independently toggleable scene layers for bodies, interaction links, sensors, and algorithm helpers.
- Bright, readable ordinary bodies even when they are not colliding or trace-active.
- Real helper geometry including grid structure, sweep plane, dynamic-tree fat bounds/changed nodes, and octree subdivision boxes.

Experiment mode should reveal *what the data structure is doing* and *when it works well*.

### Analysis mode

The analytical chapter compares algorithms over controlled deterministic workloads.

Implemented baseline:

- Rust/WASM measurements rather than browser rendering timings.
- Object counts `50, 100, 250, 500, 1000`.
- Uniform and clustered distributions.
- World volume grows with object count to keep average density roughly stable.
- Exact AABB-test counts, possible-pair counts, and percentage of pair tests avoided.
- A log-scale scaling chart plus exact measured table.
- Naive all-pairs remains visible as the O(n²) reference curve.
- Uniform grid, octree, sweep-and-prune, static BVH, and dynamic AABB tree are compared on the same deterministic world snapshot.

Analysis should answer *how the algorithms scale*, *which workload properties matter*, and *where crossovers happen* without pretending Big-O alone predicts a concrete winner.

Next analytical additions:

- named adversarial workloads and side-by-side distributions;
- structure metrics such as tree height, node count, memberships, reinsertions, and active-set size;
- native Rust benchmark artifacts independently from WASM/browser execution;
- memory/allocation measurements;
- automatic crossover detection between algorithms;
- workload sweeps for grid cell size, octree capacity/depth, and dynamic-tree fat margin;
- native-vs-WASM comparisons where the boundary itself is worth measuring.

## Broad-phase roadmap

### Implemented

- Naive O(n²) oracle.
- Uniform grid / spatial hash semantics.
- **Octree** with configurable capacity/depth, global candidate deduplication, and deterministic node snapshots.
- Sweep-and-prune.
- Static BVH.
- Dynamic AABB tree with fat AABBs and balancing.
- Deterministic execution traces for uniform grid and sweep-and-prune.
- Stateful dynamic-tree update tracing with retained fat bounds and reinsertion visibility.
- Octree hierarchy helpers: root cube, eight emphasized depth-1 children, and muted deeper subdivisions.
- Static/dynamic scene entities and deterministic motion.
- `InteractionKind::{Solid, Sensor}`.
- World-owned `InteractionMatrix` with live browser editing.
- Distinct solid and sensor interaction visualization.
- Improved ordinary-object legibility and independent helper/body/link visibility controls.
- Homepage split between Explanation, Experiment, and Analysis.
- Simplified six-object 2D explanations for naive all-pairs, uniform grid, and sweep-and-prune.
- Rust-backed scaling Analysis for all current broad phases.

### Next

1. Finish static-BVH traversal/pruning trace and add it to both 3D inspection and 2D Explanation mode.
2. Add a dynamic-AABB-tree 2D teaching preset using the retained-tree trace.
3. Add an Octree/Quadtree explanation lesson that connects 2D subdivision to the eight-child 3D helper.
4. Add richer named educational and analytical presets rather than only random scene generation.
5. Add multi-axis / temporally coherent sweep-and-prune experiments.
6. Add more spatial structures where they teach a genuinely different tradeoff: loose octree, k-d tree/static partitioning, or another evidence-driven candidate rather than near-duplicates.

## Narrow-phase roadmap

Once broad-phase explanation coverage is coherent, begin geometry tests in increasing order of generality.

1. Sphere–sphere and AABB–AABB analytical tests.
2. OBBs and the Separating Axis Theorem (SAT).
3. Capsules and common primitive pairs.
4. Convex support mappings.
5. GJK intersection testing.
6. EPA penetration depth and collision normal.
7. Contact manifolds for stable multi-point contacts.
8. Triangle and mesh queries accelerated by BVHs.

Each major narrow-phase algorithm should receive all relevant views:

- a tiny 2D/diagrammatic explanation where possible;
- a 3D experiment using the actual Rust implementation;
- an analytical treatment showing assumptions, operation counts, failure cases, and measured tradeoffs where meaningful.

GJK deserves an especially detailed step-through view showing the Minkowski difference and simplex evolution: point → line → triangle → tetrahedron → origin enclosed.

## Continuous collision detection

After discrete narrow-phase behavior is understandable:

- ray vs AABB / triangle;
- swept AABB and swept sphere/capsule;
- time of impact;
- selective CCD for fast or small bodies;
- tunneling demonstrations comparing discrete and continuous detection.

## Interaction and scene model

Keep the scene model decomposed rather than expanding one enum.

- `MotionKind`: Static, Dynamic, later Kinematic.
- `InteractionKind`: Solid, Sensor.
- `CollisionLayer`: semantic category such as World, Actor, Projectile, Vehicle, Terrain.
- `InteractionMatrix`: world-owned policy deciding which layer pairs are eligible.
- Runtime state: awake/sleeping and similar transient state remains separate.

Future work:

- add more collision layers and reusable matrix presets;
- allow scene presets to assign layer independently from motion;
- visualize filtered spatial overlaps separately from accepted semantic interactions;
- introduce kinematic bodies only when a teaching or experiment scenario actually needs them.

## Physics response — deliberately later

Collision Lab should stop at reliable contacts for a substantial period before becoming a rigid-body solver.

When added, introduce it as another explicit pipeline stage:

`broad phase → narrow phase → contacts → islands → solver`

Candidate topics:

- velocity, mass and inverse mass;
- impulse response;
- restitution;
- friction;
- constraints;
- sleeping;
- physics islands;
- deterministic solver experiments.

These should not contaminate reusable collision kernels that do not need physics response.

## Educational UX roadmap

- Shareable URLs encoding mode + algorithm + preset + step.
- Side-by-side “naive versus optimized” views.
- Small equations and complexity counters that update with object count.
- Hover/click inspection for individual objects, candidates, helper nodes, and pair rejection reasons.
- Presets named after the concept they teach, not arbitrary seeds.
- A glossary linking AABB, broad phase, narrow phase, candidate pair, fat AABB, octree, BVH, support mapping, Minkowski difference, contact manifold, and related terms.
- Keyboard stepping for explanation traces.
- Optional annotations explaining *why this pair was rejected*.

## Benchmark and correctness roadmap

- Keep deterministic scene seeds and reproducible configuration in every report.
- Maintain naive/reference oracles for differential testing.
- Add property tests for geometry invariants.
- Add adversarial workloads and worst-case demonstrations.
- Separate algorithm work counters from wall-clock timings.
- Benchmark native Rust independently from WASM/browser rendering.
- Use external libraries such as Rapier as reference oracles where useful, without delegating the implementation to them.

## Reuse through rust-kernels

Collision Lab should continue dogfooding reusable spatial kernels rather than growing private copies. Candidates that become sufficiently general should live in or graduate to `rust-kernels`, including:

- spatial hashes and grids;
- octrees and other hierarchical spatial partitions;
- sweep structures;
- BVHs and dynamic AABB trees;
- rays and intersection primitives;
- SAT/GJK/EPA building blocks;
- nearest-neighbor and spatial-query helpers;
- deterministic trace/debug representations when broadly reusable.

This keeps the project useful beyond collision detection: picking, visibility, ray tracing, AI perception, geometry processing, path planning, terrain queries, and other spatial workloads can reuse the same foundations.
