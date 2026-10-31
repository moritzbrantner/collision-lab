mod arena;
mod collision;
mod flow_field;
mod math;
mod navigation;
mod rng;
mod simulation;
mod snapshot;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod work_complexity;

use std::collections::BTreeSet;

use arena::arena_walls;
use collision_lab::Algorithm;
use flow_field::FlowField;
use navigation::Cell;
use rng::SplitMix64;
use spatial_kernels::{Body, Pair};
use wasm_bindgen::prelude::*;

#[cfg(test)]
use arena::wall;
#[cfg(test)]
use collision::{is_supported, segment_aabb_toi};
#[cfg(test)]
use navigation::{astar, blocked_navigation_cells, cell_to_world, world_to_cell};
#[cfg(test)]
use simulation::local_separation;
#[cfg(test)]
use spatial_kernels::Aabb;

const FIXED_DT: f32 = 1.0 / 60.0;
const WORLD_HALF: f32 = 14.0;
const PLAYER_ID: u32 = 1;
const PLAYER_HALF: [f32; 3] = [0.38, 0.9, 0.38];
const PLAYER_SPEED: f32 = 5.8;
const PLAYER_MAX_HEALTH: f32 = 100.0;
const PLAYER_HIT_DAMAGE: f32 = 10.0;
const PLAYER_HIT_COOLDOWN: f32 = 0.45;
const JUMP_IMPULSE: f32 = 7.4;
const GRAVITY: f32 = -18.0;
const ZOMBIE_HALF: [f32; 3] = [0.4, 0.82, 0.4];
const ZOMBIE_SPEED: f32 = 2.25;
const ZOMBIE_MAX_HEALTH: f32 = 3.0;
const ZOMBIE_SEPARATION_RADIUS: f32 = 1.45;
const ZOMBIE_SEPARATION_WEIGHT: f32 = 0.58;
const ZOMBIE_BARRICADE_DPS: f32 = 32.0;
const BARRICADE_ATTACK_REACH: f32 = 0.18;
const BULLET_RADIUS: f32 = 0.08;
const BULLET_SPEED: f32 = 36.0;
const BULLET_LIFETIME: f32 = 1.2;
const FIRE_INTERVAL: f32 = 0.2;
const BROAD_PHASE_CELL_SIZE: f32 = 1.75;
const BROAD_PHASE_FAT_MARGIN: f32 = 0.35;
const INITIAL_ZOMBIES: usize = 16;
const MAX_ZOMBIES: usize = 64;
const SPAWN_INTERVAL_FRAMES: u64 = 150;
const NAV_CELL: f32 = 1.0;
const NAV_MIN: i32 = -13;
const NAV_MAX: i32 = 13;
const PATH_REPLAN_FRAMES: u64 = 18;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum NavigationMode {
    Astar,
    FlowField,
}

impl NavigationMode {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "astar" => Ok(Self::Astar),
            "flow-field" => Ok(Self::FlowField),
            other => Err(format!(
                "unknown navigation mode `{other}`; expected astar or flow-field"
            )),
        }
    }

    const fn as_str(self) -> &'static str {
        match self {
            Self::Astar => "astar",
            Self::FlowField => "flow-field",
        }
    }
}

#[derive(Clone, Copy, Debug)]
struct Player {
    position: [f32; 3],
    velocity: [f32; 3],
    aim: [f32; 3],
    health: f32,
    grounded: bool,
}

#[derive(Clone, Debug)]
struct Zombie {
    id: u32,
    position: [f32; 3],
    health: f32,
    path: Vec<Cell>,
    path_cursor: usize,
    path_goal: Option<Cell>,
    next_replan_frame: u64,
}

#[derive(Clone, Copy, Debug)]
struct Wall {
    id: u32,
    position: [f32; 3],
    half: [f32; 3],
    low: bool,
    health: f32,
    max_health: f32,
    destructible: bool,
}

#[derive(Clone, Copy, Debug)]
struct Bullet {
    id: u32,
    position: [f32; 3],
    previous_position: [f32; 3],
    velocity: [f32; 3],
    ttl: f32,
}

#[derive(Clone, Copy, Debug)]
struct SweepDebug {
    from: [f32; 3],
    to: [f32; 3],
    hit: Option<[f32; 3]>,
    hit_kind: Option<&'static str>,
}

#[derive(Clone, Debug, Default)]
struct FrameMetrics {
    possible_pairs: u64,
    aabb_tests: u64,
    occupied_cells: usize,
    overlaps: usize,
    overlap_pairs: Vec<Pair>,
    ccd_tests: u64,
    ccd_hits: u64,
    path_replans: u64,
    path_expanded: u64,
    path_found: u64,
    destroyed_barricades: u64,
    steering_adjustments: u64,
    flow_field_builds: u64,
    flow_field_expanded: u64,
    flow_field_followers: u64,
}

