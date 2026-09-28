//! Retained broad-phase execution through `Simulation::interactions` must stay
//! pair-for-pair identical to an independent all-pairs oracle while doing only
//! incremental work between frames.

use collision_lab::{
    Algorithm, CollisionLayer, Config, InteractionConfig, InteractionKind, InteractionResult,
    MotionConfig, MotionKind, Scenario, SceneEntity, Simulation,
};
use spatial_kernels::Pair;

const DT: f32 = 1.0 / 60.0;

/// Filtered interaction result computed without any broad-phase structure or
/// shared filtering code: every entity pair is tested exhaustively.
#[derive(Debug, PartialEq)]
struct Oracle {
    spatial: Vec<Pair>,
    pairs: Vec<Pair>,
    sensor_pairs: Vec<Pair>,
    filtered_out: usize,
}

fn oracle(simulation: &Simulation) -> Oracle {
    let entities: &[SceneEntity] = simulation.entities();
    let matrix = simulation.interaction_matrix();
    let mut result = Oracle {
        spatial: Vec::new(),
        pairs: Vec::new(),
        sensor_pairs: Vec::new(),
        filtered_out: 0,
    };
    for (index, left) in entities.iter().enumerate() {
        for right in &entities[index + 1..] {
            if !left.body.aabb.overlaps(right.body.aabb) {
                continue;
            }
            let pair = Pair::new(left.body.id, right.body.id);
            result.spatial.push(pair);
            if !matrix.allows(left.layer, right.layer) {
                result.filtered_out += 1;
                continue;
            }
            result.pairs.push(pair);
            if left.interaction == InteractionKind::Sensor
                || right.interaction == InteractionKind::Sensor
            {
                result.sensor_pairs.push(pair);
            }
        }
    }
    result.spatial.sort_unstable();
    result.pairs.sort_unstable();
    result.sensor_pairs.sort_unstable();
    result
}

fn observed(result: &InteractionResult) -> Oracle {
    Oracle {
        spatial: result.broad_phase.pairs.clone(),
        pairs: result.pairs.clone(),
        sensor_pairs: result.sensor_pairs.clone(),
        filtered_out: result.filtered_out,
    }
}

fn assert_parity_over_frames(mut simulation: Simulation, frames: usize, dt: f32) -> Simulation {
    for frame in 0..frames {
        let actual = simulation.interactions(Algorithm::DynamicAabbTree);
        assert!(
            actual.work.retained,
            "frame {frame} must use retained state"
        );
        assert_eq!(observed(&actual), oracle(&simulation), "frame {frame}");
        simulation.step(dt);
    }
    simulation
}

#[test]
fn retained_interactions_match_oracle_in_clustered_scene() {
    let simulation = Simulation::new(
        Config {
            objects: 220,
            seed: 0xC1_05E,
            fat_margin: 1.0,
            scenario: Scenario::Clustered,
            ..Config::default()
        },
        MotionConfig {
            dynamic_fraction: 0.6,
            speed: 10.0,
        },
        InteractionConfig {
            sensor_fraction: 0.3,
        },
    );
    let simulation = assert_parity_over_frames(simulation, 90, DT);
    let stats = simulation.retained_broad_phase_stats();
    assert_eq!(stats.full_builds, 1);
    assert!(stats.reinsertions > 0, "motion must exercise reinsertion");
    assert!(
        stats.reinsertions < stats.body_updates,
        "fat margins must absorb some updates"
    );
}

#[test]
fn retained_interactions_match_oracle_in_sparse_scene() {
    let simulation = Simulation::new(
        Config {
            objects: 180,
            seed: 0x0005_BA5E,
            world_extent: 30.0,
            half_extent: 1.2,
            scenario: Scenario::Uniform,
            ..Config::default()
        },
        MotionConfig {
            dynamic_fraction: 0.4,
            speed: 6.0,
        },
        InteractionConfig::default(),
    );
    assert_parity_over_frames(simulation, 90, DT);
}

