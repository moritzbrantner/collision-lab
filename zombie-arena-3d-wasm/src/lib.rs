mod flow_field;
mod navigation;

use std::collections::BTreeSet;

use collision_lab::{Algorithm, Config, Scenario, run_algorithm};
use flow_field::FlowField;
use navigation::{Cell, astar};
use serde_json::json;
use spatial_kernels::{Aabb, Body, Pair};
use wasm_bindgen::prelude::*;

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

#[derive(Clone, Copy, Debug)]
enum BulletHit {
    Wall,
    Zombie(usize),
}

#[wasm_bindgen]
pub struct ZombieArena3dWorld {
    algorithm: Algorithm,
    navigation_mode: NavigationMode,
    flow_field: Option<FlowField>,
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
            game_over: false,
        };
        for _ in 0..INITIAL_ZOMBIES {
            world.spawn_zombie();
        }
        world.replan_all_zombies();
        world.refresh_collision_metrics();
        world
    }

    fn step(&mut self, movement: [f32; 2], aim: [f32; 3], jump: bool, shoot: bool) {
        if self.game_over {
            return;
        }

        self.frame = self.frame.saturating_add(1);
        self.fire_cooldown = (self.fire_cooldown - FIXED_DT).max(0.0);
        self.player_hit_cooldown = (self.player_hit_cooldown - FIXED_DT).max(0.0);
        self.metrics.ccd_tests = 0;
        self.metrics.ccd_hits = 0;
        self.metrics.path_replans = 0;
        self.metrics.path_expanded = 0;
        self.metrics.path_found = 0;
        self.metrics.destroyed_barricades = 0;
        self.metrics.steering_adjustments = 0;
        self.metrics.flow_field_builds = 0;
        self.metrics.flow_field_expanded = 0;
        self.metrics.flow_field_followers = 0;
        self.sweeps.clear();

        if let Some(direction) = normalize3(aim) {
            self.player.aim = direction;
        }

        self.move_player(movement, jump);
        if shoot && self.fire_cooldown <= 0.0 {
            self.fire();
            self.fire_cooldown = FIRE_INTERVAL;
        }

        self.step_zombies();
        self.step_bullets();
        self.resolve_actor_overlaps();
        self.attack_barricades();

        if self.frame % SPAWN_INTERVAL_FRAMES == 0 && self.zombies.len() < MAX_ZOMBIES {
            self.spawn_zombie();
        }

        self.refresh_collision_metrics();
    }

    fn move_player(&mut self, movement: [f32; 2], jump: bool) {
        let movement = normalize2_or_zero(movement);
        let horizontal_delta = [
            movement[0] * PLAYER_SPEED * FIXED_DT,
            0.0,
            movement[1] * PLAYER_SPEED * FIXED_DT,
        ];
        self.player.position = move_with_sliding_3d(
            self.player.position,
            PLAYER_HALF,
            horizontal_delta,
            &self.walls,
        );

        self.player.grounded = is_supported(self.player.position, PLAYER_HALF, &self.walls);
        if jump && self.player.grounded {
            self.player.velocity[1] = JUMP_IMPULSE;
            self.player.grounded = false;
            self.jumps = self.jumps.saturating_add(1);
        }

        self.player.velocity[1] += GRAVITY * FIXED_DT;
        let (next_y, hit_vertical) = move_vertical(
            self.player.position,
            PLAYER_HALF,
            self.player.velocity[1] * FIXED_DT,
            &self.walls,
        );
        self.player.position[1] = next_y;
        if hit_vertical {
            self.player.velocity[1] = 0.0;
        }
        self.player.grounded = is_supported(self.player.position, PLAYER_HALF, &self.walls);
    }

    fn fire(&mut self) {
        let muzzle_origin = [
            self.player.position[0],
            self.player.position[1] + 0.28,
            self.player.position[2],
        ];
        let muzzle = add3(muzzle_origin, scale3(self.player.aim, 0.62));
        self.bullets.push(Bullet {
            id: self.next_bullet_id,
            position: muzzle,
            previous_position: muzzle,
            velocity: scale3(self.player.aim, BULLET_SPEED),
            ttl: BULLET_LIFETIME,
        });
        self.next_bullet_id = self.next_bullet_id.saturating_add(1);
        self.shots = self.shots.saturating_add(1);
    }

    fn step_zombies(&mut self) {
        let blocked = blocked_navigation_cells(&self.walls);
        let goal = world_to_cell(self.player.position);
        let walls = self.walls.clone();
        let positions = self
            .zombies
            .iter()
            .map(|zombie| zombie.position)
            .collect::<Vec<_>>();
        let frame = self.frame;

        let flow_targets = if self.navigation_mode == NavigationMode::FlowField {
            if self.flow_field.as_ref().is_none_or(|field| field.goal != goal) {
                let field = FlowField::build(goal, &blocked, NAV_MIN, NAV_MAX);
                self.metrics.flow_field_builds = 1;
                self.metrics.flow_field_expanded = u64::from(field.expanded);
                self.flow_field_builds_total = self.flow_field_builds_total.saturating_add(1);
                self.flow_field = Some(field);
            }
            let field = self.flow_field.as_ref().expect("flow field just built");
            positions
                .iter()
                .copied()
                .map(|position| {
                    let current = world_to_cell(position);
                    if current == goal {
                        Some(self.player.position)
                    } else {
                        field.next_cell(current).map(cell_to_world)
                    }
                })
                .collect::<Vec<_>>()
        } else {
            Vec::new()
        };

        for index in 0..self.zombies.len() {
            let start = world_to_cell(positions[index]);
            let avoidance = local_separation(index, &positions);
            let fallback = nearest_destructible_wall_target(positions[index], &walls)
                .unwrap_or(self.player.position);

            let target = match self.navigation_mode {
                NavigationMode::Astar => {
                    let zombie = &mut self.zombies[index];
                    let needs_replan = frame >= zombie.next_replan_frame
                        || zombie.path_goal != Some(goal)
                        || zombie.path_cursor >= zombie.path.len();

                    if needs_replan {
                        let mut search_blocked = blocked.clone();
                        search_blocked.remove(&start);
                        search_blocked.remove(&goal);
                        self.metrics.path_replans = self.metrics.path_replans.saturating_add(1);
                        self.path_replans_total = self.path_replans_total.saturating_add(1);

                        if let Some(search) = astar(start, goal, &search_blocked, NAV_MIN, NAV_MAX) {
                            self.metrics.path_found = self.metrics.path_found.saturating_add(1);
                            self.metrics.path_expanded = self
                                .metrics
                                .path_expanded
                                .saturating_add(u64::from(search.expanded));
                            self.path_expanded_total = self
                                .path_expanded_total
                                .saturating_add(u64::from(search.expanded));
                            zombie.path = search.path;
                            zombie.path_cursor = usize::from(zombie.path.len() > 1);
                        } else {
                            zombie.path.clear();
                            zombie.path_cursor = 0;
                        }
                        zombie.path_goal = Some(goal);
                        zombie.next_replan_frame = frame.saturating_add(PATH_REPLAN_FRAMES);
                    }

                    advance_path_cursor(zombie);
                    zombie
                        .path
                        .get(zombie.path_cursor)
                        .copied()
                        .map(cell_to_world)
                        .unwrap_or(fallback)
                }
                NavigationMode::FlowField => {
                    if flow_targets[index].is_some() {
                        self.metrics.flow_field_followers =
                            self.metrics.flow_field_followers.saturating_add(1);
                    }
                    flow_targets[index].unwrap_or(fallback)
                }
            };

            let zombie = &mut self.zombies[index];
            let route = normalize2_or_zero([
                target[0] - zombie.position[0],
                target[2] - zombie.position[2],
            ]);
            let direction = normalize2_or_zero([
                route[0] + avoidance[0] * ZOMBIE_SEPARATION_WEIGHT,
                route[1] + avoidance[1] * ZOMBIE_SEPARATION_WEIGHT,
            ]);
            if length_squared2(avoidance) > 1.0e-6 {
                self.metrics.steering_adjustments =
                    self.metrics.steering_adjustments.saturating_add(1);
            }

            let delta = [
                direction[0] * ZOMBIE_SPEED * FIXED_DT,
                0.0,
                direction[1] * ZOMBIE_SPEED * FIXED_DT,
            ];
            zombie.position = move_with_sliding_3d(zombie.position, ZOMBIE_HALF, delta, &walls);
            zombie.position[1] = grounded_center_y(zombie.position, ZOMBIE_HALF, &walls);
        }
    }

    fn step_bullets(&mut self) {
        let bullets = std::mem::take(&mut self.bullets);
        let mut survivors = Vec::with_capacity(bullets.len());

        for mut bullet in bullets {
            bullet.ttl -= FIXED_DT;
            if bullet.ttl <= 0.0 {
                continue;
            }

            let from = bullet.position;
            let to = add3(from, scale3(bullet.velocity, FIXED_DT));
            bullet.previous_position = from;
            let mut best_t = 1.0_f32;
            let mut best_hit = None;

            for wall in &self.walls {
                self.metrics.ccd_tests = self.metrics.ccd_tests.saturating_add(1);
                if let Some(t) = segment_aabb_toi(from, to, wall_aabb(*wall), BULLET_RADIUS)
                    .filter(|t| *t <= best_t)
                {
                    best_t = t;
                    best_hit = Some(BulletHit::Wall);
                }
            }

            for (index, zombie) in self.zombies.iter().enumerate() {
                if zombie.health <= 0.0 {
                    continue;
                }
                self.metrics.ccd_tests = self.metrics.ccd_tests.saturating_add(1);
                if let Some(t) = segment_aabb_toi(
                    from,
                    to,
                    actor_aabb(zombie.position, ZOMBIE_HALF),
                    BULLET_RADIUS,
                )
                .filter(|t| *t <= best_t)
                {
                    best_t = t;
                    best_hit = Some(BulletHit::Zombie(index));
                }
            }

            if let Some(hit) = best_hit {
                let hit_point = lerp3(from, to, best_t);
                let hit_kind = match hit {
                    BulletHit::Wall => "wall",
                    BulletHit::Zombie(index) => {
                        if let Some(zombie) = self.zombies.get_mut(index) {
                            zombie.health -= 1.0;
                        }
                        "zombie"
                    }
                };
                self.metrics.ccd_hits = self.metrics.ccd_hits.saturating_add(1);
                self.sweeps.push(SweepDebug {
                    from,
                    to,
                    hit: Some(hit_point),
                    hit_kind: Some(hit_kind),
                });
            } else {
                bullet.position = to;
                self.sweeps.push(SweepDebug {
                    from,
                    to,
                    hit: None,
                    hit_kind: None,
                });
                if inside_world3(to, BULLET_RADIUS) {
                    survivors.push(bullet);
                }
            }
        }

        let before = self.zombies.len();
        self.zombies.retain(|zombie| zombie.health > 0.0);
        self.kills = self
            .kills
            .saturating_add(u32::try_from(before - self.zombies.len()).unwrap_or(u32::MAX));
        self.bullets = survivors;
    }

    fn resolve_actor_overlaps(&mut self) {
        let bodies = self.collision_bodies();
        let result = run_algorithm(
            self.algorithm,
            self.broad_phase_config(bodies.len()),
            &bodies,
        );

        for pair in &result.pairs {
            let player_zombie = if pair.a == PLAYER_ID {
                self.zombie_index(pair.b)
            } else if pair.b == PLAYER_ID {
                self.zombie_index(pair.a)
            } else {
                None
            };
            if player_zombie.is_some() && self.player_hit_cooldown <= 0.0 {
                self.player.health = (self.player.health - PLAYER_HIT_DAMAGE).max(0.0);
                self.player_hit_cooldown = PLAYER_HIT_COOLDOWN;
                if self.player.health <= 0.0 {
                    self.game_over = true;
                }
            }

            if let (Some(left), Some(right)) =
                (self.zombie_index(pair.a), self.zombie_index(pair.b))
            {
                self.separate_zombies(left, right);
            }
        }
    }

    fn attack_barricades(&mut self) {
        if !self.walls.iter().any(|wall| wall.destructible) {
            return;
        }

        let mut damage = vec![0.0_f32; self.walls.len()];
        for zombie in &self.zombies {
            let reach = expand_xz(
                actor_aabb(zombie.position, ZOMBIE_HALF),
                BARRICADE_ATTACK_REACH,
            );
            for (index, wall) in self.walls.iter().enumerate() {
                if wall.destructible && aabb_overlaps(reach, wall_aabb(*wall)) {
                    damage[index] += ZOMBIE_BARRICADE_DPS * FIXED_DT;
                }
            }
        }

        for (wall, damage) in self.walls.iter_mut().zip(damage) {
            if wall.destructible && damage > 0.0 {
                wall.health = (wall.health - damage).max(0.0);
            }
        }

        let before = self.walls.len();
        self.walls
            .retain(|wall| !wall.destructible || wall.health > 0.0);
        let destroyed = before.saturating_sub(self.walls.len());
        if destroyed > 0 {
            let destroyed = u64::try_from(destroyed).unwrap_or(u64::MAX);
            self.metrics.destroyed_barricades = destroyed;
            self.destroyed_barricades_total =
                self.destroyed_barricades_total.saturating_add(destroyed);
            self.invalidate_navigation();
        }
    }

    fn separate_zombies(&mut self, left: usize, right: usize) {
        if left == right || left >= self.zombies.len() || right >= self.zombies.len() {
            return;
        }
        let (a, b) = two_mut(&mut self.zombies, left, right);
        if !aabb_overlaps(
            actor_aabb(a.position, ZOMBIE_HALF),
            actor_aabb(b.position, ZOMBIE_HALF),
        ) {
            return;
        }

        let dx = b.position[0] - a.position[0];
        let dz = b.position[2] - a.position[2];
        let overlap_x = ZOMBIE_HALF[0] * 2.0 - dx.abs();
        let overlap_z = ZOMBIE_HALF[2] * 2.0 - dz.abs();
        if overlap_x <= 0.0 || overlap_z <= 0.0 {
            return;
        }

        let (push_a, push_b) = if overlap_x < overlap_z {
            let sign = if dx >= 0.0 { 1.0 } else { -1.0 };
            let push = overlap_x * 0.5 + 0.001;
            ([-sign * push, 0.0, 0.0], [sign * push, 0.0, 0.0])
        } else {
            let sign = if dz >= 0.0 { 1.0 } else { -1.0 };
            let push = overlap_z * 0.5 + 0.001;
            ([0.0, 0.0, -sign * push], [0.0, 0.0, sign * push])
        };

        let next_a = add3(a.position, push_a);
        let next_b = add3(b.position, push_b);
        if !collides_with_walls(next_a, ZOMBIE_HALF, &self.walls) {
            a.position = next_a;
        }
        if !collides_with_walls(next_b, ZOMBIE_HALF, &self.walls) {
            b.position = next_b;
        }
    }

    fn spawn_zombie(&mut self) {
        let side = self.rng.next_u32() % 4;
        let along = self.rng.range_f32(-11.5, 11.5);
        let inset = 12.0;
        let mut position = match side {
            0 => [-inset, ZOMBIE_HALF[1], along],
            1 => [inset, ZOMBIE_HALF[1], along],
            2 => [along, ZOMBIE_HALF[1], -inset],
            _ => [along, ZOMBIE_HALF[1], inset],
        };

        for _ in 0..16 {
            if !collides_with_walls(position, ZOMBIE_HALF, &self.walls)
                && distance_squared_xz(position, self.player.position) > 36.0
            {
                break;
            }
            position = [
                self.rng.range_f32(-11.5, 11.5),
                ZOMBIE_HALF[1],
                self.rng.range_f32(-11.5, 11.5),
            ];
        }

        self.zombies.push(Zombie {
            id: self.next_zombie_id,
            position,
            health: ZOMBIE_MAX_HEALTH,
            path: Vec::new(),
            path_cursor: 0,
            path_goal: None,
            next_replan_frame: 0,
        });
        self.next_zombie_id = self.next_zombie_id.saturating_add(1);
    }

    fn replan_all_zombies(&mut self) {
        for zombie in &mut self.zombies {
            zombie.next_replan_frame = 0;
        }
        self.step_zombies();
    }

    fn refresh_collision_metrics(&mut self) {
        let bodies = self.collision_bodies();
        let result = run_algorithm(
            self.algorithm,
            self.broad_phase_config(bodies.len()),
            &bodies,
        );
        self.metrics.possible_pairs = possible_pair_count(bodies.len());
        self.metrics.aabb_tests = result.stats.aabb_tests;
        self.metrics.occupied_cells = result.stats.occupied_cells.unwrap_or(0);
        self.metrics.overlaps = result.pairs.len();
        self.metrics.overlap_pairs = result.pairs;
    }

    fn collision_bodies(&self) -> Vec<Body> {
        let mut bodies = Vec::with_capacity(1 + self.zombies.len() + self.walls.len());
        bodies.push(Body {
            id: PLAYER_ID,
            aabb: actor_aabb(self.player.position, PLAYER_HALF),
        });
        bodies.extend(self.zombies.iter().map(|zombie| Body {
            id: zombie.id,
            aabb: actor_aabb(zombie.position, ZOMBIE_HALF),
        }));
        bodies.extend(self.walls.iter().map(|wall| Body {
            id: wall.id,
            aabb: wall_aabb(*wall),
        }));
        bodies
    }

    fn broad_phase_config(&self, objects: usize) -> Config {
        Config {
            objects,
            cell_size: BROAD_PHASE_CELL_SIZE,
            fat_margin: BROAD_PHASE_FAT_MARGIN,
            seed: self.seed,
            world_extent: WORLD_HALF,
            half_extent: 0.5,
            scenario: Scenario::Uniform,
        }
    }

    fn zombie_index(&self, id: u32) -> Option<usize> {
        self.zombies.iter().position(|zombie| zombie.id == id)
    }

    fn snapshot(&self) -> Result<String, serde_json::Error> {
        let blocked = blocked_navigation_cells(&self.walls);
        let paths = self
            .zombies
            .iter()
            .map(|zombie| {
                let waypoints = zombie
                    .path
                    .iter()
                    .skip(zombie.path_cursor.min(zombie.path.len()))
                    .copied()
                    .map(cell_to_world)
                    .collect::<Vec<_>>();
                json!({
                    "zombieId": zombie.id,
                    "waypoints": waypoints,
                })
            })
            .collect::<Vec<_>>();

        let value = json!({
            "frame": self.frame,
            "algorithm": self.algorithm.as_str(),
            "navigationMode": self.navigation_mode.as_str(),
            "worldHalf": WORLD_HALF,
            "fixedDt": FIXED_DT,
            "navCell": NAV_CELL,
            "player": {
                "id": PLAYER_ID,
                "position": self.player.position,
                "velocity": self.player.velocity,
                "half": PLAYER_HALF,
                "aim": self.player.aim,
                "health": self.player.health,
                "maxHealth": PLAYER_MAX_HEALTH,
                "grounded": self.player.grounded,
            },
            "zombies": self.zombies.iter().map(|zombie| json!({
                "id": zombie.id,
                "position": zombie.position,
                "half": ZOMBIE_HALF,
                "health": zombie.health,
                "maxHealth": ZOMBIE_MAX_HEALTH,
            })).collect::<Vec<_>>(),
            "walls": self.walls.iter().map(|wall| json!({
                "id": wall.id,
                "position": wall.position,
                "half": wall.half,
                "low": wall.low,
                "health": wall.health,
                "maxHealth": wall.max_health,
                "destructible": wall.destructible,
            })).collect::<Vec<_>>(),
            "bullets": self.bullets.iter().map(|bullet| json!({
                "id": bullet.id,
                "position": bullet.position,
                "previousPosition": bullet.previous_position,
                "radius": BULLET_RADIUS,
            })).collect::<Vec<_>>(),
            "debug": {
                "overlapPairs": self.metrics.overlap_pairs.iter().map(|pair| [pair.a, pair.b]).collect::<Vec<_>>(),
                "sweeps": self.sweeps.iter().map(|sweep| json!({
                    "from": sweep.from,
                    "to": sweep.to,
                    "hit": sweep.hit,
                    "hitKind": sweep.hit_kind,
                })).collect::<Vec<_>>(),
                "navigation": {
                    "blocked": blocked.iter().map(|cell| [cell.x, cell.z]).collect::<Vec<_>>(),
                    "paths": paths,
                    "flowFieldReachable": self.flow_field.as_ref().map_or(0, FlowField::reachable_cells),
                },
            },
            "stats": {
                "zombies": self.zombies.len(),
                "walls": self.walls.len(),
                "builtBarricades": self.walls.iter().filter(|wall| wall.destructible).count(),
                "bullets": self.bullets.len(),
                "kills": self.kills,
                "shots": self.shots,
                "jumps": self.jumps,
                "possiblePairs": self.metrics.possible_pairs,
                "aabbTests": self.metrics.aabb_tests,
                "occupiedCells": self.metrics.occupied_cells,
                "overlaps": self.metrics.overlaps,
                "ccdTests": self.metrics.ccd_tests,
                "ccdHits": self.metrics.ccd_hits,
                "pathReplans": self.metrics.path_replans,
                "pathFound": self.metrics.path_found,
                "pathExpanded": self.metrics.path_expanded,
                "pathReplansTotal": self.path_replans_total,
                "pathExpandedTotal": self.path_expanded_total,
                "destroyedBarricades": self.metrics.destroyed_barricades,
                "destroyedBarricadesTotal": self.destroyed_barricades_total,
                "steeringAdjustments": self.metrics.steering_adjustments,
                "flowFieldBuilds": self.metrics.flow_field_builds,
                "flowFieldExpanded": self.metrics.flow_field_expanded,
                "flowFieldFollowers": self.metrics.flow_field_followers,
                "flowFieldBuildsTotal": self.flow_field_builds_total,
            },
            "gameOver": self.game_over,
        });
        serde_json::to_string(&value)
    }
}

