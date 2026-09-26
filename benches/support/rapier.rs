use rapier3d::prelude::*;
use spatial_kernels::{Body, Pair};

pub struct PreparedRapierScene {
    rigid_bodies: RigidBodySet,
    colliders: ColliderSet,
}

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
pub fn prepare_scene(bodies: &[Body]) -> PreparedRapierScene {
    let (rigid_bodies, colliders, _) = build_colliders(bodies);
    PreparedRapierScene {
        rigid_bodies,
        colliders,
    }
}

#[must_use]
pub fn prepare_retained_scene(bodies: &[Body]) -> RetainedRapierScene {
    let (rigid_bodies, colliders, handles) = build_colliders(bodies);
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

    collect_pairs(&narrow_phase, &scene.colliders)
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
                .set_translation(body_center(body));
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
        collect_pairs(&self.narrow_phase, &self.colliders)
    }
}

fn build_colliders(bodies: &[Body]) -> (RigidBodySet, ColliderSet, Vec<ColliderHandle>) {
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

fn collect_pairs(narrow_phase: &NarrowPhase, colliders: &ColliderSet) -> Vec<Pair> {
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

fn body_center(body: Body) -> Vector {
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
