# Collision optimization review guide

This guide captures reusable review lessons from optimizing collision and physics code. It is intentionally about *how to reason about an optimization*, not about one implementation.

The core rule is: an optimization is acceptable only when it preserves the authority and semantics of the reference path, and when its cost model is better in the workload it is intended to improve.

## 1. Identify the authoritative state before caching anything

A cache must be attached to stable domain state, not to a temporary representation used inside an algorithm.

A common collision-engine trap is to temporarily present a dynamic or sleeping body as static/fixed because doing so simplifies one solver step. That internal representation does **not** make the body genuine immutable scene geometry. If a bake/preparation cache observes the temporary proxy instead of the authoritative scene membership, a sleeping body can accidentally become permanent baked geometry.

Review question:

- What state says that this object is genuinely immutable?
- Is that state visible at the layer where the cache is populated?
- Can an internal solver representation temporarily look equivalent while having different lifecycle semantics?

Prefer registering cache entries from a boundary that knows the real membership/lifecycle. Keep temporary solver substitutions behind that boundary.

## 2. Keep the optimization optional and preserve a reference path

For a new optimization, retain the existing implementation as the reference path until equivalence and value are demonstrated.

Good structure:

- `runtime` / reference mode remains the default.
- optimized mode is an independent switch, not coupled to unrelated gameplay or solver options.
- the optimized path reuses prepared data but falls back to the reference calculation whenever it cannot prove an exact cache match.
- failure/validation behavior remains the same in both modes.

This makes debugging much easier: the same workload can be replayed through both paths and compared directly.

## 3. Do not move work out of one hot loop only to add another linear scan

A cache can still make performance worse if finding a cached value is expensive.

Example anti-pattern:

- prepare every fixed OBB once;
- store prepared values by body ID;
- for every SAT operand, linearly scan all fixed bodies looking for a matching shape.

That changes the hot-path cost toward `O(F * C)`, where `F` is fixed bodies and `C` is collision/narrow-phase evaluations. A small demo can look faster while a static-heavy world scales badly.

Prefer a deterministic index keyed by the exact immutable geometry needed for reuse. Body identity should still own lifecycle/invalidation; the secondary shape index should only accelerate lookup.

Review question: *What is the complexity of one cache hit, including lookup?* Do not review only the cost of creating the cached value.

## 4. Avoid per-frame deep copies of prepared state

Preparing geometry once has little value if every step clones the whole prepared map.

Prepared immutable data should normally use shared ownership or borrowing so that entering a world/solver operation copies only a small handle. Copy-on-write is appropriate when fixed scene membership actually changes.

Look specifically for hidden copies introduced by:

- cloning a world before a staged/fail-closed step;
- installing thread-local or scoped context;
- passing prepared collections between ECS, solver, and query layers;
- snapshotting for deterministic replay.

A useful review question is: *How many bytes scale with fixed-body count on an ordinary frame where the scene did not change?* The desired answer is usually zero or close to zero.

## 5. Define invalidation before calling something "baked"

Prepared collision state is correct only while every input that influenced it is unchanged.

At minimum, review invalidation for:

- body insertion/removal;
- position or orientation changes;
- collider/shape/extents changes;
- fixed/dynamic membership changes;
- representation/schema version changes;
- switching optimization modes;
- loading a persisted artifact produced by an incompatible representation.

If geometry is mutable through remove-and-readd, make that path explicit and test it. Persistent bake artifacts need a version/migration policy; do not add persistence merely because an in-memory cache exists.

## 6. Sleeping is an optimization state, not scene authority

Sleeping bodies remain dynamic bodies. Sleep can change because of impact, support changes, explicit velocity changes, removed supports, or other topology changes.

Therefore:

- never serialize/bake a sleeping dynamic as permanent static geometry;
- never let an internal fixed proxy enter the persistent/static cache;
- add a long-enough settling regression proving preparation counts do not grow when dynamics go to sleep;
- wake/invalidate according to the engine's authoritative sleep rules, not according to the cache.

This distinction should be documented because it is easy to lose during future refactors.

## 7. Prove replay equivalence, not just "tests pass"

For optimizations that claim identical physics semantics, run the same deterministic workload through reference and optimized paths and compare observable replay evidence.

Useful equivalence evidence includes:

- exact state/replay hashes;
- event counts and ordering;
- body counts/membership;
- checked error results;
- contact/solver outcomes where exposed.

Run each mode more than once so the evidence also catches nondeterminism inside a mode.

Do not accept approximate equality for a path that claims to be a pure reuse optimization. If the optimization intentionally changes physics, it is a separate behavioral experiment and must not be presented as equivalent caching.

## 8. Measure the whole tradeoff

A preparation/baking optimization has multiple costs and benefits. Capture all of them:

- preparation count;
- startup/load/reset cost;
- retained memory;
- steady-state simulation cost;
- representative high-contact workloads;
- representative idle/quiescent workloads;
- scaling with static-body count where relevant.

Keep timing results as evidence rather than brittle wall-clock CI thresholds unless the runner is controlled enough for reliable thresholds. Preserve benchmark workloads and result schemas so later optimizations remain historically comparable.

When changing an optimization, extend the benchmark rather than replacing it with a new workload that makes the new implementation look better.

## 9. Optimize without weakening correctness limits

Never obtain a better benchmark by reducing collision quality or fail-closed behavior.

Do not silently change:

- CCD sample/refinement policy;
- event caps;
- solver passes;
- checked arithmetic/error handling;
- deterministic ordering;
- contact semantics;
- wake/sleep correctness.

If an optimization requires one of those changes, treat it as a separate algorithmic decision with independent evidence.

## 10. Review the boundary cost, not just the algorithm

Many performance bugs live at integration seams rather than in the collision primitive itself.

For a cache or accelerator, inspect:

- scene/ECS → physics registration;
- physics world → solver staging;
- solver → narrow phase;
- broad phase → narrow phase identity propagation;
- WASM/API boundary;
- Pages/demo controls and reset behavior;
- benchmark harness and evidence serialization.

The best algorithm can still lose if the integration layer rebuilds, scans, serializes, or clones data unnecessarily.

## Practical checklist

Before merging a collision optimization, verify:

1. The authoritative owner of cached state is explicit.
2. Temporary solver state cannot be mistaken for durable scene state.
3. The reference path still exists and is the default unless there is strong evidence to change that.
4. Cache lookup complexity is appropriate for expected scale.
5. Ordinary frames do not deep-copy data proportional to static scene size.
6. Every relevant mutation invalidates or refreshes prepared state.
7. Sleeping dynamics cannot enter baked/static state.
8. Reference and optimized replay evidence is exactly equivalent when equivalence is claimed.
9. Startup, memory, preparation count, and steady-state performance are all measured.
10. Benchmarks are deterministic and historically comparable.
11. Correctness bounds and fail-closed behavior were not weakened to improve numbers.
12. The interactive/demo surface exposes the optimization independently enough to reproduce comparisons.

## Case-study lesson

The prepare-at-load work in `physics-engine` PR #76 is a useful example. The first implementation correctly kept baking optional and protected sleeping dynamics at the public scene boundary, but review still found two classic performance hazards: copying retained state during stepping and scanning every retained fixed shape on each cache lookup. Both are easy mistakes because the local code still looks like "prepared once" caching.

The durable lesson is to review an optimization as a complete cost pipeline: **authority → preparation → storage → lookup → per-frame transport → invalidation → equivalence → measurement**. Missing any one of those stages can turn a correct-looking optimization into a correctness bug or a scalability regression.