fn advance_path_cursor(zombie: &mut Zombie) {
    let Some(target) = zombie.path.get(zombie.path_cursor).copied() else {
        return;
    };
    let target = cell_to_world(target);
    let toward = [
        target[0] - zombie.position[0],
        target[2] - zombie.position[2],
    ];
    if length_squared2(toward) < 0.10 * 0.10 && zombie.path_cursor + 1 < zombie.path.len() {
        zombie.path_cursor += 1;
    }
}

fn local_separation(index: usize, positions: &[[f32; 3]]) -> [f32; 2] {
    let Some(origin) = positions.get(index).copied() else {
        return [0.0, 0.0];
    };
    let radius_sq = ZOMBIE_SEPARATION_RADIUS * ZOMBIE_SEPARATION_RADIUS;
    let mut force = [0.0_f32, 0.0_f32];

    for (neighbor_index, neighbor) in positions.iter().copied().enumerate() {
        if neighbor_index == index {
            continue;
        }
        let delta = [origin[0] - neighbor[0], origin[2] - neighbor[2]];
        let distance_sq = length_squared2(delta);
        if distance_sq <= 1.0e-8 || distance_sq >= radius_sq {
            continue;
        }
        let distance = distance_sq.sqrt();
        let strength = (ZOMBIE_SEPARATION_RADIUS - distance) / ZOMBIE_SEPARATION_RADIUS;
        force[0] += delta[0] / distance * strength;
        force[1] += delta[1] / distance * strength;
    }

    normalize2_or_zero(force)
}

