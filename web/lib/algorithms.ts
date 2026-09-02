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
    summary: "Tests every unique collider pair. It is intentionally simple and expensive, which makes it excellent as a reference implementation.",
    complexity: "O(n²) pair tests",
    memory: "O(1) auxiliary memory",
    bestFor: ["Small scenes", "Differential testing", "Establishing a trustworthy baseline"],
    tradeoffs: ["Work grows quadratically with object count", "Ignores spatial separation entirely", "Predictable behavior and very little implementation complexity"],
    steps: ["Take each collider as the left side of a pair.", "Compare it with every collider after it exactly once.", "Run the AABB overlap test.", "Record overlapping pairs and sort the public result deterministically."],
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
    summary: "Divides 3D space into fixed-size cells and only tests colliders that share at least one occupied cell.",
    complexity: "Near O(n + k) when well distributed",
    memory: "O(cells + memberships)",
    bestFor: ["Even object density", "Objects with similar spatial scale", "Cheap neighborhood queries"],
    tradeoffs: ["Cell size strongly affects performance", "Large objects may occupy many cells", "Dense clusters can still approach quadratic candidate counts"],
    steps: ["Convert each finite AABB into minimum and maximum grid-cell coordinates.", "Insert the body into every cell touched by its AABB.", "Generate candidates only among bodies sharing an occupied cell.", "Deduplicate candidates that share multiple cells.", "Run exact AABB overlap tests and return the sorted pair set."],
    explanation: [
      "A uniform grid uses the observation that two AABBs cannot overlap unless they occupy a common region of space. The world is partitioned into fixed-size cubic cells and each collider is registered in every cell it touches.",
      "The cell size is the important tuning knob. Large cells contain too many objects, while tiny cells increase bookkeeping and make large objects span many buckets.",
      "The live demo lets you change the grid size while Rust recomputes the candidate work, making that tradeoff directly measurable.",
    ],
    pseudocode: `for body in bodies:\n  for cell in cells_touched_by(body.aabb):\n    grid[cell].add(body)\n\nfor members in occupied_cells:\n  for unique_pair in members:\n    if not_already_tested(pair) and overlaps(pair):\n      pairs.add(pair)`,
    sourcePath: "crates/spatial-kernels/src/lib.rs",
  },
  {
    slug: "octree",
    name: "Octree",
    family: "Spatial hierarchy",
    role: "Adaptive broad phase",
    summary: "Recursively divides a cubic region into eight children so dense parts of space can be refined without imposing the same resolution everywhere.",
    complexity: "Distribution-dependent",
    memory: "O(nodes + memberships)",
    bestFor: ["Non-uniform spatial density", "Large 3D worlds", "Hierarchical region queries"],
    tradeoffs: ["Objects crossing split planes belong to multiple leaves", "Deep subdivision increases bookkeeping", "When everything overlaps, spatial subdivision cannot remove real pair work"],
    steps: ["Compute a cubic root around all AABBs.", "If a node is too crowded, split it into eight equally sized child cubes.", "Insert every body into each child cube it intersects.", "Repeat until capacity or depth limits stop subdivision.", "Generate pairs inside leaves, deduplicate cross-leaf duplicates, then run exact AABB tests."],
    explanation: [
      "An octree is the 3D analogue of repeatedly quartering a 2D square, except each cube becomes eight smaller cubes. Empty or sparse regions can stop early while crowded regions keep subdividing.",
      "That adaptivity distinguishes it from a uniform grid: the grid chooses one cell size for the whole world, while an octree spends resolution only where its hierarchy decides it is useful.",
      "A large AABB may intersect several children, so the same candidate can appear in more than one leaf. The kernel therefore deduplicates candidate pairs before performing the exact overlap test.",
    ],
    pseudocode: `subdivide(node):\n  if depth_limit or members <= capacity: return\n  children = split_cube_into_8(node.bounds)\n  for child in children:\n    child.members = bodies_intersecting(child.bounds)\n    subdivide(child)\n\nfor leaf in leaves:\n  test each globally-new pair in leaf`,
    sourcePath: "crates/octree-kernels/src/lib.rs",
  },
  {
    slug: "sweep-and-prune",
    name: "Sweep and prune",
    family: "Ordering",
    role: "Optimized broad phase",
    summary: "Sorts AABB endpoints along an axis and only compares objects whose intervals overlap on that axis.",
    complexity: "O(n log n + k) snapshot",
    memory: "O(n) active set",
    bestFor: ["Smoothly moving worlds", "Scenes spread along a useful axis", "Exploiting temporal coherence in a stateful variant"],
    tradeoffs: ["A poor sweep axis creates a large active set", "The current kernel sorts each snapshot from scratch", "Dense overlap along the sweep axis reduces pruning"],
    steps: ["Sort bodies by their minimum endpoint on the sweep axis.", "Maintain an active set whose maximum endpoint has not been passed.", "Only compare the new body against that active set.", "Remove expired intervals as the sweep advances.", "Sort the exact overlapping pair set deterministically."],
    explanation: [
      "Sweep and prune turns a spatial problem into an ordering problem. If object A ends before object B begins on X, the pair cannot collide in 3D and no Y/Z test is needed.",
      "The snapshot implementation sorts each frame independently. A later stateful version can preserve endpoint order between frames, which is especially effective because game objects usually move only a little between adjacent frames.",
      "The blue plane in the live visualization represents the sweep direction; the important metric is how few exact AABB tests survive the interval filter.",
    ],
    pseudocode: `sort bodies by aabb.min.x\nactive = []\nfor body in bodies:\n  remove active items with max.x < body.min.x\n  for other in active:\n    if overlaps(body, other): pairs.add(body, other)\n  active.add(body)`,
    sourcePath: "crates/spatial-kernels/src/lib.rs",
  },
  {
    slug: "static-bvh",
    name: "Static BVH",
    family: "Hierarchy",
    role: "Tree broad phase",
    summary: "Recursively groups nearby AABBs so one failed parent-box test can reject an entire subtree.",
    complexity: "Typically sub-quadratic traversal",
    memory: "O(n) tree nodes",
    bestFor: ["Static geometry", "Ray and overlap queries", "Large worlds with spatial hierarchy"],
    tradeoffs: ["Tree construction costs work up front", "A poor hierarchy reduces pruning", "Frequent movement makes rebuilding unattractive"],
    steps: ["Compute enclosing bounds for a group of bodies.", "Split along the longest axis at the centroid median.", "Recursively build child bounds until leaves contain bodies.", "Traverse only node pairs whose bounding boxes overlap.", "Perform exact body AABB tests only at leaves."],
    explanation: [
      "A bounding-volume hierarchy stores boxes around groups of boxes. When two high-level bounds do not overlap, every possible pair beneath those nodes can be rejected at once.",
      "The current kernel builds a deterministic median-split tree, making it appropriate for static data and for comparing hierarchical pruning against grids and sweep-and-prune.",
      "The same hierarchy pattern later becomes useful for raycasts, picking, visibility, and mesh acceleration—not only collision detection.",
    ],
    pseudocode: `build(group):\n  if one body: return leaf\n  axis = longest_axis(bounds(group))\n  split group at centroid median\n  return node(build(left), build(right))\n\ntraverse(nodeA, nodeB):\n  if bounds do not overlap: return\n  descend until leaf pairs`,
    sourcePath: "crates/bvh-kernels/src/lib.rs",
  },
  {
    slug: "dynamic-aabb-tree",
    name: "Dynamic AABB tree",
    family: "Hierarchy",
    role: "Incremental broad phase",
    summary: "Maintains a balanced BVH whose leaves use enlarged fat AABBs so small object movements avoid tree reinsertion.",
    complexity: "Roughly O(log n) updates and queries",
    memory: "O(n) tree nodes",
    bestFor: ["Moving rigid bodies", "Incremental overlap queries", "Worlds with many small frame-to-frame movements"],
    tradeoffs: ["Fat bounds create deliberate false positives", "Tree quality depends on insertion and balancing", "Large movements still require reinsertion"],
    steps: ["Wrap each exact body AABB in a configurable fat AABB.", "Insert leaves using a surface-area cost heuristic.", "Balance the hierarchy as leaves are added or removed.", "Update the exact AABB in place while it remains inside its fat bound.", "Reinsert only when movement escapes the fat bound, while exact pair output still uses exact AABBs."],
    explanation: [
      "A dynamic AABB tree solves a different problem from a static BVH: its hierarchy must survive continuous movement. Rebuilding the whole tree every frame would waste work.",
      "Each leaf therefore owns a slightly larger fat bounding box. Small movements update only the exact collider stored at the leaf. Once the collider leaves that reserve space, the leaf is removed and inserted again at a better position in the tree.",
      "In the demo, the faint larger boxes visualize that reserve. Increasing the fat margin means fewer structural updates in a stateful simulation, but also looser pruning and more potential candidates.",
    ],
    pseudocode: `insert(body):\n  fat = expand(body.aabb, margin)\n  choose sibling by surface-area cost\n  create parent and rebalance\n\nupdate(body):\n  if fat.contains(body.aabb): update exact body only\n  else: remove leaf; recompute fat; reinsert`,
    sourcePath: "crates/bvh-kernels/src/lib.rs",
  },
];

export function getAlgorithm(slug: string): Algorithm | undefined {
  return algorithms.find((algorithm) => algorithm.slug === slug);
}
