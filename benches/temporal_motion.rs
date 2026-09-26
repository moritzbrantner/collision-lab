#[path = "support/rapier_retained.rs"]
mod rapier_reference;

use bvh_kernels::DynamicAabbTree;
use collision_lab::{
    Algorithm, Config, InteractionConfig, MotionConfig, MotionKind, Scenario, Simulation,
    run_algorithm,
};
use spatial_kernels::{Body, Pair};
use std::{
    env,
    hint::black_box,
    process,
    time::{Duration, Instant},
};

const DEFAULT_OBJECTS: usize = 3_000;
const DEFAULT_FRAMES: usize = 120;
const DEFAULT_SAMPLES: usize = 5;
const TIMESTEP_SECONDS: f32 = 1.0 / 60.0;

#[derive(Clone, Copy, Debug)]
struct Options {
    objects: usize,
    frames: usize,
    samples: usize,
}

#[derive(Clone, Debug)]
struct Frame {
    bodies: Vec<Body>,
    moving: Vec<(usize, Body)>,
    oracle: Vec<Pair>,
}

#[derive(Clone, Copy, Debug)]
struct Measurement {
    median_frame: Duration,
    p95_frame: Duration,
    aabb_tests_per_frame: Option<u64>,
    reinsertions_per_sample: Option<usize>,
}

fn main() {
    let options = match parse_options(env::args().skip(1)) {
        Ok(Some(options)) => options,
        Ok(None) => return,
        Err(error) => {
            eprintln!("error: {error}\n\n{}", help());
            process::exit(2);
        }
    };

    let config = Config {
        objects: options.objects,
        seed: 0xD1A0_AABB,
        fat_margin: 1.25,
        scenario: Scenario::Clustered,
        ..Config::default()
    };
    let motion = MotionConfig {
        dynamic_fraction: 0.65,
        speed: 9.0,
    };
    let (initial, frames) = prepare_frames(config, motion, options.frames);

    println!("Collision Lab temporal broad-phase benchmark");
    println!("Rapier {}", rapier3d::VERSION);
    println!(
        "objects: {} · frames: {} · samples: {} · dt: {:.4} ms",
        options.objects,
        options.frames,
        options.samples,
        f64::from(TIMESTEP_SECONDS) * 1_000.0
    );
    println!(
        "timing scope: deterministic frames and initial structures excluded; each retained frame includes updates + pair query"
    );
    println!(
        "{:<24} {:>13} {:>13} {:>16} {:>15}",
        "backend", "median ms", "p95 ms", "avg AABB tests", "reinsertions"
    );

    let retained = benchmark_retained_dynamic(config, &initial, &frames, options.samples);
    print_row("dynamic-retained", retained);

    let rebuilt = benchmark_snapshot(Algorithm::DynamicAabbTree, config, &frames, options.samples);
    print_row("dynamic-rebuild", rebuilt);

    let static_bvh = benchmark_snapshot(Algorithm::StaticBvh, config, &frames, options.samples);
    print_row("static-bvh-rebuild", static_bvh);

    let sweep = benchmark_snapshot(Algorithm::SweepAndPrune, config, &frames, options.samples);
    print_row("sweep-and-prune", sweep);

    let rapier = benchmark_retained_rapier(&initial, &frames, options.samples);
    print_row("rapier-retained", rapier);
}

fn prepare_frames(
    config: Config,
    motion: MotionConfig,
    frame_count: usize,
) -> (Vec<Body>, Vec<Frame>) {
    let mut simulation = Simulation::new(config, motion, InteractionConfig::default());
    let initial = simulation.bodies();
    let mut frames = Vec::with_capacity(frame_count);

    for _ in 0..frame_count {
        simulation.step(TIMESTEP_SECONDS);
        let bodies = simulation.bodies();
        let moving = simulation
            .entities()
            .iter()
            .enumerate()
            .filter(|(_, entity)| entity.motion == MotionKind::Dynamic)
            .map(|(index, entity)| (index, entity.body))
            .collect();
        let oracle = run_algorithm(Algorithm::Naive, config, &bodies).pairs;
        frames.push(Frame {
            bodies,
            moving,
            oracle,
        });
    }

    (initial, frames)
}

fn benchmark_retained_dynamic(
    config: Config,
    initial: &[Body],
    frames: &[Frame],
    samples: usize,
) -> Measurement {
    let mut timings = Vec::with_capacity(samples * frames.len());
    let mut expected_tests = None;
    let mut expected_reinsertions = None;

    for _ in 0..samples {
        let mut tree = DynamicAabbTree::new(config.fat_margin);
        for body in initial {
            tree.insert(*body);
        }

        let mut sample_tests = 0_u64;
        let mut sample_reinsertions = 0_usize;
        for frame in frames {
            let started = Instant::now();
            for &(_, body) in &frame.moving {
                sample_reinsertions += usize::from(tree.update(body));
            }
            let result = black_box(tree.overlapping_pairs_result());
            timings.push(started.elapsed());

            assert_eq!(
                result.pairs, frame.oracle,
                "retained dynamic tree diverged from the frame oracle"
            );
            sample_tests = sample_tests.saturating_add(result.stats.aabb_tests);
        }

        if let Some(expected) = expected_tests {
            assert_eq!(sample_tests, expected);
        } else {
            expected_tests = Some(sample_tests);
        }
        if let Some(expected) = expected_reinsertions {
            assert_eq!(sample_reinsertions, expected);
        } else {
            expected_reinsertions = Some(sample_reinsertions);
        }
    }

    measurement(
        timings,
        expected_tests.map(|tests| tests / frames.len() as u64),
        expected_reinsertions,
    )
}

