use rapier3d::prelude::*;
use spatial_kernels::{Body, Pair};

pub struct PreparedRapierScene {
    rigid_bodies: RigidBodySet,
    colliders: ColliderSet,
}

#[must_use]
pub fn prepare_scene(bodies: &[Body]) -> PreparedRapierScene {
    let rigid_bodies = RigidBodySet::new();
    let mut colliders = ColliderSet::with_capacity(bodies.len());

    for body in bodies {
        let center = [
            (body.aabb.min[0] + body.aabb.max[0]) * 0.5,
            (body.aabb.min[1] + body.aabb.max[1]) * 0.5,
            (body.aabb.min[2] + body.aabb.max[2]) * 0.5,
        ];
        let half_extents = [
            (body.aabb.max[0] - body.aabb.min[0]) * 0.5,
            (body.aabb.max[1] - body.aabb.min[1]) * 0.5,
            (body.aabb.max[2] - body.aabb.min[2]) * 0.5,
        ];

        let collider = ColliderBuilder::cuboid(
            half_extents[0],
            half_extents[1],
            half_extents[2],
        )
        .translation(Vector::new(center[0], center[1], center[2]))
        .active_collision_types(ActiveCollisionTypes::all())
        .sensor(true)
        .user_data(u128::from(body.id))
        .build();
        colliders.insert(collider);
    }

    PreparedRapierScene {
        rigid_bodies,
        colliders,
    }
}

#[must_use]
pub fn detect_pairs(mut scene: PreparedRapierScene) -> Vec<Pair> {
    let mut islands = IslandManager::new();
    let mut broad_phase = BroadPhaseBvh::new();
    let mut narrow_phase = NarrowPhase::new();
    let mut pipeline = CollisionPipeline::new();
    let integration_parameters = IntegrationParameters::default();

    pipeline.step(
        integration_parameters.prediction_distance(),
        &mut islands,
        &mut broad_phase,
        &mut narrow_phase,
        &mut scene.rigid_bodies,
        &mut scene.colliders,
        &(),
        &(),
    );

    let mut pairs = narrow_phase
        .intersection_pairs()
        .filter(|(_, _, intersecting)| *intersecting)
        .map(|(left, right, _)| {
            Pair::new(
                collider_id(&scene.colliders, left),
                collider_id(&scene.colliders, right),
            )
        })
        .collect::<Vec<_>>();
    pairs.sort_unstable();
    pairs.dedup();
    pairs
}

fn collider_id(colliders: &ColliderSet, handle: ColliderHandle) -> u32 {
    u32::try_from(colliders[handle].user_data)
        .expect("Collision Lab collider IDs are stored losslessly in Rapier user_data")
}