fn nearest_destructible_wall_target(position: [f32; 3], walls: &[Wall]) -> Option<[f32; 3]> {
    let mut best: Option<(f32, u32, [f32; 3])> = None;
    for wall in walls.iter().copied().filter(|wall| wall.destructible) {
        let distance = distance_squared_xz(position, wall.position);
        let replace = best.is_none_or(|(best_distance, best_id, _)| {
            distance < best_distance - 1.0e-6
                || ((distance - best_distance).abs() <= 1.0e-6 && wall.id < best_id)
        });
        if replace {
            best = Some((distance, wall.id, wall.position));
        }
    }
    best.map(|(_, _, position)| position)
}

fn arena_walls() -> Vec<Wall> {
    vec![
        wall(100, [0.0, 1.5, -14.0], [14.5, 1.5, 0.5], false),
        wall(101, [0.0, 1.5, 14.0], [14.5, 1.5, 0.5], false),
        wall(102, [-14.0, 1.5, 0.0], [0.5, 1.5, 14.5], false),
        wall(103, [14.0, 1.5, 0.0], [0.5, 1.5, 14.5], false),
        wall(110, [-4.5, 1.1, -2.0], [0.6, 1.1, 5.0], false),
        wall(111, [4.5, 1.1, 2.5], [0.6, 1.1, 4.5], false),
        wall(112, [0.0, 1.1, -6.5], [3.2, 1.1, 0.6], false),
        wall(113, [0.0, 1.1, 7.0], [3.0, 1.1, 0.6], false),
        wall(120, [-1.6, 0.45, 1.5], [1.0, 0.45, 1.0], true),
        wall(121, [2.0, 0.45, -1.0], [1.0, 0.45, 1.0], true),
        wall(122, [-7.5, 0.45, 6.0], [1.3, 0.45, 0.8], true),
    ]
}

