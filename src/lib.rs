use bvh_kernels::{DynamicAabbTreeBroadPhase, StaticBvhBroadPhase};
use spatial_kernels::{
    Body, BroadPhase, BroadPhaseResult, NaiveBroadPhase, SweepAndPruneBroadPhase,
    UniformGridBroadPhase,
};
use std::time::{Duration, Instant};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Scenario {
    Uniform,
    Clustered,
}

impl Scenario {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "uniform" => Ok(Self::Uniform),
            "clustered" => Ok(Self::Clustered),
            other => Err(format!(
                "unknown scenario `{other}`; expected uniform or clustered"
            )),
        }
    }

    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Uniform => "uniform",
            Self::Clustered => "clustered",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Algorithm {
    Naive,
    UniformGrid,
    SweepAndPrune,
    StaticBvh,
    DynamicAabbTree,
}

impl Algorithm {
    pub const ALL: [Self; 5] = [
        Self::Naive,
        Self::UniformGrid,
        Self::SweepAndPrune,
        Self::StaticBvh,
        Self::DynamicAabbTree,
    ];

    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "naive" => Ok(Self::Naive),
            "uniform-grid" => Ok(Self::UniformGrid),
            "sweep-and-prune" => Ok(Self::SweepAndPrune),
            "static-bvh" => Ok(Self::StaticBvh),
            "dynamic-aabb-tree" => Ok(Self::DynamicAabbTree),
            other => Err(format!("unknown algorithm `{other}`")),
        }
    }

    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Naive => "naive",
            Self::UniformGrid => "uniform-grid",
            Self::SweepAndPrune => "sweep-and-prune",
            Self::StaticBvh => "static-bvh",
            Self::DynamicAabbTree => "dynamic-aabb-tree",
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Config {
    pub objects: usize,
    pub cell_size: f32,
    pub fat_margin: f32,
    pub seed: u64,
    pub world_extent: f32,
    pub half_extent: f32,
    pub scenario: Scenario,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            objects: 10_000,
            cell_size: 2.5,
            fat_margin: 0.75,
            seed: 0x0C01_11D3,
            world_extent: 100.0,
            half_extent: 0.5,
            scenario: Scenario::Uniform,
        }
    }
}

impl Config {
    pub fn validate(self) -> Result<Self, String> {
        if self.objects > u32::MAX as usize {
            return Err("object count must fit into a u32 collider ID".to_owned());
        }
        if !self.cell_size.is_finite() || self.cell_size <= 0.0 {
            return Err("cell size must be positive and finite".to_owned());
        }
        if !self.fat_margin.is_finite() || self.fat_margin < 0.0 {
            return Err("fat margin must be non-negative and finite".to_owned());
        }
        if !self.world_extent.is_finite() || self.world_extent <= 0.0 {
            return Err("world extent must be positive and finite".to_owned());
        }
        if !self.half_extent.is_finite() || self.half_extent < 0.0 {
            return Err("half extent must be non-negative and finite".to_owned());
        }
        Ok(self)
    }
}

#[derive(Clone, Debug)]
pub struct TimedRun {
    pub algorithm: Algorithm,
    pub result: BroadPhaseResult,
    pub elapsed: Duration,
}

#[derive(Clone, Debug)]
pub struct Experiment {
    pub objects: usize,
    pub possible_pairs: u64,
    pub runs: Vec<TimedRun>,
}

impl Experiment {
    #[must_use]
    pub fn pair_sets_match(&self) -> bool {
        let Some(reference) = self.runs.first() else {
            return true;
        };
        self.runs
            .iter()
            .all(|run| run.result.pairs == reference.result.pairs)
    }

    #[must_use]
    pub fn test_reduction_percent(&self, run: &TimedRun) -> f64 {
        let Some(reference) = self.runs.first() else {
            return 0.0;
        };
        let baseline = reference.result.stats.aabb_tests;
        if baseline == 0 {
            0.0
        } else {
            100.0 * (1.0 - run.result.stats.aabb_tests as f64 / baseline as f64)
        }
    }
}

#[must_use]
pub fn generate_scene(config: Config) -> Vec<Body> {
    let config = config.validate().expect("validated scene configuration");
    let mut rng = SplitMix64::new(config.seed);
    let half = [config.half_extent; 3];

    (0..config.objects)
        .map(|index| {
            let center = match config.scenario {
                Scenario::Uniform => random_point(&mut rng, config.world_extent),
                Scenario::Clustered => clustered_point(&mut rng, config.world_extent),
            };
            Body::new(
                u32::try_from(index).expect("object count was validated"),
                spatial_kernels::Aabb::from_center_half_extents(center, half),
            )
        })
        .collect()
}