#[test]
fn retained_interactions_match_oracle_through_boundary_bounces() {
    // A small world with fast bodies forces repeated wall clamps and
    // velocity reflections within the observed frames.
    let simulation = Simulation::new(
        Config {
            objects: 90,
            seed: 0xB0_0CE,
            world_extent: 6.0,
            half_extent: 0.6,
            fat_margin: 0.4,
            scenario: Scenario::Uniform,
            ..Config::default()
        },
        MotionConfig {
            dynamic_fraction: 1.0,
            speed: 30.0,
        },
        InteractionConfig {
            sensor_fraction: 0.5,
        },
    );
    let simulation = assert_parity_over_frames(simulation, 120, DT);
    let limit = simulation.config().world_extent - simulation.config().half_extent;
    assert!(
        simulation
            .entities()
            .iter()
            .any(|entity| entity.velocity.iter().any(|v| v.abs() > 0.0)),
        "bodies keep moving after bounces"
    );
    assert!(simulation.entities().iter().all(|entity| {
        entity
            .body
            .aabb
            .min
            .iter()
            .zip(entity.body.aabb.max)
            .all(|(min, max)| (min + max) * 0.5 >= -limit && (min + max) * 0.5 <= limit)
    }));
}

#[test]
fn retained_interactions_follow_layer_matrix_changes_without_rebuild() {
    let mut simulation = Simulation::new(
        Config {
            objects: 160,
            seed: 0x001A_7E75,
            scenario: Scenario::Clustered,
            ..Config::default()
        },
        MotionConfig::default(),
        InteractionConfig {
            sensor_fraction: 0.25,
        },
    );
    let toggles = [
        (CollisionLayer::WORLD, CollisionLayer::WORLD, true),
        (CollisionLayer::ACTOR, CollisionLayer::ACTOR, false),
        (CollisionLayer::WORLD, CollisionLayer::ACTOR, false),
        (CollisionLayer::ACTOR, CollisionLayer::ACTOR, true),
    ];
    for (left, right, allowed) in toggles {
        simulation.set_layer_interaction(left, right, allowed);
        simulation = assert_parity_over_frames(simulation, 12, 1.0 / 30.0);
    }
    assert_eq!(
        simulation.retained_broad_phase_stats().full_builds,
        1,
        "the layer matrix filters pairs after the broad phase and must not invalidate it"
    );
}

#[test]
fn idle_frames_perform_no_rebuild_or_update() {
    let mut simulation = Simulation::new(
        Config {
            objects: 200,
            seed: 0x1D1E,
            scenario: Scenario::Clustered,
            ..Config::default()
        },
        MotionConfig::default(),
        InteractionConfig::default(),
    );
    let first = simulation.interactions(Algorithm::DynamicAabbTree);
    assert_eq!(first.work.full_builds, 1);
    assert_eq!(first.work.bodies_materialized, 0);

    // A zero timestep is a no-op frame; repeated queries without stepping are
    // idle as well.
    simulation.step(0.0);
    for _ in 0..3 {
        let idle = simulation.interactions(Algorithm::DynamicAabbTree);
        assert_eq!(idle.work.full_builds, 0);
        assert_eq!(idle.work.body_updates, 0);
        assert_eq!(idle.work.reinsertions, 0);
        assert_eq!(idle.work.bodies_materialized, 0);
        assert_eq!(idle.pairs, first.pairs);
    }

    // Bodies with zero speed still step, but their bounds never change.
    let mut frozen = Simulation::new(
        simulation.config(),
        MotionConfig {
            dynamic_fraction: 1.0,
            speed: 0.0,
        },
        InteractionConfig::default(),
    );
    frozen.interactions(Algorithm::DynamicAabbTree);
    for _ in 0..5 {
        frozen.step(DT);
        let idle = frozen.interactions(Algorithm::DynamicAabbTree);
        assert_eq!(idle.work.full_builds, 0);
        assert_eq!(idle.work.body_updates, 0);
    }
}

