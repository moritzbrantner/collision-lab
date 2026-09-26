use rapier3d::prelude::*;
use spatial_kernels::{Body, Pair};

pub fn build_colliders(bodies: &[Body]) -> (RigidBodySet, ColliderSet, Vec<ColliderHandle>) {
    let rigid_bodies = RigidBodySet::new();
    let mut colliders = ColliderSet::with_capacity(bodies.len());
    let mut handles = Vec::with_capacity(bodies.len());

    for body in bodies {
        let half_extents = [
            (body.aabb.max[0] - body.aabb.min[0]) * 0.5,
            (body.aabb.max[1] - body.aabb.min[1]) * 0.5,
            (body.aabb.max[2] - body.aabb.min[2]) * 0.5,
        ];
        let collider = ColliderBuilder::cuboid(half_extents[0], half_extents[1], half_extents[2])
            .translation(body_center(*body))
            .active_collision_types(ActiveCollisionTypes::all())
            .sensor(true)
            .user_data(u128::from(body.id))
            .build();
        handles.push(colliders.insert(collider));
    }

    (rigid_bodies, colliders, handles)
}

pub fn collect_pairs(narrow_phase: &NarrowPhase, colliders: &ColliderSet) -> Vec<Pair> {
    let mut pairs = narrow_phase
        .intersection_pairs()
        .filter(|(_, _, intersecting)| *intersecting)
        .map(|(left, right, _)| {
            Pair::new(collider_id(colliders, left), collider_id(colliders, right))
        })
        .collect::<Vec<_>>();
    pairs.sort_unstable();
    pairs.dedup();
    pairs
}

pub fn body_center(body: Body) -> Vector {
    Vector::new(
        (body.aabb.min[0] + body.aabb.max[0]) * 0.5,
        (body.aabb.min[1] + body.aabb.max[1]) * 0.5,
        (body.aabb.min[2] + body.aabb.max[2]) * 0.5,
    )
}

fn collider_id(colliders: &ColliderSet, handle: ColliderHandle) -> u32 {
    u32::try_from(colliders[handle].user_data)
        .expect("Collision Lab collider IDs are stored losslessly in Rapier user_data")
}