#[must_use]
pub fn run_algorithm(algorithm: Algorithm, config: Config, bodies: &[Body]) -> BroadPhaseResult {
    let config = config
        .validate()
        .expect("validated experiment configuration");
    match algorithm {
        Algorithm::Naive => NaiveBroadPhase.detect(bodies),
        Algorithm::UniformGrid => UniformGridBroadPhase::new(config.cell_size).detect(bodies),
        Algorithm::SweepAndPrune => SweepAndPruneBroadPhase::default().detect(bodies),
        Algorithm::StaticBvh => StaticBvhBroadPhase.detect(bodies),
        Algorithm::DynamicAabbTree => {
            DynamicAabbTreeBroadPhase::new(config.fat_margin).detect(bodies)
        }
    }
}

#[must_use]
pub fn run_experiment(config: Config) -> Experiment {
    let config = config
        .validate()
        .expect("validated experiment configuration");
    let bodies = generate_scene(config);
    let runs = Algorithm::ALL
        .into_iter()
        .map(|algorithm| {
            let started = Instant::now();
            let result = run_algorithm(algorithm, config, &bodies);
            TimedRun {
                algorithm,
                result,
                elapsed: started.elapsed(),
            }
        })
        .collect();

    let possible_pairs =
        (config.objects as u64).saturating_mul(config.objects.saturating_sub(1) as u64) / 2;

    Experiment {
        objects: config.objects,
        possible_pairs,
        runs,
    }
}

fn random_point(rng: &mut SplitMix64, extent: f32) -> [f32; 3] {
    [rng.signed(extent), rng.signed(extent), rng.signed(extent)]
}

fn clustered_point(rng: &mut SplitMix64, extent: f32) -> [f32; 3] {
    const CENTERS: [[f32; 3]; 8] = [
        [-0.6, -0.6, -0.6],
        [-0.6, -0.6, 0.6],
        [-0.6, 0.6, -0.6],
        [-0.6, 0.6, 0.6],
        [0.6, -0.6, -0.6],
        [0.6, -0.6, 0.6],
        [0.6, 0.6, -0.6],
        [0.6, 0.6, 0.6],
    ];
    let center = CENTERS[(rng.next_u64() as usize) % CENTERS.len()];
    let jitter = extent * 0.08;
    [
        center[0] * extent + rng.signed(jitter),
        center[1] * extent + rng.signed(jitter),
        center[2] * extent + rng.signed(jitter),
    ]
}

#[derive(Clone, Copy, Debug)]
struct SplitMix64 {
    state: u64,
}

impl SplitMix64 {
    const fn new(seed: u64) -> Self {
        Self { state: seed }
    }

    fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    fn unit_f32(&mut self) -> f32 {
        let mantissa = (self.next_u64() >> 40) as u32;
        mantissa as f32 / (1_u32 << 24) as f32
    }

    fn signed(&mut self, extent: f32) -> f32 {
        (self.unit_f32() * 2.0 - 1.0) * extent
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scene_generation_is_deterministic() {
        let config = Config {
            objects: 8,
            seed: 42,
            ..Config::default()
        };
        assert_eq!(generate_scene(config), generate_scene(config));
    }

    #[test]
    fn every_broad_phase_matches_naive_on_generated_scenes() {
        for scenario in [Scenario::Uniform, Scenario::Clustered] {
            let experiment = run_experiment(Config {
                objects: 256,
                seed: 7,
                cell_size: 3.0,
                scenario,
                ..Config::default()
            });
            assert!(
                experiment.pair_sets_match(),
                "scenario {}",
                scenario.as_str()
            );
        }
    }

    #[test]
    fn optimized_algorithms_reduce_work_in_sparse_scene() {
        let experiment = run_experiment(Config {
            objects: 512,
            seed: 99,
            world_extent: 500.0,
            cell_size: 2.0,
            ..Config::default()
        });
        assert!(experiment.pair_sets_match());
        let naive_tests = experiment.runs[0].result.stats.aabb_tests;
        for run in &experiment.runs[1..] {
            assert!(
                run.result.stats.aabb_tests < naive_tests,
                "{:?}",
                run.algorithm
            );
        }
    }
}
