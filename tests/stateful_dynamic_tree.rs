use bvh_kernels::DynamicAabbTree;
use collision_lab::{
    Algorithm, Config, InteractionConfig, MotionConfig, MotionKind, Scenario, Simulation,
    run_algorithm,
};

#[test]
fn retained_dynamic_tree_matches_snapshot_oracle_through_motion() {
    let config = Config {
        objects: 160,
        seed: 0xD1A0_AABB,
        fat_margin: 1.25,
        scenario: Scenario::Clustered,
        ..Config::default()
    };
    let mut simulation = Simulation::new(
        config,
        MotionConfig {
            dynamic_fraction: 0.65,
            speed: 9.0,
        },
        InteractionConfig::default(),
    );
    let mut tree = DynamicAabbTree::new(config.fat_margin);
    for body in simulation.bodies() {
        tree.insert(body);
    }

    let mut saw_contained_update = false;
    let mut saw_reinsertion = false;
    let mut saw_structural_trace = false;
    for _ in 0..180 {
        simulation.step(1.0 / 30.0);
        let moving: Vec<_> = simulation
            .entities()
            .iter()
            .filter(|entity| entity.motion == MotionKind::Dynamic)
            .map(|entity| entity.body)
            .collect();
        let focus_id = moving
            .iter()
            .find(|body| {
                tree.fat_bounds(body.id)
                    .is_some_and(|fat| !fat.contains(body.aabb))
            })
            .map(|body| body.id)
            .or_else(|| moving.first().map(|body| body.id));

        for body in moving {
            let reinserted = if focus_id == Some(body.id) {
                let trace = tree.update_with_trace(body);
                saw_structural_trace |= !trace.changed_nodes.is_empty();
                trace.reinserted
            } else {
                tree.update(body)
            };
            saw_reinsertion |= reinserted;
            saw_contained_update |= !reinserted;
        }

        let bodies = simulation.bodies();
        assert_eq!(
            tree.overlapping_pairs(),
            run_algorithm(Algorithm::Naive, config, &bodies).pairs
        );
    }

    assert!(
        saw_contained_update,
        "fat AABBs should absorb some movement"
    );
    assert!(
        saw_reinsertion,
        "some bodies should eventually leave their fat AABBs"
    );
    assert!(
        saw_structural_trace,
        "representative updates should produce a trace"
    );
}