const fn wall(id: u32, position: [f32; 3], half: [f32; 3], low: bool) -> Wall {
    Wall {
        id,
        position,
        half,
        low,
        health: 0.0,
        max_health: 0.0,
        destructible: false,
    }
}

fn actor_aabb(position: [f32; 3], half: [f32; 3]) -> Aabb {
    Aabb::from_center_half_extents(position, half)
}

fn wall_aabb(wall: Wall) -> Aabb {
    Aabb::from_center_half_extents(wall.position, wall.half)
}

fn aabb_overlaps(left: Aabb, right: Aabb) -> bool {
    left.min[0] < right.max[0]
        && left.max[0] > right.min[0]
        && left.min[1] < right.max[1]
        && left.max[1] > right.min[1]
        && left.min[2] < right.max[2]
        && left.max[2] > right.min[2]
}

fn expand_xz(aabb: Aabb, amount: f32) -> Aabb {
    Aabb {
        min: [aabb.min[0] - amount, aabb.min[1], aabb.min[2] - amount],
        max: [aabb.max[0] + amount, aabb.max[1], aabb.max[2] + amount],
    }
}

fn collides_with_walls(position: [f32; 3], half: [f32; 3], walls: &[Wall]) -> bool {
    let actor = actor_aabb(position, half);
    walls
        .iter()
        .any(|wall| aabb_overlaps(actor, wall_aabb(*wall)))
}

