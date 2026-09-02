use bvh_kernels::{DynamicAabbTreeBroadPhase, StaticBvhBroadPhase};
use octree_kernels::OctreeBroadPhase;
use spatial_kernels::{
    Aabb, Body, BroadPhase, BroadPhaseResult, ColliderId, NaiveBroadPhase, Pair,
    SweepAndPruneBroadPhase, UniformGridBroadPhase,
};
use std::{
    collections::HashMap,
    time::{Duration, Instant},
};

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
    Octree,
    SweepAndPrune,
    StaticBvh,
    DynamicAabbTree,
}

impl Algorithm {
    pub const ALL: [Self; 6] = [
        Self::Naive,
        Self::UniformGrid,
        Self::Octree,
        Self::SweepAndPrune,
        Self::StaticBvh,
        Self::DynamicAabbTree,
    ];

    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "naive" => Ok(Self::Naive),
            "uniform-grid" => Ok(Self::UniformGrid),
            "octree" => Ok(Self::Octree),
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
            Self::Octree => "octree",
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
        if self.half_extent > self.world_extent {
            return Err("half extent must not exceed world extent".to_owned());
        }
        Ok(self)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MotionKind {
    Static,
    Dynamic,
}

impl MotionKind {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Static => "static",
            Self::Dynamic => "dynamic",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MotionConfig {
    pub dynamic_fraction: f32,
    pub speed: f32,
}

impl Default for MotionConfig {
    fn default() -> Self {
        Self {
            dynamic_fraction: 0.35,
            speed: 8.0,
        }
    }
}

impl MotionConfig {
    pub fn validate(self) -> Result<Self, String> {
        if !self.dynamic_fraction.is_finite()
            || self.dynamic_fraction < 0.0
            || self.dynamic_fraction > 1.0
        {
            return Err("dynamic fraction must be finite and between 0 and 1".to_owned());
        }
        if !self.speed.is_finite() || self.speed < 0.0 {
            return Err("motion speed must be non-negative and finite".to_owned());
        }
        Ok(self)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InteractionKind {
    Solid,
    Sensor,
}

impl InteractionKind {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Solid => "solid",
            Self::Sensor => "sensor",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct InteractionConfig {
    pub sensor_fraction: f32,
}

impl Default for InteractionConfig {
    fn default() -> Self {
        Self {
            sensor_fraction: 0.15,
        }
    }
}

impl InteractionConfig {
    pub fn validate(self) -> Result<Self, String> {
        if !self.sensor_fraction.is_finite()
            || self.sensor_fraction < 0.0
            || self.sensor_fraction > 1.0
        {
            return Err("sensor fraction must be finite and between 0 and 1".to_owned());
        }
        Ok(self)
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct CollisionLayer(u32);

impl CollisionLayer {
    pub const WORLD: Self = Self(1 << 0);
    pub const ACTOR: Self = Self(1 << 1);
    pub const ALL: [Self; 2] = [Self::WORLD, Self::ACTOR];

    #[must_use]
    pub const fn from_bits(bits: u32) -> Self {
        assert!(
            bits.is_power_of_two(),
            "a collision layer must contain exactly one bit"
        );
        Self(bits)
    }

    #[must_use]
    pub const fn bits(self) -> u32 {
        self.0
    }

    #[must_use]
    pub const fn index(self) -> usize {
        self.0.trailing_zeros() as usize
    }

    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self.0 {
            1 => "world",
            2 => "actor",
            _ => "custom",
        }
    }
}

/// World-level policy describing which collision-layer pairs are eligible to
/// interact. Pair toggles are symmetric: enabling A×B also enables B×A.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct InteractionMatrix {
    rows: [u32; 32],
}

impl Default for InteractionMatrix {
    fn default() -> Self {
        let mut matrix = Self::empty();
        matrix.set(CollisionLayer::WORLD, CollisionLayer::ACTOR, true);
        matrix.set(CollisionLayer::ACTOR, CollisionLayer::ACTOR, true);
        matrix
    }
}

impl InteractionMatrix {
    #[must_use]
    pub const fn empty() -> Self {
        Self { rows: [0; 32] }
    }

    #[must_use]
    pub fn allows(&self, left: CollisionLayer, right: CollisionLayer) -> bool {
        self.rows[left.index()] & right.bits() != 0
    }

    pub fn set(&mut self, left: CollisionLayer, right: CollisionLayer, allowed: bool) {
        set_row_bit(&mut self.rows[left.index()], right, allowed);
        set_row_bit(&mut self.rows[right.index()], left, allowed);
    }

    #[must_use]
    pub const fn row_bits(&self, layer: CollisionLayer) -> u32 {
        self.rows[layer.index()]
    }
}

fn set_row_bit(row: &mut u32, layer: CollisionLayer, allowed: bool) {
    if allowed {
        *row |= layer.bits();
    } else {
        *row &= !layer.bits();
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SceneEntity {
    pub body: Body,
    pub motion: MotionKind,
    pub interaction: InteractionKind,
    pub layer: CollisionLayer,
    pub velocity: [f32; 3],
}

#[derive(Clone, Debug)]
pub struct Simulation {
    config: Config,
    motion_config: MotionConfig,
    interaction_config: InteractionConfig,
    interaction_matrix: InteractionMatrix,
    entities: Vec<SceneEntity>,
    frame: u64,
}

impl Simulation {
    #[must_use]
    pub fn new(
        config: Config,
        motion_config: MotionConfig,
        interaction_config: InteractionConfig,
    ) -> Self {
        Self::with_matrix(
            config,
            motion_config,
            interaction_config,
            InteractionMatrix::default(),
        )
    }

    #[must_use]
    pub fn with_matrix(
        config: Config,
        motion_config: MotionConfig,
        interaction_config: InteractionConfig,
        interaction_matrix: InteractionMatrix,
    ) -> Self {
        let config = config
            .validate()
            .expect("validated simulation configuration");
        let motion_config = motion_config
            .validate()
            .expect("validated motion configuration");
        let interaction_config = interaction_config
            .validate()
            .expect("validated interaction configuration");
        let bodies = generate_scene(config);
        let mut motion_rng = SplitMix64::new(config.seed ^ 0x4D4F_5449_4F4E_5F31);
        let mut interaction_rng = SplitMix64::new(config.seed ^ 0x494E_5445_5241_4354);
        let entities = bodies
            .into_iter()
            .map(|body| {
                let is_dynamic = motion_rng.unit_f32() < motion_config.dynamic_fraction;
                let motion = if is_dynamic {
                    MotionKind::Dynamic
                } else {
                    MotionKind::Static
                };
                let interaction = if interaction_rng.unit_f32() < interaction_config.sensor_fraction
                {
                    InteractionKind::Sensor
                } else {
                    InteractionKind::Solid
                };
                let layer = default_layer(motion);
                let velocity = if is_dynamic {
                    random_velocity(&mut motion_rng, motion_config.speed)
                } else {
                    [0.0; 3]
                };
                SceneEntity {
                    body,
                    motion,
                    interaction,
                    layer,
                    velocity,
                }
            })
            .collect();

        Self {
            config,
            motion_config,
            interaction_config,
            interaction_matrix,
            entities,
            frame: 0,
        }
    }

    #[must_use]
    pub const fn frame(&self) -> u64 {
        self.frame
    }

    #[must_use]
    pub const fn config(&self) -> Config {
        self.config
    }

    #[must_use]
    pub const fn motion_config(&self) -> MotionConfig {
        self.motion_config
    }

    #[must_use]
    pub const fn interaction_config(&self) -> InteractionConfig {
        self.interaction_config
    }

    #[must_use]
    pub const fn interaction_matrix(&self) -> InteractionMatrix {
        self.interaction_matrix
    }

    pub fn set_layer_interaction(
        &mut self,
        left: CollisionLayer,
        right: CollisionLayer,
        allowed: bool,
    ) {
        self.interaction_matrix.set(left, right, allowed);
    }

    #[must_use]
    pub fn entities(&self) -> &[SceneEntity] {
        &self.entities
    }

    #[must_use]
    pub fn bodies(&self) -> Vec<Body> {
        self.entities.iter().map(|entity| entity.body).collect()
    }

    #[must_use]
    pub fn counts(&self) -> (usize, usize) {
        let dynamic = self
            .entities
            .iter()
            .filter(|entity| entity.motion == MotionKind::Dynamic)
            .count();
        (self.entities.len() - dynamic, dynamic)
    }

    #[must_use]
    pub fn interaction_counts(&self) -> (usize, usize) {
        let sensors = self
            .entities
            .iter()
            .filter(|entity| entity.interaction == InteractionKind::Sensor)
            .count();
        (self.entities.len() - sensors, sensors)
    }

    #[must_use]
    pub fn interactions(&self, algorithm: Algorithm) -> InteractionResult {
        run_interactions(
            algorithm,
            self.config,
            &self.entities,
            &self.interaction_matrix,
        )
    }

    pub fn step(&mut self, dt_seconds: f32) {
        assert!(
            dt_seconds.is_finite() && dt_seconds >= 0.0,
            "simulation timestep must be non-negative and finite"
        );
        if dt_seconds == 0.0 {
            return;
        }

        let half = self.config.half_extent;
        let min_center = -self.config.world_extent + half;
        let max_center = self.config.world_extent - half;

        for entity in &mut self.entities {
            if entity.motion == MotionKind::Static {
                continue;
            }

            let mut center = aabb_center(entity.body.aabb);
            for (axis, coordinate) in center.iter_mut().enumerate() {
                *coordinate += entity.velocity[axis] * dt_seconds;
                if *coordinate < min_center {
                    *coordinate = min_center;
                    entity.velocity[axis] = entity.velocity[axis].abs();
                } else if *coordinate > max_center {
                    *coordinate = max_center;
                    entity.velocity[axis] = -entity.velocity[axis].abs();
                }
            }
            entity.body.aabb = Aabb::from_center_half_extents(center, [half; 3]);
        }

        self.frame = self.frame.saturating_add(1);
    }
}

#[derive(Clone, Debug)]
pub struct InteractionResult {
    pub broad_phase: BroadPhaseResult,
    pub pairs: Vec<Pair>,
    pub sensor_pairs: Vec<Pair>,
    pub filtered_out: usize,
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
                Scenario::Uniform => {
                    random_point(&mut rng, config.world_extent - config.half_extent)
                }
                Scenario::Clustered => {
                    clustered_point(&mut rng, config.world_extent - config.half_extent)
                }
            };
            Body::new(
                u32::try_from(index).expect("object count was validated"),
                Aabb::from_center_half_extents(center, half),
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
        Algorithm::Octree => OctreeBroadPhase::default().detect(bodies),
        Algorithm::SweepAndPrune => SweepAndPruneBroadPhase::default().detect(bodies),
        Algorithm::StaticBvh => StaticBvhBroadPhase.detect(bodies),
        Algorithm::DynamicAabbTree => {
            DynamicAabbTreeBroadPhase::new(config.fat_margin).detect(bodies)
        }
    }
}

#[must_use]
pub fn run_interactions(
    algorithm: Algorithm,
    config: Config,
    entities: &[SceneEntity],
    matrix: &InteractionMatrix,
) -> InteractionResult {
    let bodies: Vec<_> = entities.iter().map(|entity| entity.body).collect();
    let broad_phase = run_algorithm(algorithm, config, &bodies);
    let by_id: HashMap<ColliderId, &SceneEntity> = entities
        .iter()
        .map(|entity| (entity.body.id, entity))
        .collect();

    assert_eq!(
        by_id.len(),
        entities.len(),
        "scene entity collider IDs must be unique"
    );

    let mut pairs = Vec::new();
    let mut sensor_pairs = Vec::new();
    let mut filtered_out = 0;

    for pair in &broad_phase.pairs {
        let left = by_id
            .get(&pair.a)
            .expect("broad-phase pair must reference a scene entity");
        let right = by_id
            .get(&pair.b)
            .expect("broad-phase pair must reference a scene entity");
        if !matrix.allows(left.layer, right.layer) {
            filtered_out += 1;
            continue;
        }

        pairs.push(*pair);
        if left.interaction == InteractionKind::Sensor
            || right.interaction == InteractionKind::Sensor
        {
            sensor_pairs.push(*pair);
        }
    }

    InteractionResult {
        broad_phase,
        pairs,
        sensor_pairs,
        filtered_out,
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

fn default_layer(motion: MotionKind) -> CollisionLayer {
    match motion {
        MotionKind::Static => CollisionLayer::WORLD,
        MotionKind::Dynamic => CollisionLayer::ACTOR,
    }
}

fn aabb_center(aabb: Aabb) -> [f32; 3] {
    [
        (aabb.min[0] + aabb.max[0]) * 0.5,
        (aabb.min[1] + aabb.max[1]) * 0.5,
        (aabb.min[2] + aabb.max[2]) * 0.5,
    ]
}

fn random_point(rng: &mut SplitMix64, extent: f32) -> [f32; 3] {
    [rng.signed(extent), rng.signed(extent), rng.signed(extent)]
}

fn random_velocity(rng: &mut SplitMix64, speed: f32) -> [f32; 3] {
    if speed == 0.0 {
        return [0.0; 3];
    }

    let mut direction = [rng.signed(1.0), rng.signed(1.0), rng.signed(1.0)];
    let length =
        (direction[0] * direction[0] + direction[1] * direction[1] + direction[2] * direction[2])
            .sqrt();
    if length <= f32::EPSILON {
        return [speed, 0.0, 0.0];
    }
    for value in &mut direction {
        *value = *value / length * speed;
    }
    direction
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
        (center[0] * extent + rng.signed(jitter)).clamp(-extent, extent),
        (center[1] * extent + rng.signed(jitter)).clamp(-extent, extent),
        (center[2] * extent + rng.signed(jitter)).clamp(-extent, extent),
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

    fn entity(
        id: ColliderId,
        center: [f32; 3],
        motion: MotionKind,
        interaction: InteractionKind,
        layer: CollisionLayer,
    ) -> SceneEntity {
        SceneEntity {
            body: Body::new(id, Aabb::from_center_half_extents(center, [1.0; 3])),
            motion,
            interaction,
            layer,
            velocity: [0.0; 3],
        }
    }

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
    fn mixed_motion_and_interaction_generation_is_deterministic() {
        let config = Config {
            objects: 64,
            seed: 123,
            ..Config::default()
        };
        let motion = MotionConfig {
            dynamic_fraction: 0.5,
            speed: 3.0,
        };
        let interaction = InteractionConfig {
            sensor_fraction: 0.25,
        };
        let left = Simulation::new(config, motion, interaction);
        let right = Simulation::new(config, motion, interaction);
        assert_eq!(left.entities(), right.entities());
        assert_eq!(left.counts(), right.counts());
        assert_eq!(left.interaction_counts(), right.interaction_counts());
        assert_eq!(left.interaction_matrix(), right.interaction_matrix());
    }

    #[test]
    fn static_entities_do_not_move_while_dynamic_entities_do() {
        let config = Config {
            objects: 32,
            seed: 9,
            world_extent: 100.0,
            ..Config::default()
        };
        let mut simulation = Simulation::new(
            config,
            MotionConfig {
                dynamic_fraction: 0.5,
                speed: 4.0,
            },
            InteractionConfig::default(),
        );
        let before = simulation.entities().to_vec();
        simulation.step(0.25);
        let after = simulation.entities();

        for (before, after) in before.iter().zip(after) {
            if before.motion == MotionKind::Static {
                assert_eq!(before.body, after.body);
            } else {
                assert_ne!(before.body, after.body);
            }
            assert_eq!(before.interaction, after.interaction);
            assert_eq!(before.layer, after.layer);
        }
    }

    #[test]
    fn moving_entities_remain_inside_world_bounds() {
        let config = Config {
            objects: 24,
            seed: 19,
            world_extent: 5.0,
            half_extent: 0.75,
            ..Config::default()
        };
        let mut simulation = Simulation::new(
            config,
            MotionConfig {
                dynamic_fraction: 1.0,
                speed: 12.0,
            },
            InteractionConfig::default(),
        );
        for _ in 0..200 {
            simulation.step(1.0 / 30.0);
            for entity in simulation.entities() {
                for axis in 0..3 {
                    assert!(entity.body.aabb.min[axis] >= -config.world_extent);
                    assert!(entity.body.aabb.max[axis] <= config.world_extent);
                }
            }
        }
    }

    #[test]
    fn default_interaction_matrix_matches_world_actor_policy() {
        let matrix = InteractionMatrix::default();
        assert!(!matrix.allows(CollisionLayer::WORLD, CollisionLayer::WORLD));
        assert!(matrix.allows(CollisionLayer::WORLD, CollisionLayer::ACTOR));
        assert!(matrix.allows(CollisionLayer::ACTOR, CollisionLayer::WORLD));
        assert!(matrix.allows(CollisionLayer::ACTOR, CollisionLayer::ACTOR));
    }

    #[test]
    fn interaction_matrix_updates_are_symmetric() {
        let projectile = CollisionLayer::from_bits(1 << 2);
        let mut matrix = InteractionMatrix::empty();
        matrix.set(CollisionLayer::ACTOR, projectile, true);
        assert!(matrix.allows(CollisionLayer::ACTOR, projectile));
        assert!(matrix.allows(projectile, CollisionLayer::ACTOR));
        matrix.set(projectile, CollisionLayer::ACTOR, false);
        assert!(!matrix.allows(CollisionLayer::ACTOR, projectile));
        assert!(!matrix.allows(projectile, CollisionLayer::ACTOR));
    }

    #[test]
    fn interaction_kind_is_orthogonal_to_layer_filtering() {
        let solid = entity(
            1,
            [0.0; 3],
            MotionKind::Dynamic,
            InteractionKind::Solid,
            CollisionLayer::ACTOR,
        );
        let sensor = entity(
            2,
            [0.5, 0.0, 0.0],
            MotionKind::Dynamic,
            InteractionKind::Sensor,
            CollisionLayer::ACTOR,
        );
        let matrix = InteractionMatrix::default();
        let result = run_interactions(
            Algorithm::Naive,
            Config::default(),
            &[solid, sensor],
            &matrix,
        );
        assert_eq!(result.pairs, vec![Pair::new(1, 2)]);
        assert_eq!(result.sensor_pairs, vec![Pair::new(1, 2)]);
    }

    #[test]
    fn interaction_matrix_filters_overlapping_world_pairs() {
        let entities = [
            entity(
                1,
                [0.0; 3],
                MotionKind::Static,
                InteractionKind::Solid,
                CollisionLayer::WORLD,
            ),
            entity(
                2,
                [0.5, 0.0, 0.0],
                MotionKind::Static,
                InteractionKind::Solid,
                CollisionLayer::WORLD,
            ),
            entity(
                3,
                [0.25, 0.0, 0.0],
                MotionKind::Dynamic,
                InteractionKind::Solid,
                CollisionLayer::ACTOR,
            ),
        ];
        let matrix = InteractionMatrix::default();
        let result = run_interactions(Algorithm::Naive, Config::default(), &entities, &matrix);
        assert_eq!(result.broad_phase.pairs.len(), 3);
        assert_eq!(result.filtered_out, 1);
        assert_eq!(result.pairs, vec![Pair::new(1, 3), Pair::new(2, 3)]);
    }

    #[test]
    fn custom_world_matrix_changes_interactions_without_changing_entities() {
        let entities = [
            entity(
                1,
                [0.0; 3],
                MotionKind::Static,
                InteractionKind::Solid,
                CollisionLayer::WORLD,
            ),
            entity(
                2,
                [0.5, 0.0, 0.0],
                MotionKind::Static,
                InteractionKind::Solid,
                CollisionLayer::WORLD,
            ),
        ];
        let mut matrix = InteractionMatrix::default();
        let before = run_interactions(Algorithm::Naive, Config::default(), &entities, &matrix);
        assert!(before.pairs.is_empty());
        matrix.set(CollisionLayer::WORLD, CollisionLayer::WORLD, true);
        let after = run_interactions(Algorithm::Naive, Config::default(), &entities, &matrix);
        assert_eq!(after.pairs, vec![Pair::new(1, 2)]);
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
    fn broad_phases_match_during_motion() {
        let config = Config {
            objects: 128,
            seed: 73,
            cell_size: 3.0,
            scenario: Scenario::Clustered,
            ..Config::default()
        };
        let mut simulation = Simulation::new(
            config,
            MotionConfig::default(),
            InteractionConfig::default(),
        );
        for _ in 0..20 {
            simulation.step(1.0 / 30.0);
            let bodies = simulation.bodies();
            let expected = run_algorithm(Algorithm::Naive, config, &bodies).pairs;
            for algorithm in Algorithm::ALL.into_iter().skip(1) {
                assert_eq!(run_algorithm(algorithm, config, &bodies).pairs, expected);
            }
        }
    }

    #[test]
    fn filtered_interactions_match_across_broad_phases() {
        let config = Config {
            objects: 128,
            seed: 731,
            cell_size: 3.0,
            scenario: Scenario::Clustered,
            ..Config::default()
        };
        let mut simulation = Simulation::new(
            config,
            MotionConfig::default(),
            InteractionConfig::default(),
        );
        for _ in 0..10 {
            simulation.step(1.0 / 30.0);
            let expected = simulation.interactions(Algorithm::Naive);
            for algorithm in Algorithm::ALL.into_iter().skip(1) {
                let actual = simulation.interactions(algorithm);
                assert_eq!(actual.pairs, expected.pairs, "algorithm {algorithm:?}");
                assert_eq!(
                    actual.sensor_pairs, expected.sensor_pairs,
                    "algorithm {algorithm:?}"
                );
            }
        }
    }

    #[test]
    fn simulation_matrix_can_change_without_regenerating_scene() {
        let config = Config {
            objects: 64,
            seed: 1001,
            scenario: Scenario::Clustered,
            ..Config::default()
        };
        let mut simulation = Simulation::new(
            config,
            MotionConfig::default(),
            InteractionConfig::default(),
        );
        let before_entities = simulation.entities().to_vec();
        simulation.set_layer_interaction(CollisionLayer::WORLD, CollisionLayer::WORLD, true);
        assert_eq!(simulation.entities(), before_entities);
        assert!(
            simulation
                .interaction_matrix()
                .allows(CollisionLayer::WORLD, CollisionLayer::WORLD)
        );
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
