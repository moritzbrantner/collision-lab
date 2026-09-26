#[path = "support/rapier.rs"]
mod rapier_reference;

use collision_lab::{Algorithm, Config, Scenario, generate_scene, run_algorithm};
use std::{
    env,
    hint::black_box,
    process,
    time::{Duration, Instant},
};

const DEFAULT_OBJECTS: usize = 3_000;
const DEFAULT_SAMPLES: usize = 9;
const SMOKE_OBJECTS: usize = 128;

#[derive(Clone, Copy, Debug)]
struct Options {
    objects: usize,
    samples: usize,
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

    println!("Collision Lab native scenario benchmark");
    println!("Rapier {}", rapier3d::VERSION);
    println!(
        "objects: {} · samples: {}",
        options.objects, options.samples
    );
    println!(
        "timing scope: scene generation and Rapier collider conversion excluded; acceleration build, collision detection, and pair extraction included"
    );

    for scenario in [Scenario::Uniform, Scenario::Clustered] {
        run_scenario(scenario, options);
    }
}

fn run_scenario(scenario: Scenario, options: Options) {
    let config = Config {
        objects: options.objects,
        seed: 42,
        scenario,
        ..Config::default()
    };
    let bodies = generate_scene(config);
    let oracle = run_algorithm(Algorithm::Naive, config, &bodies).pairs;

    println!();
    println!("scenario: {}", scenario.as_str());
    println!(
        "{:<20} {:>12} {:>12} {:>10}",
        "backend", "overlaps", "median ms", "parity"
    );

    for algorithm in Algorithm::ALL {
        let (elapsed, overlaps) =
            benchmark_collision_lab(algorithm, config, &bodies, &oracle, options.samples);
        print_row(algorithm.as_str(), overlaps, elapsed, true);
    }

    let (elapsed, pairs) = benchmark_rapier(&bodies, options.samples);
    let parity = pairs == oracle;
    print_row("rapier", pairs.len(), elapsed, parity);
    assert!(
        parity,
        "Rapier pair set diverged from the naive Collision Lab oracle for scenario {}",
        scenario.as_str()
    );
}

fn benchmark_collision_lab(
    algorithm: Algorithm,
    config: Config,
    bodies: &[spatial_kernels::Body],
    oracle: &[spatial_kernels::Pair],
    samples: usize,
) -> (Duration, usize) {
    let mut timings = Vec::with_capacity(samples);
    let mut overlaps = 0;

    for _ in 0..samples {
        let started = Instant::now();
        let result = black_box(run_algorithm(algorithm, config, bodies));
        timings.push(started.elapsed());
        assert_eq!(
            result.pairs,
            oracle,
            "{} diverged from the naive oracle",
            algorithm.as_str()
        );
        overlaps = result.pairs.len();
    }

    (median(timings), overlaps)
}

fn benchmark_rapier(
    bodies: &[spatial_kernels::Body],
    samples: usize,
) -> (Duration, Vec<spatial_kernels::Pair>) {
    let mut timings = Vec::with_capacity(samples);
    let mut last_pairs = Vec::new();

    for _ in 0..samples {
        let prepared = rapier_reference::prepare_scene(bodies);
        let started = Instant::now();
        let pairs = black_box(rapier_reference::detect_pairs(prepared));
        timings.push(started.elapsed());
        last_pairs = pairs;
    }

    (median(timings), last_pairs)
}

fn median(mut timings: Vec<Duration>) -> Duration {
    timings.sort_unstable();
    timings[timings.len() / 2]
}

fn print_row(backend: &str, overlaps: usize, elapsed: Duration, parity: bool) {
    println!(
        "{backend:<20} {overlaps:>12} {:>12.3} {:>10}",
        elapsed.as_secs_f64() * 1_000.0,
        if parity { "verified" } else { "FAILED" },
    );
}

fn parse_options(args: impl Iterator<Item = String>) -> Result<Option<Options>, String> {
    let mut options = Options {
        objects: DEFAULT_OBJECTS,
        samples: DEFAULT_SAMPLES,
    };
    let mut args = args.peekable();

    while let Some(flag) = args.next() {
        match flag.as_str() {
            "--objects" => {
                options.objects = parse_positive(&next_value(&mut args, &flag)?, &flag)?;
            }
            "--samples" => {
                options.samples = parse_positive(&next_value(&mut args, &flag)?, &flag)?;
            }
            "--smoke" => {
                options.objects = SMOKE_OBJECTS;
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
    "Usage: cargo bench --bench rapier_scenarios -- [options]\n\n\
Options:\n  --objects N   Objects per uniform/clustered scenario (default: 3000)\n  --samples N   Samples per backend; median is reported (default: 9)\n  --smoke       Run a single 128-object sample for quick validation\n  -h, --help    Show this help\n"
}
