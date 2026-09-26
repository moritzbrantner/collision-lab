#[path = "rapier_common.rs"]
mod common;

use rapier3d::prelude::*;
use spatial_kernels::{Body, Pair};

pub struct PreparedRapierScene {
    rigid_bodies: RigidBodySet,
    colliders: ColliderSet,
}

#[must_use]
pub fn prepare_scene(bodies: &[Body]) -> PreparedRapierScene {
    let (rigid_bodies, colliders, _) = common::build_colliders(bodies);
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

    common::collect_pairs(&narrow_phase, &scene.colliders)
}
