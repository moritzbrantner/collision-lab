# Interaction model

Collision Lab keeps three independent questions separate:

1. **Motion kind** — how the object moves (`Static`, `Dynamic`, later `Kinematic`).
2. **Interaction kind** — what an accepted overlap means (`Solid` or `Sensor`).
3. **Layer filter** — which categories of objects are allowed to interact.

These dimensions intentionally do not collapse into one large enum. A static object can be a sensor, a dynamic object can be solid, and either can be assigned to any collision layer.

## Layer + mask filtering

Each scene entity owns:

- one `CollisionLayer` bit describing its category;
- one `CollisionMask` bitset describing categories it accepts.

A pair is eligible only when **both** entities accept the other entity's layer:

```text
A.mask contains B.layer
AND
B.mask contains A.layer
```

This makes asymmetric policies representable while keeping the usual game-physics behavior symmetric at the pair level.

The current demo starts with two layers:

|       | World | Actor |
|-------|:-----:|:-----:|
| World | no    | yes   |
| Actor | yes   | yes   |

Static bodies currently default to the `World` layer and dynamic bodies to `Actor`, but that is a scene-generation policy, not a type-system restriction. In later scenarios, motion and layer assignment can vary independently.

## Broad phase versus interaction filtering

The reusable broad-phase kernels still answer only the geometric question:

> Which AABBs overlap?

Collision Lab then applies the interaction filter to those overlapping pairs. This preserves a clean kernel API and lets the lab report both numbers separately:

- spatial overlaps found by the broad phase;
- overlaps removed by the layer matrix;
- remaining interaction pairs;
- the subset involving sensors.

A later optimization can push a caller-supplied filter predicate into selected broad phases if measurements show that avoiding those candidate tests materially helps. The semantic policy should remain outside the geometry kernel even if the kernel eventually accepts a filtering hook.

## Why `Sensor` is not a layer

`Sensor` describes what an accepted overlap *does*, not what category the object belongs to. Keeping it separate allows combinations such as:

- static world sensor;
- dynamic actor sensor;
- static solid geometry;
- dynamic solid actor.

That separation also leaves room for runtime state such as sleeping/awake without turning any one enum into a cross-product of unrelated concepts.