#[test]
fn sparse_motion_updates_only_moving_bodies() {
    let mut simulation = Simulation::new(
        Config {
            objects: 400,
            seed: 0x5_9A25E,
            scenario: Scenario::Clustered,
            ..Config::default()
        },
        MotionConfig {
            dynamic_fraction: 0.05,
            speed: 8.0,
        },
        InteractionConfig::default(),
    );
    let (static_count, dynamic_count) = simulation.counts();
    assert!(dynamic_count > 0 && static_count > 10 * dynamic_count);

    simulation.interactions(Algorithm::DynamicAabbTree);
    let static_fat_bounds: Vec<_> = {
        let tree = simulation.retained_dynamic_tree().expect("retained tree");
        simulation
            .entities()
            .iter()
            .filter(|entity| entity.motion == MotionKind::Static)
            .map(|entity| (entity.body.id, tree.fat_bounds(entity.body.id)))
            .collect()
    };

    for frame in 0..30 {
        simulation.step(DT);
        let result = simulation.interactions(Algorithm::DynamicAabbTree);
        assert_eq!(result.work.full_builds, 0, "frame {frame}");
        assert_eq!(
            result.work.body_updates, dynamic_count as u64,
            "frame {frame} must update exactly the moving bodies"
        );
        assert_eq!(result.work.bodies_materialized, 0, "frame {frame}");
    }

    let tree = simulation.retained_dynamic_tree().expect("retained tree");
    for (id, fat_bounds) in static_fat_bounds {
        assert_eq!(tree.fat_bounds(id), fat_bounds, "static body {id}");
    }
}

#[test]
fn coalesced_steps_apply_each_changed_body_once() {
    let mut simulation = Simulation::new(
        Config {
            objects: 150,
            seed: 0xC0A1,
            scenario: Scenario::Clustered,
            ..Config::default()
        },
        MotionConfig::default(),
        InteractionConfig::default(),
    );
    let (_, dynamic_count) = simulation.counts();
    simulation.interactions(Algorithm::DynamicAabbTree);

    // Querying another algorithm must not consume retained updates.
    for _ in 0..4 {
        simulation.step(DT);
        let rebuilt = simulation.interactions(Algorithm::SweepAndPrune);
        assert!(!rebuilt.work.retained);
        assert_eq!(rebuilt.work.full_builds, 1);
    }
    assert_eq!(simulation.pending_retained_updates(), dynamic_count);

    let result = simulation.interactions(Algorithm::DynamicAabbTree);
    assert_eq!(result.work.full_builds, 0);
    assert_eq!(result.work.body_updates, dynamic_count as u64);
    assert_eq!(observed(&result), oracle(&simulation));
}

#[test]
fn invalidation_forces_a_single_full_build() {
    let mut simulation = Simulation::new(
        Config {
            objects: 120,
            seed: 0x1_0BAD,
            ..Config::default()
        },
        MotionConfig::default(),
        InteractionConfig::default(),
    );
    simulation.invalidate_retained_broad_phase();
    assert_eq!(simulation.retained_broad_phase_stats().invalidations, 0);

    simulation.interactions(Algorithm::DynamicAabbTree);
    simulation.step(DT);
    simulation.invalidate_retained_broad_phase();
    assert!(simulation.retained_dynamic_tree().is_none());
    assert_eq!(simulation.pending_retained_updates(), 0);

    let rebuilt = simulation.interactions(Algorithm::DynamicAabbTree);
    assert_eq!(rebuilt.work.full_builds, 1);
    assert_eq!(rebuilt.work.body_updates, 0);
    assert_eq!(observed(&rebuilt), oracle(&simulation));

    let stats = simulation.retained_broad_phase_stats();
    assert_eq!(stats.full_builds, 2);
    assert_eq!(stats.invalidations, 1);
}

#[test]
fn rebuild_path_remains_available_as_reference() {
    let mut simulation = Simulation::new(
        Config {
            objects: 160,
            seed: 0x0_4AC1E,
            scenario: Scenario::Clustered,
            ..Config::default()
        },
        MotionConfig::default(),
        InteractionConfig {
            sensor_fraction: 0.2,
        },
    );
    for _ in 0..20 {
        simulation.step(DT);
        let retained = simulation.interactions(Algorithm::DynamicAabbTree);
        let rebuilt = simulation.rebuild_interactions(Algorithm::DynamicAabbTree);
        let naive = simulation.rebuild_interactions(Algorithm::Naive);
        assert!(!rebuilt.work.retained);
        assert_eq!(rebuilt.work.full_builds, 1);
        assert_eq!(
            rebuilt.work.bodies_materialized,
            simulation.entities().len() as u64
        );
        for reference in [&rebuilt, &naive] {
            assert_eq!(retained.broad_phase.pairs, reference.broad_phase.pairs);
            assert_eq!(retained.pairs, reference.pairs);
            assert_eq!(retained.sensor_pairs, reference.sensor_pairs);
            assert_eq!(retained.filtered_out, reference.filtered_out);
        }
    }
}

