# Collision Lab Roadmap

Collision Lab is an interactive laboratory for learning, comparing, testing, and visualizing collision-detection algorithms. The long-term goal is not to become a monolithic physics engine. It should remain a place where algorithms and data structures can be understood independently, combined deliberately, measured against deterministic workloads, and reused through `rust-kernels`.

## Principles

1. **Rust is the source of truth.** Collision algorithms, traces, and deterministic scene behavior live in Rust. WebAssembly exposes them to the browser. React/Three.js/SVG are presentation layers.
2. **Correctness before performance.** Optimized algorithms are differential-tested against simple reference implementations and must preserve exact pair-set parity.
3. **Keep dimensions orthogonal.** Motion, interaction meaning, collision layers, runtime state, and geometry are separate concepts rather than one cross-product enum.
4. **Explain before simulating everything.** The lab should make an algorithm understandable with a handful of objects before showing it running against hundreds or thousands.
5. **Tracing is optional.** Debug/explanation APIs may allocate and expose internal structure, but normal kernel consumers should not pay that cost.
6. **Prefer reusable kernels.** General algorithms and data structures belong in `rust-kernels`; scenario generation, semantic interaction policy, experiments, and teaching UX belong in `collision-lab`.

## Two complementary modes

### Explanation mode

A deliberately simplified 2D teaching surface.

- 5–8 labeled rectangles instead of hundreds of anonymous 3D objects.
- Hand-designed deterministic scenes that make the relevant edge case obvious.
- Large Previous / Next / Reset controls and a scrubber.
- One algorithmic idea per view.
- Explicit labels such as `candidate`, `rejected`, `active`, `pruned`, `overlap`, and `exact test`.
- Rust/WASM remains the source of overlap results and execution traces; the web UI projects those traces into 2D SVG.
- Prefer diagrams that can be understood without already knowing collision-detection terminology.

Initial explanation sequence:

1. **Naive all-pairs** — show why `n(n-1)/2` grows quickly and highlight one pair at a time.
2. **Uniform grid** — show cell membership, duplicated candidates across cells, candidate deduplication, and exact AABB tests.
3. **Sweep-and-prune** — show X intervals, the sweep line, the active set, expirations, and which full AABB tests remain.
4. **Static BVH** — show node-pair traversal and make whole-subtree pruning visually obvious.
5. **Dynamic AABB tree** — show exact AABB versus fat AABB, contained movement, reinsertion, and structural changes.

Later explanation scenes should cover adversarial cases: bad grid cell size, clustered objects, elongated objects, everything overlapping, and fast-moving objects.

### Experiment mode

The existing 3D Rust/WASM/Three.js playground remains the realistic laboratory.

- Hundreds or thousands of objects.
- Static and dynamic motion.
- Solid and sensor interactions.
- Editable world-level interaction matrix.
- Deterministic fixed-timestep simulation.
- Broad-phase metrics and exact pair parity.
- Pause-and-inspect execution traces.
- Workload controls for density, speed, grid size, fat margin, and scene distribution.

Explanation mode should teach *why* an algorithm works. Experiment mode should reveal *when* it works well.

## Broad-phase roadmap

### Implemented

- Naive O(n²) oracle.
- Uniform grid / spatial hash semantics.
- Sweep-and-prune.
- Static BVH.
- Dynamic AABB tree with fat AABBs and balancing.
- Deterministic execution traces for uniform grid and sweep-and-prune.
- Stateful dynamic-tree update tracing with retained fat bounds and reinsertion visibility.
- Static/dynamic scene entities and deterministic motion.
- `InteractionKind::{Solid, Sensor}`.
- World-owned `InteractionMatrix` with live browser editing.
- Distinct solid and sensor interaction visualization.

### Next

1. Build the simplified 2D Explanation Mode and make it the default learning entry point.
2. Finish static-BVH traversal/pruning trace and browser visualization.
3. Add richer educational presets rather than only random scene generation.
4. Add multi-axis / temporally coherent sweep-and-prune experiments.
5. Add more adversarial broad-phase workloads and side-by-side comparison views.

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

Each major narrow-phase algorithm should receive both modes:

- a tiny 2D/diagrammatic explanation where possible;
- a 3D experiment using the actual Rust implementation.

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

- Explanation/Experiment mode switch visible from the homepage.
- Shareable URLs encoding algorithm + preset + step.
- Side-by-side “naive versus optimized” views.
- Small equations and complexity counters that update with object count.
- Hover/click inspection for individual objects and candidate pairs.
- Presets named after the concept they teach, not arbitrary seeds.
- A glossary linking AABB, broad phase, narrow phase, candidate pair, fat AABB, support mapping, Minkowski difference, contact manifold, and related terms.
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
- sweep structures;
- BVHs and dynamic AABB trees;
- rays and intersection primitives;
- SAT/GJK/EPA building blocks;
- nearest-neighbor and spatial-query helpers;
- deterministic trace/debug representations when broadly reusable.

This keeps the project useful beyond collision detection: picking, visibility, ray tracing, AI perception, geometry processing, path planning, terrain queries, and other spatial workloads can reuse the same foundations.