fn move_with_sliding_3d(
    position: [f32; 3],
    half: [f32; 3],
    delta: [f32; 3],
    walls: &[Wall],
) -> [f32; 3] {
    let mut next = position;
    for axis in [0, 2] {
        let mut candidate = next;
        candidate[axis] += delta[axis];
        if !collides_with_walls(candidate, half, walls) {
            next = candidate;
        }
    }
    next
}

fn move_vertical(position: [f32; 3], half: [f32; 3], delta_y: f32, walls: &[Wall]) -> (f32, bool) {
    let floor_y = half[1];
    let desired = position[1] + delta_y;
    if desired <= floor_y {
        return (floor_y, true);
    }

    let mut candidate = position;
    candidate[1] = desired;
    if !collides_with_walls(candidate, half, walls) {
        return (desired, false);
    }

    if delta_y < 0.0 {
        let actor_bottom = position[1] - half[1];
        let mut best_top = floor_y;
        for wall in walls {
            if overlaps_xz(position, half, *wall) {
                let top = wall.position[1] + wall.half[1] + half[1];
                if actor_bottom >= wall.position[1] + wall.half[1] - 0.15
                    && top <= position[1] + 0.15
                {
                    best_top = best_top.max(top);
                }
            }
        }
        return (best_top.min(position[1]), true);
    }

    (position[1], true)
}

