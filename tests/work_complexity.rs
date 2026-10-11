//! Multi-scale operation work evidence for the broad-phase comparison.
//!
//! These tests feed the broad-phase `operations` in
//! `.performance/contract.json` through `scripts/collect-work-evidence.sh`.
//! Every scale point checks correctness first (identical candidate-pair sets
//! across all algorithms, equal to the all-pairs oracle) and only then records
//! deterministic operation counts. Nothing here reads a clock.
//!
//! When `COLLISION_LAB_WORK_EVIDENCE_DIR` is set, the tests write
//! `<operation>.json` fragments and leave the declared bounds to
//! `coding-tooling performance work`. Without it, they assert the same bounds
//! (and some stricter, exact ones) themselves, so plain `cargo test` catches a
//! regression to all-pairs work.

use collision_lab::{
    Algorithm, Config, InteractionConfig, MotionConfig, Scenario, Simulation, generate_scene,
    run_algorithm,
};
use spatial_kernels::{Aabb, Body, BroadPhaseResult};

/// One scale point: `(dimensions, metrics)` as `(name, value)` pairs.
type WorkSample = (Vec<(&'static str, u64)>, Vec<(&'static str, u64)>);

/// Directory that `scripts/collect-work-evidence.sh` sets to collect
/// `coding-tooling/work-evidence/v1` samples.
fn work_evidence_dir() -> Option<std::path::PathBuf> {
    std::env::var_os("COLLISION_LAB_WORK_EVIDENCE_DIR").map(Into::into)
}