#[test]
fn traced_sync_reports_the_same_updates_as_the_query_path() {
    let config = Config {
        objects: 140,
        seed: 0x7_4ACE,
        fat_margin: 0.5,
        scenario: Scenario::Clustered,
        ..Config::default()
    };
    let motion = MotionConfig {
        dynamic_fraction: 0.5,
        speed: 12.0,
    };
    let mut traced = Simulation::new(config, motion, InteractionConfig::default());
    let mut plain = traced.clone();
    let (_, dynamic_count) = traced.counts();

    let initial = traced.sync_retained_dynamic_tree_traced();
    assert_eq!(initial.work.full_builds, 1);
    assert!(initial.updates.is_empty() && initial.focus.is_none());
    plain.interactions(Algorithm::DynamicAabbTree);

    let mut saw_reinsertion_focus = false;
    for frame in 0..40 {
        traced.step(DT);
        plain.step(DT);
        let trace = traced.sync_retained_dynamic_tree_traced();
        let expected = plain.interactions(Algorithm::DynamicAabbTree).work;
        assert_eq!(trace.work, expected, "frame {frame}");
        assert_eq!(trace.updates.len(), dynamic_count, "frame {frame}");
        let reinsertions = trace.updates.iter().filter(|u| u.reinserted).count();
        assert_eq!(reinsertions as u64, expected.reinsertions, "frame {frame}");

        let focus = trace.focus.as_ref().expect("moving scene has a focus");
        if reinsertions > 0 {
            assert!(focus.reinserted, "frame {frame} focus prefers reinsertion");
            saw_reinsertion_focus = true;
        }

        let after_query = traced.interactions(Algorithm::DynamicAabbTree);
        assert_eq!(after_query.work.body_updates, 0, "frame {frame}");
        assert_eq!(observed(&after_query), oracle(&traced), "frame {frame}");
    }
    assert!(saw_reinsertion_focus);
}

/// The temporal benchmark workload: 3,000 clustered bodies with 65 % moving.
/// Exact parity with the oracle is required on every sampled frame, the
/// retained path must never rebuild, and its pair-query work must stay close
/// to that of a per-frame rebuild of the same tree.
#[test]
fn clustered_temporal_workload_keeps_parity_with_retained_updates() {
    let config = Config {
        objects: 3_000,
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
    let (_, dynamic_count) = simulation.counts();
    simulation.interactions(Algorithm::DynamicAabbTree);

    let frames = 24;
    let mut retained_tests = 0;
    let mut rebuild_tests = 0;
    for frame in 0..frames {
        simulation.step(DT);
        let retained = simulation.interactions(Algorithm::DynamicAabbTree);
        assert_eq!(retained.work.full_builds, 0, "frame {frame}");
        assert_eq!(retained.work.bodies_materialized, 0, "frame {frame}");
        assert_eq!(retained.work.body_updates, dynamic_count as u64);
        retained_tests += retained.broad_phase.stats.aabb_tests;

        let rebuilt = simulation.rebuild_interactions(Algorithm::DynamicAabbTree);
        rebuild_tests += rebuilt.broad_phase.stats.aabb_tests;
        if frame % 6 == 5 {
            assert_eq!(observed(&retained), oracle(&simulation), "frame {frame}");
        } else {
            assert_eq!(retained.pairs, rebuilt.pairs, "frame {frame}");
            assert_eq!(retained.sensor_pairs, rebuilt.sensor_pairs, "frame {frame}");
        }
    }

    let stats = simulation.retained_broad_phase_stats();
    assert_eq!(stats.full_builds, 1);
    assert_eq!(stats.body_updates, (frames * dynamic_count) as u64);
    // Measured at introduction: 3,509 reinsertions for 46,080 updates.
    assert!(
        stats.reinsertions * 10 < stats.body_updates,
        "fat margin should absorb most per-frame motion: {stats:?}"
    );
    // Incremental insertion yields a slightly looser tree than a fresh build
    // (measured: 781,031 vs 763,097 pair-query tests). Bound that drift so the
    // retained tree cannot silently degrade.
    assert!(
        retained_tests * 100 <= rebuild_tests * 110,
        "retained tree quality drifted: {retained_tests} vs rebuild {rebuild_tests}"
    );
}