fn is_supported(position: [f32; 3], half: [f32; 3], walls: &[Wall]) -> bool {
    if position[1] - half[1] <= 0.002 {
        return true;
    }
    walls.iter().any(|wall| {
        overlaps_xz(position, half, *wall)
            && ((position[1] - half[1]) - (wall.position[1] + wall.half[1])).abs() <= 0.02
    })
}

fn grounded_center_y(position: [f32; 3], half: [f32; 3], walls: &[Wall]) -> f32 {
    let mut y = half[1];
    for wall in walls {
        if overlaps_xz(position, half, *wall) {
            let top = wall.position[1] + wall.half[1] + half[1];
            if top <= position[1] + 0.05 {
                y = y.max(top);
            }
        }
    }
    y
}

fn overlaps_xz(position: [f32; 3], half: [f32; 3], wall: Wall) -> bool {
    (position[0] - wall.position[0]).abs() < half[0] + wall.half[0]
        && (position[2] - wall.position[2]).abs() < half[2] + wall.half[2]
}

fn blocked_navigation_cells(walls: &[Wall]) -> BTreeSet<Cell> {
    let mut blocked = BTreeSet::new();
    for x in NAV_MIN..=NAV_MAX {
        for z in NAV_MIN..=NAV_MAX {
            let center = [x as f32 * NAV_CELL, ZOMBIE_HALF[1], z as f32 * NAV_CELL];
            if walls.iter().any(|wall| {
                (center[0] - wall.position[0]).abs() < ZOMBIE_HALF[0] + wall.half[0]
                    && (center[2] - wall.position[2]).abs() < ZOMBIE_HALF[2] + wall.half[2]
            }) {
                blocked.insert(Cell { x, z });
            }
        }
    }
    blocked
}

