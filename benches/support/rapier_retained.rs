#[path = "rapier_common.rs"]
mod common;

use rapier3d::prelude::*;
use spatial_kernels::{Body, Pair};

pub struct RetainedRapierScene {
    rigid_bodies: RigidBodySet,
    colliders: ColliderSet,
    handles: Vec<ColliderHandle>,
    islands: IslandManager,
    broad_phase: BroadPhaseBvh,
    narrow_phase: NarrowPhase,
    pipeline: CollisionPipeline,
    prediction_distance: f32,
}

#[must_use]
pub fn prepare_retained_scene(bodies: &[Body]) -> RetainedRapierScene {
    let (rigid_bodies, colliders, handles) = common::build_colliders(bodies);
    let mut scene = RetainedRapierScene {
        rigid_bodies,
        colliders,
        handles,
        islands: IslandManager::new(),
        broad_phase: BroadPhaseBvh::new(),
        narrow_phase: NarrowPhase::new(),
        pipeline: CollisionPipeline::new(),
        prediction_distance: IntegrationParameters::default().prediction_distance(),
    };
    let _ = scene.detect_pairs();
    scene
}

impl RetainedRapierScene {
    #[must_use]
    pub fn update_and_detect_pairs(&mut self, moving: &[(usize, Body)]) -> Vec<Pair> {
        for &(index, body) in moving {
            let handle = self.handles[index];
            assert_eq!(
                self.colliders[handle].user_data,
                u128::from(body.id),
                "temporal Rapier handle order must match Collision Lab body order"
            );
            self.colliders
                .get_mut(handle)
                .expect("retained Rapier collider must exist")
                .set_translation(common::body_center(body));
        }
        self.detect_pairs()
    }

    fn detect_pairs(&mut self) -> Vec<Pair> {
        self.pipeline.step(
            self.prediction_distance,
            &mut self.islands,
            &mut self.broad_phase,
            &mut self.narrow_phase,
            &mut self.rigid_bodies,
            &mut self.colliders,
            &(),
            &(),
        );
        common::collect_pairs(&self.narrow_phase, &self.colliders)
    }
}
