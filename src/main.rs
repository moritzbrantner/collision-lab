use collision_lab::{Config, Scenario, run_experiment};
use std::{env, process};

const HELP: &str = "collision-lab — compare broad-phase collision algorithms\n\n\
Usage:\n  cargo run --release -- [options]\n\n\
Options:\n  --objects N          Number of AABBs (default: 10000)\n  --cell-size N        Uniform-grid cell size (default: 2.5)\n  --fat-margin N       Dynamic-tree AABB margin (default: 0.75)\n  --seed N             Deterministic scene seed\n  --world-extent N     Half-width of generated world (default: 100)\n  --half-extent N      Half-size of each generated box (default: 0.5)\n  --scenario NAME      uniform | clustered (default: uniform)\n  -h, --help           Show this help\n";

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    if args.iter().any(|arg| arg == "-h" || arg == "--help") {
        print!("{HELP}");
        return;
    }

    let config = match parse_config(args) {
        Ok(config) => config,
        Err(error) => {
            eprintln!("error: {error}\n\n{HELP}");
            process::exit(2);
        }
    };

    let experiment = run_experiment(config);
    if !experiment.pair_sets_match() {
        eprintln!("ERROR: algorithms produced different pair sets");
        process::exit(1);
    }

    println!("collision-lab");
    println!("-------------");
    println!("scenario:       {}", config.scenario.as_str());
    println!("objects:        {}", experiment.objects);
    println!("possible pairs: {}", experiment.possible_pairs);
    println!("cell size:      {:.3}", config.cell_size);
    println!("fat margin:     {:.3}", config.fat_margin);
    println!("world extent:   {:.3}", config.world_extent);
    println!("half extent:    {:.3}", config.half_extent);
    println!("seed:           {}", config.seed);
    println!();
    println!(
        "algorithm            AABB tests      overlaps      occupied cells      reduction      elapsed"
    );
    for run in &experiment.runs {
        let occupied = run
            .result
            .stats
            .occupied_cells
            .map_or_else(|| "-".to_owned(), |count| count.to_string());
        println!(
            "{:<20} {:>12} {:>13} {:>19} {:>11.3}% {:>10.3} ms",
            run.algorithm.as_str(),
            run.result.stats.aabb_tests,
            run.result.pairs.len(),
            occupied,
            experiment.test_reduction_percent(run),
            run.elapsed.as_secs_f64() * 1000.0,
        );
    }
    println!();
    println!("pair-set parity:       verified");
}

fn parse_config(args: Vec<String>) -> Result<Config, String> {
    let mut config = Config::default();
    let mut args = args.into_iter();

    while let Some(flag) = args.next() {
        match flag.as_str() {
            "--objects" => config.objects = parse(&next_value(&mut args, &flag)?, &flag)?,
            "--cell-size" => config.cell_size = parse(&next_value(&mut args, &flag)?, &flag)?,
            "--fat-margin" => config.fat_margin = parse(&next_value(&mut args, &flag)?, &flag)?,
            "--seed" => config.seed = parse(&next_value(&mut args, &flag)?, &flag)?,
            "--world-extent" => config.world_extent = parse(&next_value(&mut args, &flag)?, &flag)?,
            "--half-extent" => config.half_extent = parse(&next_value(&mut args, &flag)?, &flag)?,
            "--scenario" => config.scenario = Scenario::parse(&next_value(&mut args, &flag)?)?,
            _ => return Err(format!("unknown option `{flag}`")),
        }
    }

    config.validate()
}

fn next_value(args: &mut impl Iterator<Item = String>, flag: &str) -> Result<String, String> {
    args.next()
        .ok_or_else(|| format!("missing value for {flag}"))
}

fn parse<T>(value: &str, flag: &str) -> Result<T, String>
where
    T: std::str::FromStr,
{
    value
        .parse()
        .map_err(|_| format!("invalid value `{value}` for {flag}"))
}