fn world_to_cell(position: [f32; 3]) -> Cell {
    Cell {
        x: (position[0] / NAV_CELL)
            .round()
            .clamp(NAV_MIN as f32, NAV_MAX as f32) as i32,
        z: (position[2] / NAV_CELL)
            .round()
            .clamp(NAV_MIN as f32, NAV_MAX as f32) as i32,
    }
}

fn cell_to_world(cell: Cell) -> [f32; 3] {
    [
        cell.x as f32 * NAV_CELL,
        ZOMBIE_HALF[1],
        cell.z as f32 * NAV_CELL,
    ]
}

fn segment_aabb_toi(from: [f32; 3], to: [f32; 3], aabb: Aabb, radius: f32) -> Option<f32> {
    let direction = sub3(to, from);
    let min = [
        aabb.min[0] - radius,
        aabb.min[1] - radius,
        aabb.min[2] - radius,
    ];
    let max = [
        aabb.max[0] + radius,
        aabb.max[1] + radius,
        aabb.max[2] + radius,
    ];
    let mut t_min = 0.0_f32;
    let mut t_max = 1.0_f32;

    for axis in 0..3 {
        if direction[axis].abs() < 1.0e-7 {
            if from[axis] < min[axis] || from[axis] > max[axis] {
                return None;
            }
            continue;
        }

        let inverse = direction[axis].recip();
        let mut near = (min[axis] - from[axis]) * inverse;
        let mut far = (max[axis] - from[axis]) * inverse;
        if near > far {
            std::mem::swap(&mut near, &mut far);
        }
        t_min = t_min.max(near);
        t_max = t_max.min(far);
        if t_min > t_max {
            return None;
        }
    }

    (t_max >= 0.0 && t_min <= 1.0).then_some(t_min.clamp(0.0, 1.0))
}

fn inside_world3(point: [f32; 3], radius: f32) -> bool {
    point[0].abs() <= WORLD_HALF + radius
        && point[2].abs() <= WORLD_HALF + radius
        && point[1] >= -radius
        && point[1] <= 12.0
}

fn normalize2_or_zero(value: [f32; 2]) -> [f32; 2] {
    let length_sq = length_squared2(value);
    if length_sq <= 1.0e-8 {
        [0.0, 0.0]
    } else {
        let inverse = length_sq.sqrt().recip();
        [value[0] * inverse, value[1] * inverse]
    }
}

fn normalize3(value: [f32; 3]) -> Option<[f32; 3]> {
    let length_sq = value[0] * value[0] + value[1] * value[1] + value[2] * value[2];
    if length_sq <= 1.0e-8 {
        None
    } else {
        let inverse = length_sq.sqrt().recip();
        Some([value[0] * inverse, value[1] * inverse, value[2] * inverse])
    }
}

fn length_squared2(value: [f32; 2]) -> f32 {
    value[0] * value[0] + value[1] * value[1]
}

fn distance_squared_xz(left: [f32; 3], right: [f32; 3]) -> f32 {
    let dx = left[0] - right[0];
    let dz = left[2] - right[2];
    dx * dx + dz * dz
}

fn add3(left: [f32; 3], right: [f32; 3]) -> [f32; 3] {
    [left[0] + right[0], left[1] + right[1], left[2] + right[2]]
}

fn sub3(left: [f32; 3], right: [f32; 3]) -> [f32; 3] {
    [left[0] - right[0], left[1] - right[1], left[2] - right[2]]
}

fn scale3(value: [f32; 3], scalar: f32) -> [f32; 3] {
    [value[0] * scalar, value[1] * scalar, value[2] * scalar]
}

fn lerp3(from: [f32; 3], to: [f32; 3], t: f32) -> [f32; 3] {
    [
        from[0] + (to[0] - from[0]) * t,
        from[1] + (to[1] - from[1]) * t,
        from[2] + (to[2] - from[2]) * t,
    ]
}