#[wasm_bindgen]
pub struct ZombieArena3dWorld {
    algorithm: Algorithm,
    navigation_mode: NavigationMode,
    flow_field: Option<FlowField>,
    blocked_navigation: BTreeSet<Cell>,
    zombie_position_scratch: Vec<[f32; 3]>,
    flow_target_scratch: Vec<Option<[f32; 3]>>,
    bullet_survivor_scratch: Vec<Bullet>,
    collision_body_scratch: Vec<Body>,
    barricade_damage_scratch: Vec<f32>,
    seed: u64,
    rng: SplitMix64,
    player: Player,
    zombies: Vec<Zombie>,
    walls: Vec<Wall>,
    bullets: Vec<Bullet>,
    sweeps: Vec<SweepDebug>,
    metrics: FrameMetrics,
    frame: u64,
    next_zombie_id: u32,
    next_bullet_id: u32,
    fire_cooldown: f32,
    player_hit_cooldown: f32,
    kills: u32,
    shots: u32,
    jumps: u32,
    path_replans_total: u64,
    path_expanded_total: u64,
    destroyed_barricades_total: u64,
    flow_field_builds_total: u64,
    navigation_cache_rebuilds_total: u64,
    game_over: bool,
}

#[wasm_bindgen]
impl ZombieArena3dWorld {
    #[wasm_bindgen(constructor)]
    pub fn new(algorithm: &str, seed: u32) -> Result<ZombieArena3dWorld, JsValue> {
        let algorithm = Algorithm::parse(algorithm).map_err(|error| JsValue::from_str(&error))?;
        Ok(Self::new_inner(algorithm, u64::from(seed)))
    }

    pub fn snapshot_json(&self) -> Result<String, JsValue> {
        self.snapshot()
            .map_err(|error| JsValue::from_str(&error.to_string()))
    }

    pub fn set_algorithm(&mut self, algorithm: &str) -> Result<String, JsValue> {
        self.algorithm = Algorithm::parse(algorithm).map_err(|error| JsValue::from_str(&error))?;
        self.refresh_collision_metrics();
        self.snapshot_json()
    }

    pub fn set_navigation_mode(&mut self, mode: &str) -> Result<String, JsValue> {
        let next = NavigationMode::parse(mode).map_err(|error| JsValue::from_str(&error))?;
        if self.navigation_mode != next {
            self.navigation_mode = next;
            self.invalidate_navigation();
        }
        self.snapshot_json()
    }

    #[allow(clippy::too_many_arguments)]
    pub fn step_json(
        &mut self,
        move_x: f32,
        move_z: f32,
        aim_x: f32,
        aim_y: f32,
        aim_z: f32,
        jump: bool,
        shoot: bool,
    ) -> Result<String, JsValue> {
        let values = [move_x, move_z, aim_x, aim_y, aim_z];
        if values.iter().any(|value| !value.is_finite()) {
            return Err(JsValue::from_str("arena input must be finite"));
        }
        self.step([move_x, move_z], [aim_x, aim_y, aim_z], jump, shoot);
        self.snapshot_json()
    }
}

impl ZombieArena3dWorld {
    fn new_inner(algorithm: Algorithm, seed: u64) -> Self {
        let mut world = Self {
            algorithm,
            navigation_mode: NavigationMode::Astar,
            flow_field: None,
            blocked_navigation: BTreeSet::new(),
            zombie_position_scratch: Vec::new(),
            flow_target_scratch: Vec::new(),
            bullet_survivor_scratch: Vec::new(),
            collision_body_scratch: Vec::new(),
            barricade_damage_scratch: Vec::new(),
            seed,
            rng: SplitMix64::new(seed ^ 0x5A33_445F_4152_454E),
            player: Player {
                position: [0.0, PLAYER_HALF[1], 0.0],
                velocity: [0.0, 0.0, 0.0],
                aim: [0.0, 0.0, -1.0],
                health: PLAYER_MAX_HEALTH,
                grounded: true,
            },
            zombies: Vec::new(),
            walls: arena_walls(),
            bullets: Vec::new(),
            sweeps: Vec::new(),
            metrics: FrameMetrics::default(),
            frame: 0,
            next_zombie_id: 2_000,
            next_bullet_id: 20_000,
            fire_cooldown: 0.0,
            player_hit_cooldown: 0.0,
            kills: 0,
            shots: 0,
            jumps: 0,
            path_replans_total: 0,
            path_expanded_total: 0,
            destroyed_barricades_total: 0,
            flow_field_builds_total: 0,
            navigation_cache_rebuilds_total: 0,
            game_over: false,
        };
        world.invalidate_navigation();
        for _ in 0..INITIAL_ZOMBIES {
            world.spawn_zombie();
        }
        world.replan_all_zombies();
        world.refresh_collision_metrics();
        world
    }
}
