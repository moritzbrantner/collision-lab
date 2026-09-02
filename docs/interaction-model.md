# Interaction model

Collision Lab keeps three independent questions separate:

1. **Motion kind** — how the object moves (`Static`, `Dynamic`, later `Kinematic`).
2. **Interaction kind** — what an accepted overlap means (`Solid` or `Sensor`).
3. **Collision layer** — which interaction category the object belongs to.

These dimensions intentionally do not collapse into one large enum. A static object can be a sensor, a dynamic object can be solid, and either can be assigned to any collision layer.

## World-level interaction matrix

Each scene entity owns exactly one `CollisionLayer`. The scene/world owns one `InteractionMatrix` that decides which layer pairs are eligible to interact.

The current demo starts with two layers:

|       | World | Actor |
|-------|:-----:|:-----:|
| World | no    | yes   |
| Actor | yes   | yes   |

Matrix edits are symmetric: toggling `World × Actor` also changes `Actor × World`. This keeps the meaning close to physical pair eligibility rather than directional event routing.

The matrix uses one row of bits per layer internally, so adding new one-bit layers such as `Projectile`, `Vehicle`, `Character`, or `Terrain` does not require changing the broad-phase algorithms. The current public demo exposes `World` and `Actor`; the representation supports up to 32 one-bit layers.

Static bodies currently default to the `World` layer and dynamic bodies to `Actor`, but that is only a scene-generation policy. Motion and layer identity are separate concepts, so later scenes may contain static actors, dynamic world objects, kinematic projectiles, or other combinations.

## Why the policy belongs to the world

A per-object collision mask duplicates what is conceptually a row of the same interaction matrix on every object. Keeping the policy at world scope has several advantages:

- entity state stays small and describes the entity rather than global policy;
- the complete interaction policy is inspectable in one place;
- changing a rule such as `Projectile × Projectile` does not require mutating every projectile;
- the browser can visualize and edit the matrix directly;
- deterministic experiments can treat the matrix as part of the scene configuration.

Per-object overrides can still be added later if a concrete use case requires them, but they are not the default abstraction.

## Broad phase versus interaction filtering

The reusable broad-phase kernels still answer only the geometric question:

> Which AABBs overlap?

Collision Lab then asks the world-level matrix whether the two entities' layers are eligible. This preserves a clean kernel API and lets the lab report the stages separately:

- spatial overlaps found by the broad phase;
- overlaps removed by the interaction matrix;
- remaining interaction pairs;
- the subset involving sensors.

A later optimization can push a caller-supplied eligibility predicate into selected broad phases if measurements show that avoiding those candidate tests materially helps. The semantic policy should remain outside the geometry kernel even if a kernel eventually accepts a filtering hook.

## Why `Sensor` is not a layer

`Sensor` describes what an accepted overlap *does*, not what category the object belongs to. Keeping it separate allows combinations such as:

- static world sensor;
- dynamic actor sensor;
- static solid geometry;
- dynamic solid actor.

That separation also leaves room for runtime state such as sleeping/awake without turning any one enum into a cross-product of unrelated concepts.