/// Writes one operation's samples as `<dir>/<operation>.json`.
fn write_work_evidence(dir: &std::path::Path, operation: &str, samples: &[WorkSample]) {
    fn fields(pairs: &[(&str, u64)]) -> String {
        pairs
            .iter()
            .map(|(name, value)| format!("\"{name}\":{value}"))
            .collect::<Vec<_>>()
            .join(",")
    }
    let samples = samples
        .iter()
        .map(|(dimensions, metrics)| {
            format!(
                "{{\"dimensions\":{{{}}},\"metrics\":{{{}}}}}",
                fields(dimensions),
                fields(metrics)
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    std::fs::write(
        dir.join(format!("{operation}.json")),
        format!("{{\"id\":\"{operation}\",\"samples\":[{samples}]}}\n"),
    )
    .expect("work evidence directory must be writable");
}

/// The marginal-rate `linear` rule from coding-tooling's work-complexity
/// contract: no later interval may add more work per added unit than the
/// first interval did.
fn assert_linear(name: &str, points: &[(u64, u64)]) {
    let [(x0, v0), (x1, v1), ..] = points else {
        panic!("{name} needs at least two scale points");
    };
    let reference = (*v1 as i128 - *v0 as i128).max(0);
    let first_width = *x1 as i128 - *x0 as i128;
    for window in points.windows(2).skip(1) {
        let [(xa, va), (xb, vb)] = [window[0], window[1]].map(|(x, v)| (x as i128, v as i128));
        assert!(
            (vb - va) * first_width <= reference * (xb - xa),
            "{name} grows faster than linearly between {xa} and {xb}: {va} -> {vb} \
             (first interval {x0} -> {x1}: {v0} -> {v1})"
        );
    }
}

fn metric(sample: &WorkSample, name: &str) -> u64 {
    sample
        .1
        .iter()
        .find(|(metric, _)| *metric == name)
        .map(|(_, value)| *value)
        .unwrap_or_else(|| panic!("sample is missing metric {name}"))
}

fn series(samples: &[WorkSample], name: &str) -> Vec<(u64, u64)> {
    samples
        .iter()
        .map(|sample| (sample.0[0].1, metric(sample, name)))
        .collect()
}

fn ceil_log2(value: u64) -> u64 {
    u64::from(u64::BITS - (value.max(1) - 1).leading_zeros())
}

// ---------------------------------------------------------------------------
// Fixed-density broad-phase family
// ---------------------------------------------------------------------------

/// Objects in one tile: the existing 3,000-object clustered scene at world
/// extent 100 has the same density as 375 objects at extent 50.
const TILE_OBJECTS: usize = 375;
const TILE_EXTENT: f32 = 50.0;
/// Distance between tile origins. A tile spans `[-50, 50]` per axis, so a
/// 125-unit pitch leaves a 25-unit gap (ten 2.5-unit grid cells) between
/// tiles; no body can overlap a body of another tile.
const TILE_PITCH: f32 = 125.0;
/// Tiles per axis at each scale point: 1, 8, 27 and 64 tiles, that is 375,
/// 3,000, 10,125 and 24,000 objects at constant density.
const TILES_PER_AXIS: [usize; 4] = [1, 2, 3, 4];

const CELL_SIZE: f32 = 2.5;
const FAT_MARGIN: f32 = 0.75;
const HALF_EXTENT: f32 = 0.5;
const SEED: u64 = 42;

fn tile_config(scenario: Scenario) -> Config {
    Config {
        objects: TILE_OBJECTS,
        cell_size: CELL_SIZE,
        fat_margin: FAT_MARGIN,
        seed: SEED,
        world_extent: TILE_EXTENT,
        half_extent: HALF_EXTENT,
        scenario,
    }
}

/// Fixed-density scene: `tiles_per_axis³` copies of the same deterministic
/// tile on a cubic lattice. Replicating one tile keeps the density, the
/// cluster shape and the per-tile overlap structure identical at every scale,
/// so an algorithm whose work is local to the neighbourhood of each body must
/// do exactly proportional work. Scaling a single scene's extent instead would
/// shrink the cluster surface-to-volume ratio with N and make per-object work
/// drift upward even for a perfectly local algorithm.
fn fixed_density_scene(scenario: Scenario, tiles_per_axis: usize) -> Vec<Body> {
    let tile = generate_scene(tile_config(scenario));
    let mut bodies = Vec::with_capacity(tile.len() * tiles_per_axis.pow(3));
    for x in 0..tiles_per_axis {
        for y in 0..tiles_per_axis {
            for z in 0..tiles_per_axis {
                let offset = [x, y, z].map(|index| index as f32 * TILE_PITCH);
                for body in &tile {
                    let id = u32::try_from(bodies.len()).expect("scene fits u32 IDs");
                    let aabb = Aabb {
                        min: [0, 1, 2].map(|axis| body.aabb.min[axis] + offset[axis]),
                        max: [0, 1, 2].map(|axis| body.aabb.max[axis] + offset[axis]),
                    };
                    bodies.push(Body::new(id, aabb));
                }
            }
        }
    }
    bodies
}

/// Metric name for one algorithm's AABB tests.
const fn aabb_metric(algorithm: Algorithm) -> &'static str {
    match algorithm {
        Algorithm::Naive => "naive-aabb-tests",
        Algorithm::UniformGrid => "uniform-grid-aabb-tests",
        Algorithm::Octree => "octree-aabb-tests",
        Algorithm::SweepAndPrune => "sweep-and-prune-aabb-tests",
        Algorithm::StaticBvh => "static-bvh-aabb-tests",
        Algorithm::DynamicAabbTree => "dynamic-aabb-tree-aabb-tests",
    }
}

/// Runs every algorithm on the fixed-density family. Correctness gate first:
/// the naive all-pairs reference is the oracle and every other algorithm must
/// produce the identical sorted candidate-pair set.
fn broad_phase_samples(scenario: Scenario) -> Vec<WorkSample> {
    let config = tile_config(scenario);
    TILES_PER_AXIS
        .into_iter()
        .map(|tiles_per_axis| {
            let bodies = fixed_density_scene(scenario, tiles_per_axis);
            let objects = bodies.len() as u64;
            let results: Vec<(Algorithm, BroadPhaseResult)> = Algorithm::ALL
                .into_iter()
                .map(|algorithm| (algorithm, run_algorithm(algorithm, config, &bodies)))
                .collect();
            let (_, oracle) = &results[0];
            assert_eq!(results[0].0, Algorithm::Naive);
            for (algorithm, result) in &results {
                assert_eq!(
                    result.pairs,
                    oracle.pairs,
                    "{} candidate pairs differ from the all-pairs oracle at {objects} objects",
                    algorithm.as_str()
                );
            }

            let mut metrics = vec![("candidate-pairs", oracle.pairs.len() as u64)];
            metrics.extend(
                results
                    .iter()
                    .map(|(algorithm, result)| (aabb_metric(*algorithm), result.stats.aabb_tests)),
            );
            (vec![("objects", objects)], metrics)
        })
        .collect()
}

/// Bounds shared by both fixed-density families. `exact_local` lists the
/// algorithms whose work must be exactly tile-count × single-tile work.
fn assert_broad_phase_bounds(samples: &[WorkSample], budgets: &[(&str, u64)]) {
    // Naive all-pairs keeps its quadratic comparison role: exactly n(n-1)/2.
    for sample in samples {
        let objects = sample.0[0].1;
        assert_eq!(
            metric(sample, "naive-aabb-tests"),
            objects * (objects - 1) / 2,
            "naive reference must stay the exhaustive all-pairs oracle"
        );
    }

    // Local algorithms: exactly proportional work on replicated tiles, which
    // is stricter than (and implies) the declared linear bound.
    let base = &samples[0];
    let base_objects = base.0[0].1;
    for name in [
        "candidate-pairs",
        "uniform-grid-aabb-tests",
        "dynamic-aabb-tree-aabb-tests",
    ] {
        for sample in samples {
            let tiles = sample.0[0].1 / base_objects;
            assert_eq!(
                metric(sample, name),
                tiles * metric(base, name),
                "{name} at {} objects must be {tiles} × the single-tile work",
                sample.0[0].1
            );
        }
        assert_linear(name, &series(samples, name));
    }

    // Static BVH: median-split tree, near-linear (n log n) but not exactly
    // proportional. Bound it by n·⌈log2 n⌉/2 at every point.
    for sample in samples {
        let objects = sample.0[0].1;
        let tests = metric(sample, "static-bvh-aabb-tests");
        assert!(
            2 * tests <= objects * ceil_log2(objects),
            "static-bvh AABB tests {tests} exceed n·log2(n)/2 at {objects} objects"
        );
    }

    // Octree (fixed max depth) and single-axis sweep-and-prune are expected to
    // grow faster than linearly on this family; they must still stay below 10% of
    // all-pairs from the second scale point on.
    for sample in &samples[1..] {
        let naive = metric(sample, "naive-aabb-tests");
        for name in ["octree-aabb-tests", "sweep-and-prune-aabb-tests"] {
            let tests = metric(sample, name);
            assert!(
                tests * 10 <= naive,
                "{name} {tests} is not below 10% of all-pairs {naive} at {} objects",
                sample.0[0].1
            );
        }
    }

    for &(name, max) in budgets {
        for sample in samples {
            let value = metric(sample, name);
            assert!(
                value <= max,
                "{name} {value} exceeds its budget {max} at {} objects",
                sample.0[0].1
            );
        }
    }
}

#[test]
fn clustered_fixed_density_broad_phase_work_scales_per_algorithm_contract() {
    let samples = broad_phase_samples(Scenario::Clustered);
    if let Some(dir) = work_evidence_dir() {
        write_work_evidence(&dir, "broad-phase-clustered-fixed-density", &samples);
        return;
    }
    // Keep these in sync with .performance/contract.json.
    assert_broad_phase_bounds(
        &samples,
        &[
            ("candidate-pairs", 6_560),
            ("uniform-grid-aabb-tests", 73_040),
            ("dynamic-aabb-tree-aabb-tests", 102_800),
            ("static-bvh-aabb-tests", 61_760),
            ("octree-aabb-tests", 304_729),
            ("sweep-and-prune-aabb-tests", 10_512_360),
            ("naive-aabb-tests", 287_988_000),
        ],
    );
}

#[test]
fn sparse_fixed_density_broad_phase_work_scales_per_algorithm_contract() {
    let samples = broad_phase_samples(Scenario::Uniform);
    if let Some(dir) = work_evidence_dir() {
        write_work_evidence(&dir, "broad-phase-sparse-fixed-density", &samples);
        return;
    }
    // Keep these in sync with .performance/contract.json.
    assert_broad_phase_bounds(
        &samples,
        &[
            ("candidate-pairs", 80),
            ("uniform-grid-aabb-tests", 560),
            ("dynamic-aabb-tree-aabb-tests", 640),
            ("static-bvh-aabb-tests", 14_320),
            ("octree-aabb-tests", 50_660),
            ("sweep-and-prune-aabb-tests", 1_981_160),
            ("naive-aabb-tests", 287_988_000),
        ],
    );
}

// ---------------------------------------------------------------------------
// Retained dynamic-tree frame synchronization
// ---------------------------------------------------------------------------

/// Retained-scene sizes: the single-scene clustered family at the same
/// density as the existing 3,000-object scenario (`world_extent` = 50·k for
/// 375·k³ objects).
const RETAINED_SCALE: [u64; 3] = [1, 2, 3];
const RETAINED_FRAMES: u64 = 8;
const DT: f32 = 1.0 / 60.0;

#[test]
fn retained_dynamic_tree_sync_work_scales_with_moving_bodies_only() {
    let samples: Vec<WorkSample> = RETAINED_SCALE
        .into_iter()
        .map(|k| {
            let objects = 375 * k * k * k;
            let mut simulation = Simulation::new(
                Config {
                    objects: objects as usize,
                    cell_size: CELL_SIZE,
                    fat_margin: FAT_MARGIN,
                    seed: SEED,
                    world_extent: 50.0 * k as f32,
                    half_extent: HALF_EXTENT,
                    scenario: Scenario::Clustered,
                },
                // Every body moves, so each frame changes every body's bounds.
                MotionConfig {
                    dynamic_fraction: 1.0,
                    speed: 8.0,
                },
                InteractionConfig::default(),
            );
            assert_eq!(simulation.counts(), (0, objects as usize));

            // Preparation: the first retained query performs the one full build.
            let prepared = simulation.interactions(Algorithm::DynamicAabbTree);
            assert_eq!(prepared.work.full_builds, 1);

            let mut full_builds = 0;
            let mut body_updates = 0;
            let mut reinsertions = 0;
            let mut bodies_materialized = 0;
            for frame in 0..RETAINED_FRAMES {
                simulation.step(DT);
                let retained = simulation.interactions(Algorithm::DynamicAabbTree);
                // Correctness first: the retained answer equals a full
                // snapshot rebuild, which the broad-phase tests above and
                // tests/retained_broad_phase.rs tie to the all-pairs oracle.
                let reference = simulation.rebuild_interactions(Algorithm::UniformGrid);
                assert!(retained.work.retained);
                assert_eq!(
                    retained.broad_phase.pairs, reference.broad_phase.pairs,
                    "frame {frame} at {objects} objects"
                );
                assert_eq!(retained.pairs, reference.pairs);
                full_builds += retained.work.full_builds;
                body_updates += retained.work.body_updates;
                reinsertions += retained.work.reinsertions;
                bodies_materialized += retained.work.bodies_materialized;
            }
            let reference = simulation.rebuild_interactions(Algorithm::Naive);
            let retained = simulation.interactions(Algorithm::DynamicAabbTree);
            assert_eq!(retained.broad_phase.pairs, reference.broad_phase.pairs);

            (
                vec![("objects", objects)],
                vec![
                    ("full-builds", full_builds),
                    ("bodies-materialized", bodies_materialized),
                    ("body-updates", body_updates),
                    ("reinsertions", reinsertions),
                ],
            )
        })
        .collect();

    if let Some(dir) = work_evidence_dir() {
        write_work_evidence(&dir, "retained-dynamic-tree-frame-sync", &samples);
        return;
    }
    // Keep these in sync with .performance/contract.json.
    for sample in &samples {
        let objects = sample.0[0].1;
        assert_eq!(metric(sample, "full-builds"), 0, "{objects} objects");
        assert_eq!(
            metric(sample, "bodies-materialized"),
            0,
            "{objects} objects"
        );
        assert_eq!(
            metric(sample, "body-updates"),
            objects * RETAINED_FRAMES,
            "every moving body is updated exactly once per frame"
        );
        assert!(metric(sample, "reinsertions") <= metric(sample, "body-updates"));
        assert!(metric(sample, "body-updates") <= 81_000);
        assert!(metric(sample, "reinsertions") <= 10_125);
    }
    assert_linear("body-updates", &series(&samples, "body-updates"));
    assert_linear("reinsertions", &series(&samples, "reinsertions"));
}