fn benchmark_snapshot(
    algorithm: Algorithm,
    config: Config,
    frames: &[Frame],
    samples: usize,
) -> Measurement {
    let mut timings = Vec::with_capacity(samples * frames.len());
    let mut expected_tests = None;

    for _ in 0..samples {
        let mut sample_tests = 0_u64;
        for frame in frames {
            let started = Instant::now();
            let result = black_box(run_algorithm(algorithm, config, &frame.bodies));
            timings.push(started.elapsed());
            assert_eq!(
                result.pairs,
                frame.oracle,
                "{} diverged from the frame oracle",
                algorithm.as_str()
            );
            sample_tests = sample_tests.saturating_add(result.stats.aabb_tests);
        }

        if let Some(expected) = expected_tests {
            assert_eq!(sample_tests, expected);
        } else {
            expected_tests = Some(sample_tests);
        }
    }

    measurement(
        timings,
        expected_tests.map(|tests| tests / frames.len() as u64),
        None,
    )
}

fn benchmark_retained_rapier(initial: &[Body], frames: &[Frame], samples: usize) -> Measurement {
    let mut timings = Vec::with_capacity(samples * frames.len());

    for _ in 0..samples {
        let mut scene = rapier_reference::prepare_retained_scene(initial);
        for frame in frames {
            let started = Instant::now();
            let pairs = black_box(scene.update_and_detect_pairs(&frame.moving));
            timings.push(started.elapsed());
            assert_eq!(
                pairs, frame.oracle,
                "retained Rapier diverged from the frame oracle"
            );
        }
    }

    measurement(timings, None, None)
}

fn measurement(
    mut timings: Vec<Duration>,
    aabb_tests_per_frame: Option<u64>,
    reinsertions_per_sample: Option<usize>,
) -> Measurement {
    timings.sort_unstable();
    let median_frame = timings[timings.len() / 2];
    let p95_index = (timings.len().saturating_sub(1) * 95) / 100;
    Measurement {
        median_frame,
        p95_frame: timings[p95_index],
        aabb_tests_per_frame,
        reinsertions_per_sample,
    }
}

fn print_row(label: &str, measurement: Measurement) {
    let tests = measurement
        .aabb_tests_per_frame
        .map_or_else(|| "n/a".to_owned(), |value| value.to_string());
    let reinsertions = measurement
        .reinsertions_per_sample
        .map_or_else(|| "n/a".to_owned(), |value| value.to_string());
    println!(
        "{label:<24} {:>13.3} {:>13.3} {tests:>16} {reinsertions:>15}",
        measurement.median_frame.as_secs_f64() * 1_000.0,
        measurement.p95_frame.as_secs_f64() * 1_000.0,
    );
}

fn parse_options(args: impl Iterator<Item = String>) -> Result<Option<Options>, String> {
    let mut options = Options {
        objects: DEFAULT_OBJECTS,
        frames: DEFAULT_FRAMES,
        samples: DEFAULT_SAMPLES,
    };
    let mut args = args.peekable();

    while let Some(flag) = args.next() {
        match flag.as_str() {
            "--objects" => {
                options.objects = parse_positive(&next_value(&mut args, &flag)?, &flag)?;
            }
            "--frames" => {
                options.frames = parse_positive(&next_value(&mut args, &flag)?, &flag)?;
            }
            "--samples" => {
                options.samples = parse_positive(&next_value(&mut args, &flag)?, &flag)?;
            }
            "--smoke" => {
                options.objects = 256;
                options.frames = 20;
                options.samples = 1;
            }
            "--bench" => {}
            "-h" | "--help" => {
                print!("{}", help());
                return Ok(None);
            }
            _ => return Err(format!("unknown option `{flag}`")),
        }
    }

    Ok(Some(options))
}

fn next_value(args: &mut impl Iterator<Item = String>, flag: &str) -> Result<String, String> {
    args.next()
        .ok_or_else(|| format!("missing value for {flag}"))
}

fn parse_positive(value: &str, flag: &str) -> Result<usize, String> {
    let parsed = value
        .parse::<usize>()
        .map_err(|_| format!("invalid value `{value}` for {flag}"))?;
    if parsed == 0 {
        return Err(format!("{flag} must be greater than zero"));
    }
    Ok(parsed)
}

fn help() -> &'static str {
    "Usage: cargo bench --bench temporal_motion -- [options]\n\n\
Options:\n  --objects N   Objects in the clustered moving scene (default: 3000)\n  --frames N    Precomputed 60 Hz frames per sample (default: 120)\n  --samples N   Repetitions of the complete frame sequence (default: 5)\n  --smoke       Run 256 objects, 20 frames, one sample\n  -h, --help    Show this help\n"
}
