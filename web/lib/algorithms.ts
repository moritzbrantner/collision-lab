export type Algorithm = {
  slug: string;
  name: string;
  family: string;
  role: string;
  summary: string;
  complexity: string;
  memory: string;
  bestFor: string[];
  tradeoffs: string[];
  steps: string[];
  explanation: string[];
  pseudocode: string;
  sourcePath: string;
};

export const algorithms: Algorithm[] = [
  {
    slug: "naive-broad-phase",
    name: "Naive broad phase",
    family: "Broad phase",
    role: "Correctness oracle",
    summary:
      "Tests every unique collider pair. It is intentionally simple and expensive, which makes it excellent as a reference implementation.",
    complexity: "O(n²) pair tests",
    memory: "O(1) auxiliary memory",
    bestFor: [
      "Small scenes",
      "Differential testing",
      "Establishing a trustworthy baseline",
    ],
    tradeoffs: [
      "Work grows quadratically with object count",
      "Ignores spatial separation entirely",
      "Predictable behavior and very little implementation complexity",
    ],
    steps: [
      "Take each collider as the left side of a pair.",
      "Compare it with every collider after it exactly once.",
      "Run the AABB overlap test.",
      "Record overlapping pairs and sort the public result deterministically.",
    ],
    explanation: [
      "The naive algorithm asks the most direct question possible: for every two objects in the scene, do their axis-aligned bounding boxes overlap? With 10,000 objects there are 49,995,000 possible unique pairs, so the cost becomes obvious very quickly.",
      "That apparent weakness is useful in collision-lab. Because the implementation has almost no spatial bookkeeping, it is easy to reason about and hard to accidentally miss a pair. Optimized algorithms are therefore compared against it for exact pair-set parity.",
      "A faster broad phase is only interesting after it returns exactly the same overlapping pairs as this oracle on the same deterministic scene.",
    ],
    pseudocode: `for left in 0..bodies.len():\n  for right in left + 1..bodies.len():\n    if overlaps(bodies[left], bodies[right]):\n      pairs.add(canonical_pair(left, right))\n\nsort(pairs)`,
    sourcePath: "crates/spatial-kernels/src/lib.rs",
  },
  {
    slug: "uniform-grid",
    name: "Uniform grid",
    family: "Spatial partition",
    role: "Optimized broad phase",
    summary:
      "Divides 3D space into fixed-size cells and only tests colliders that share at least one occupied cell.",
    complexity: "Near O(n + k) in well-distributed scenes",
    memory: "O(occupied cells + memberships)",
    bestFor: [
      "Worlds with reasonably even object density",
      "Objects with similar spatial scale",
      "Fast broad-phase candidate reduction",
    ],
    tradeoffs: [
      "Cell size strongly affects performance",
      "Large objects may occupy many cells",
      "Dense clusters can still approach quadratic candidate counts",
    ],
    steps: [
      "Convert each finite AABB into minimum and maximum grid-cell coordinates.",
      "Insert the body into every cell touched by its AABB.",
      "Generate candidate pairs only among bodies sharing an occupied cell.",
      "Deduplicate candidates that share multiple cells.",
      "Run the same AABB overlap test and return the sorted pair set.",
    ],
    explanation: [
      "The uniform grid uses a simple observation: two AABBs cannot overlap unless they occupy at least one common region of space. Instead of comparing everything with everything, the world is partitioned into fixed-size cubic cells.",
      "Each collider is registered in every cell touched by its AABB. Candidate tests are then restricted to colliders that appear in the same cell. A pair that shares several cells is still tested only once.",
      "The cell size is the important tuning knob. Very large cells contain too many objects and lose most of the pruning benefit; very small cells increase bookkeeping and cause large objects to span many cells. collision-lab exists partly to make those tradeoffs measurable rather than theoretical.",
    ],
    pseudocode: `for body in bodies:\n  bounds = cells_touched_by(body.aabb, cell_size)\n  for cell in bounds:\n    grid[cell].add(body)\n\nfor members in occupied_cells:\n  for unique_pair in members:\n    if pair_not_tested_before(unique_pair):\n      if overlaps(pair):\n        pairs.add(canonical_pair(pair))`,
    sourcePath: "crates/spatial-kernels/src/lib.rs",
  },
];

export function getAlgorithm(slug: string): Algorithm | undefined {
  return algorithms.find((algorithm) => algorithm.slug === slug);
}