fn possible_pair_count(objects: usize) -> u64 {
    let objects = u64::try_from(objects).unwrap_or(u64::MAX);
    objects.saturating_mul(objects.saturating_sub(1)) / 2
}

fn two_mut<T>(slice: &mut [T], left: usize, right: usize) -> (&mut T, &mut T) {
    assert_ne!(left, right);
    if left < right {
        let (head, tail) = slice.split_at_mut(right);
        (&mut head[left], &mut tail[0])
    } else {
        let (head, tail) = slice.split_at_mut(left);
        (&mut tail[0], &mut head[right])
    }
}

#[derive(Clone, Debug)]
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

    fn next_u32(&mut self) -> u32 {
        (self.next_u64() >> 32) as u32
    }

    fn next_f32(&mut self) -> f32 {
        let bits = self.next_u32() >> 8;
        bits as f32 / 16_777_216.0
    }

    fn range_f32(&mut self, min: f32, max: f32) -> f32 {
        min + (max - min) * self.next_f32()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn world_starts_with_real_3d_state_and_paths() {
        let world = ZombieArena3dWorld::new_inner(Algorithm::UniformGrid, 42);
        assert_eq!(world.player.position[1], PLAYER_HALF[1]);
        assert_eq!(world.zombies.len(), INITIAL_ZOMBIES);
        assert!(world.zombies.iter().all(|zombie| !zombie.path.is_empty()));
    }

    #[test]
    fn jump_changes_vertical_state_deterministically() {
        let mut world = ZombieArena3dWorld::new_inner(Algorithm::Naive, 7);
        let before = world.player.position[1];
        world.step([0.0, 0.0], [0.0, 0.0, -1.0], true, false);
        assert!(world.player.position[1] > before);
        assert!(world.player.velocity[1] > 0.0);
        assert!(!world.player.grounded);
    }

    #[test]
    fn bullet_sweep_hits_a_box_in_three_dimensions() {
        let target = Aabb::from_center_half_extents([2.0, 1.0, 0.0], [0.5, 0.5, 0.5]);
        let hit = segment_aabb_toi([0.0, 1.0, 0.0], [4.0, 1.0, 0.0], target, 0.05);
        assert!(hit.is_some());
        let miss = segment_aabb_toi([0.0, 3.0, 0.0], [4.0, 3.0, 0.0], target, 0.05);
        assert!(miss.is_none());
    }

    #[test]
    fn low_obstacle_can_support_player_above_ground() {
        let low = wall(999, [0.0, 0.45, 0.0], [1.0, 0.45, 1.0], true);
        let position = [0.0, 0.9 + PLAYER_HALF[1], 0.0];
        assert!(is_supported(position, PLAYER_HALF, &[low]));
    }

    #[test]
    fn local_separation_pushes_neighbors_apart_symmetrically() {
        let positions = [[0.0, ZOMBIE_HALF[1], 0.0], [0.8, ZOMBIE_HALF[1], 0.0]];
        let left = local_separation(0, &positions);
        let right = local_separation(1, &positions);
        assert!(left[0] < 0.0);
        assert!(right[0] > 0.0);
        assert!((left[0] + right[0]).abs() < 1.0e-6);
    }

    #[test]
    fn zombie_damage_destroys_runtime_barricade_and_invalidates_paths() {
        let mut world = ZombieArena3dWorld::new_inner(Algorithm::UniformGrid, 91);
        world.zombies.clear();
        world
            .build_json(8.0, 8.0)
            .expect("free cell should accept barricade");
        world.zombies.push(Zombie {
            id: 9_001,
            position: [7.05, ZOMBIE_HALF[1], 8.0],
            health: ZOMBIE_MAX_HEALTH,
            path: vec![Cell { x: 7, z: 8 }, Cell { x: 8, z: 8 }],
            path_cursor: 1,
            path_goal: Some(Cell { x: 8, z: 8 }),
            next_replan_frame: 999,
        });

        for _ in 0..240 {
            world.attack_barricades();
            if !world.walls.iter().any(|wall| wall.destructible) {
                break;
            }
        }

        assert!(!world.walls.iter().any(|wall| wall.destructible));
        assert_eq!(world.destroyed_barricades_total, 1);
        assert!(world.zombies[0].path.is_empty());
        assert_eq!(world.zombies[0].next_replan_frame, 0);
    }

    #[test]
    fn flow_field_cache_rebuilds_only_when_invalidated() {
        let mut world = ZombieArena3dWorld::new_inner(Algorithm::UniformGrid, 77);
        world.navigation_mode = NavigationMode::FlowField;
        world.invalidate_navigation();

        world.step_zombies();
        assert_eq!(world.flow_field_builds_total, 1);
        assert!(world.flow_field.is_some());
        world.step_zombies();
        assert_eq!(world.flow_field_builds_total, 1);

        world.invalidate_navigation();
        assert!(world.flow_field.is_none());
        world.step_zombies();
        assert_eq!(world.flow_field_builds_total, 2);
    }
}
