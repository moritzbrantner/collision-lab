use collision_lab::{run_algorithm, Algorithm, Config, Scenario};
use serde_json::json;
use spatial_kernels::{Aabb, Body, Pair};
use wasm_bindgen::prelude::*;

const FIXED_DT: f32 = 1.0 / 60.0;
const WORLD_HALF: f32 = 12.0;
const PLAYER_ID: u32 = 1;
const PLAYER_HALF: [f32; 2] = [0.34, 0.34];
const PLAYER_SPEED: f32 = 5.4;
const ZOMBIE_HALF: [f32; 2] = [0.38, 0.38];
const ZOMBIE_SPEED: f32 = 2.15;
const BULLET_RADIUS: f32 = 0.08;
const BULLET_SPEED: f32 = 31.0;
const BULLET_LIFETIME: f32 = 1.15;
const FIRE_INTERVAL: f32 = 0.22;
const BUILD_GRID: f32 = 1.0;
const BARRICADE_HALF: [f32; 2] = [0.48, 0.48];
const BARRICADE_HEALTH: f32 = 100.0;
const ZOMBIE_ATTACK_DPS: f32 = 20.0;
const PLAYER_MAX_HEALTH: f32 = 100.0;
const PLAYER_HIT_DAMAGE: f32 = 8.0;
const PLAYER_HIT_COOLDOWN: f32 = 0.35;
const BROAD_PHASE_CELL_SIZE: f32 = 1.5;
const BROAD_PHASE_FAT_MARGIN: f32 = 0.35;
const INITIAL_ZOMBIES: usize = 18;
const MAX_ZOMBIES: usize = 72;
const SPAWN_INTERVAL_FRAMES: u64 = 120;

#[derive(Clone, Copy, Debug)]
struct Player {
    position: [f32; 2],
    aim: [f32; 2],
    health: f32,
}

#[derive(Clone, Copy, Debug)]
struct Zombie {
    id: u32,
    position: [f32; 2],
    health: f32,
}

#[derive(Clone, Copy, Debug)]
struct Wall {
    id: u32,
    position: [f32; 2],
    half: [f32; 2],
    health: f32,
    destructible: bool,
}

#[derive(Clone, Copy, Debug)]
struct Bullet {
    id: u32,
    position: [f32; 2],
    previous_position: [f32; 2],
    velocity: [f32; 2],
    ttl: f32,
}

#[derive(Clone, Copy, Debug)]
struct SweepDebug {
    from: [f32; 2],
    to: [f32; 2],
    hit: Option<[f32; 2]>,
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
    destroyed_barricades: u32,
}

#[derive(Clone, Copy, Debug)]
enum BulletHit {
    Wall,
    Zombie(usize),
}

#[wasm_bindgen]
pub struct ZombieArenaWorld {
    algorithm: Algorithm,
    seed: u64,
    rng: SplitMix64,
    player: Player,
    zombies: Vec<Zombie>,
    walls: Vec<Wall>,
    bullets: Vec<Bullet>,
    sweeps: Vec<SweepDebug>,
    metrics: FrameMetrics,
    next_wall_id: u32,
    next_zombie_id: u32,
    next_bullet_id: u32,
    frame: u64,
    fire_cooldown: f32,
    player_hit_cooldown: f32,
    kills: u32,
    shots: u32,
    builds: u32,
    game_over: bool,
}

#[wasm_bindgen]
impl ZombieArenaWorld {
    #[wasm_bindgen(constructor)]
    pub fn new(algorithm: &str, seed: u32) -> Result<ZombieArenaWorld, JsValue> {
        let algorithm = Algorithm::parse(algorithm).map_err(|error| JsValue::from_str(&error))?;
        Ok(Self::new_inner(algorithm, u64::from(seed)))
    }

    pub fn snapshot_json(&self) -> Result<String, JsValue> {
        self.snapshot().map_err(|error| JsValue::from_str(&error))
    }

    pub fn set_algorithm(&mut self, algorithm: &str) -> Result<String, JsValue> {
        self.algorithm = Algorithm::parse(algorithm).map_err(|error| JsValue::from_str(&error))?;
        self.refresh_metrics();
        self.snapshot_json()
    }

    pub fn step_json(
        &mut self,
        move_x: f32,
        move_y: f32,
        aim_x: f32,
        aim_y: f32,
        shoot: bool,
    ) -> Result<String, JsValue> {
        if !move_x.is_finite()
            || !move_y.is_finite()
            || !aim_x.is_finite()
            || !aim_y.is_finite()
        {
            return Err(JsValue::from_str("arena input must be finite"));
        }
        self.step([move_x, move_y], [aim_x, aim_y], shoot);
        self.snapshot_json()
    }

    pub fn build_json(&mut self, world_x: f32, world_y: f32) -> Result<String, JsValue> {
        if !world_x.is_finite() || !world_y.is_finite() {
            return Err(JsValue::from_str("build position must be finite"));
        }
        self.build_at([world_x, world_y]);
        self.refresh_metrics();
        self.snapshot_json()
    }
}

impl ZombieArenaWorld {
    fn new_inner(algorithm: Algorithm, seed: u64) -> Self {
        let mut world = Self {
            algorithm,
            seed,
            rng: SplitMix64::new(seed ^ 0x5A4F_4D42_4945_5F31),
            player: Player {
                position: [0.0, 0.0],
                aim: [1.0, 0.0],
                health: PLAYER_MAX_HEALTH,
            },
            zombies: Vec::new(),
            walls: arena_walls(),
            bullets: Vec::new(),
            sweeps: Vec::new(),
            metrics: FrameMetrics::default(),
            next_wall_id: 500,
            next_zombie_id: 2_000,
            next_bullet_id: 20_000,
            frame: 0,
            fire_cooldown: 0.0,
            player_hit_cooldown: 0.0,
            kills: 0,
            shots: 0,
            builds: 0,
            game_over: false,
        };
        for _ in 0..INITIAL_ZOMBIES {
            world.spawn_zombie();
        }
        world.refresh_metrics();
        world
    }

    fn step(&mut self, movement: [f32; 2], aim: [f32; 2], shoot: bool) {
        if self.game_over {
            return;
        }

        self.frame = self.frame.saturating_add(1);
        self.fire_cooldown = (self.fire_cooldown - FIXED_DT).max(0.0);
        self.player_hit_cooldown = (self.player_hit_cooldown - FIXED_DT).max(0.0);
        self.metrics.ccd_tests = 0;
        self.metrics.ccd_hits = 0;
        self.metrics.destroyed_barricades = 0;
        self.sweeps.clear();

        let aim_delta = [
            aim[0] - self.player.position[0],
            aim[1] - self.player.position[1],
        ];
        if let Some(direction) = normalize(aim_delta) {
            self.player.aim = direction;
        }

        let movement = normalize_or_zero(movement);
        let player_delta = [
            movement[0] * PLAYER_SPEED * FIXED_DT,
            movement[1] * PLAYER_SPEED * FIXED_DT,
        ];
        self.player.position = move_with_sliding(
            self.player.position,
            PLAYER_HALF,
            player_delta,
            &self.walls,
        );

        if shoot && self.fire_cooldown <= 0.0 {
            self.fire();
            self.fire_cooldown = FIRE_INTERVAL;
        }

        for zombie in &mut self.zombies {
            let toward_player = [
                self.player.position[0] - zombie.position[0],
                self.player.position[1] - zombie.position[1],
            ];
            let direction = normalize_or_zero(toward_player);
            let delta = [
                direction[0] * ZOMBIE_SPEED * FIXED_DT,
                direction[1] * ZOMBIE_SPEED * FIXED_DT,
            ];
            zombie.position =
                move_with_sliding(zombie.position, ZOMBIE_HALF, delta, &self.walls);
        }

        self.step_bullets();
        self.resolve_actor_overlaps();
        self.attack_barricades();

        if self.frame % SPAWN_INTERVAL_FRAMES == 0 && self.zombies.len() < MAX_ZOMBIES {
            self.spawn_zombie();
        }

        self.refresh_metrics();
    }

    fn fire(&mut self) {
        let muzzle = [
            self.player.position[0] + self.player.aim[0] * 0.48,
            self.player.position[1] + self.player.aim[1] * 0.48,
        ];
        self.bullets.push(Bullet {
            id: self.next_bullet_id,
            position: muzzle,
            previous_position: muzzle,
            velocity: [
                self.player.aim[0] * BULLET_SPEED,
                self.player.aim[1] * BULLET_SPEED,
            ],
            ttl: BULLET_LIFETIME,
        });
        self.next_bullet_id = self.next_bullet_id.saturating_add(1);
        self.shots = self.shots.saturating_add(1);
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
            let to = [
                bullet.position[0] + bullet.velocity[0] * FIXED_DT,
                bullet.position[1] + bullet.velocity[1] * FIXED_DT,
            ];
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
                let hit_point = [
                    from[0] + (to[0] - from[0]) * best_t,
                    from[1] + (to[1] - from[1]) * best_t,
                ];
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
                if inside_world(to, BULLET_RADIUS) {
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

        self.metrics.possible_pairs = possible_pair_count(bodies.len());
        self.metrics.aabb_tests = result.stats.aabb_tests;
        self.metrics.occupied_cells = result.stats.occupied_cells.unwrap_or(0);
        self.metrics.overlaps = result.pairs.len();
        self.metrics.overlap_pairs = result.pairs;
    }

    fn separate_zombies(&mut self, left: usize, right: usize) {
        if left == right || left >= self.zombies.len() || right >= self.zombies.len() {
            return;
        }
        let (a, b) = two_mut(&mut self.zombies, left, right);
        let dx = b.position[0] - a.position[0];
        let dy = b.position[1] - a.position[1];
        let overlap_x = ZOMBIE_HALF[0] * 2.0 - dx.abs();
        let overlap_y = ZOMBIE_HALF[1] * 2.0 - dy.abs();
        if overlap_x <= 0.0 || overlap_y <= 0.0 {
            return;
        }

        if overlap_x < overlap_y {
            let sign = if dx >= 0.0 { 1.0 } else { -1.0 };
            let push = overlap_x * 0.5 + 0.001;
            let next_a = [a.position[0] - sign * push, a.position[1]];
            let next_b = [b.position[0] + sign * push, b.position[1]];
            if !collides_with_walls(next_a, ZOMBIE_HALF, &self.walls) {
                a.position = next_a;
            }
            if !collides_with_walls(next_b, ZOMBIE_HALF, &self.walls) {
                b.position = next_b;
            }
        } else {
            let sign = if dy >= 0.0 { 1.0 } else { -1.0 };
            let push = overlap_y * 0.5 + 0.001;
            let next_a = [a.position[0], a.position[1] - sign * push];
            let next_b = [b.position[0], b.position[1] + sign * push];
            if !collides_with_walls(next_a, ZOMBIE_HALF, &self.walls) {
                a.position = next_a;
            }
            if !collides_with_walls(next_b, ZOMBIE_HALF, &self.walls) {
                b.position = next_b;
            }
        }
    }

    fn attack_barricades(&mut self) {
        let mut damage = vec![0.0_f32; self.walls.len()];
        for zombie in &self.zombies {
            let probe = expanded(actor_aabb(zombie.position, ZOMBIE_HALF), 0.12);
            for (index, wall) in self.walls.iter().enumerate() {
                if wall.destructible && probe.overlaps(wall_aabb(*wall)) {
                    damage[index] += ZOMBIE_ATTACK_DPS * FIXED_DT;
                }
            }
        }

        for (wall, amount) in self.walls.iter_mut().zip(damage) {
            if wall.destructible {
                wall.health -= amount;
            }
        }
        let before = self.walls.len();
        self.walls
            .retain(|wall| !wall.destructible || wall.health > 0.0);
        self.metrics.destroyed_barricades =
            u32::try_from(before - self.walls.len()).unwrap_or(u32::MAX);
    }

    fn build_at(&mut self, world: [f32; 2]) -> bool {
        if self.game_over {
            return false;
        }
        let snapped = [
            (world[0] / BUILD_GRID).round() * BUILD_GRID,
            (world[1] / BUILD_GRID).round() * BUILD_GRID,
        ];
        if snapped[0].abs() > WORLD_HALF - 1.25 || snapped[1].abs() > WORLD_HALF - 1.25 {
            return false;
        }

        let candidate = actor_aabb(snapped, BARRICADE_HALF);
        if candidate.overlaps(actor_aabb(self.player.position, PLAYER_HALF))
            || self
                .zombies
                .iter()
                .any(|zombie| candidate.overlaps(actor_aabb(zombie.position, ZOMBIE_HALF)))
            || self
                .walls
                .iter()
                .any(|wall| candidate.overlaps(wall_aabb(*wall)))
        {
            return false;
        }

        self.walls.push(Wall {
            id: self.next_wall_id,
            position: snapped,
            half: BARRICADE_HALF,
            health: BARRICADE_HEALTH,
            destructible: true,
        });
        self.next_wall_id = self.next_wall_id.saturating_add(1);
        self.builds = self.builds.saturating_add(1);
        true
    }

    fn spawn_zombie(&mut self) {
        if self.zombies.len() >= MAX_ZOMBIES {
            return;
        }
        let side = self.rng.next_u32() % 4;
        let offset = (self.rng.unit_f32() * 2.0 - 1.0) * (WORLD_HALF - 2.0);
        let edge = WORLD_HALF - 1.05;
        let position = match side {
            0 => [-edge, offset],
            1 => [edge, offset],
            2 => [offset, -edge],
            _ => [offset, edge],
        };
        self.zombies.push(Zombie {
            id: self.next_zombie_id,
            position,
            health: 2.0,
        });
        self.next_zombie_id = self.next_zombie_id.saturating_add(1);
    }

    fn zombie_index(&self, id: u32) -> Option<usize> {
        self.zombies.iter().position(|zombie| zombie.id == id)
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
            world_extent: WORLD_HALF + 1.0,
            half_extent: 0.5,
            scenario: Scenario::Uniform,
        }
    }

    fn refresh_metrics(&mut self) {
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

    fn snapshot(&self) -> Result<String, String> {
        let static_walls = self.walls.iter().filter(|wall| !wall.destructible).count();
        let barricades = self.walls.len() - static_walls;
        serde_json::to_string(&json!({
            "frame": self.frame,
            "algorithm": self.algorithm.as_str(),
            "worldHalf": WORLD_HALF,
            "fixedDt": FIXED_DT,
            "buildGrid": BUILD_GRID,
            "player": {
                "id": PLAYER_ID,
                "position": self.player.position,
                "half": PLAYER_HALF,
                "aim": self.player.aim,
                "health": self.player.health,
                "maxHealth": PLAYER_MAX_HEALTH,
            },
            "zombies": self.zombies.iter().map(|zombie| json!({
                "id": zombie.id,
                "position": zombie.position,
                "half": ZOMBIE_HALF,
                "health": zombie.health,
                "maxHealth": 2.0,
            })).collect::<Vec<_>>(),
            "walls": self.walls.iter().map(|wall| json!({
                "id": wall.id,
                "position": wall.position,
                "half": wall.half,
                "health": wall.health.max(0.0),
                "maxHealth": if wall.destructible { BARRICADE_HEALTH } else { 0.0 },
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
            },
            "stats": {
                "zombies": self.zombies.len(),
                "staticWalls": static_walls,
                "barricades": barricades,
                "bullets": self.bullets.len(),
                "kills": self.kills,
                "shots": self.shots,
                "builds": self.builds,
                "possiblePairs": self.metrics.possible_pairs,
                "aabbTests": self.metrics.aabb_tests,
                "occupiedCells": self.metrics.occupied_cells,
                "overlaps": self.metrics.overlaps,
                "ccdTests": self.metrics.ccd_tests,
                "ccdHits": self.metrics.ccd_hits,
                "destroyedBarricades": self.metrics.destroyed_barricades,
            },
            "gameOver": self.game_over,
        }))
        .map_err(|error| error.to_string())
    }
}

fn arena_walls() -> Vec<Wall> {
    let mut walls = vec![
        wall(100, [0.0, WORLD_HALF], [WORLD_HALF + 0.4, 0.4]),
        wall(101, [0.0, -WORLD_HALF], [WORLD_HALF + 0.4, 0.4]),
        wall(102, [WORLD_HALF, 0.0], [0.4, WORLD_HALF + 0.4]),
        wall(103, [-WORLD_HALF, 0.0], [0.4, WORLD_HALF + 0.4]),
        wall(110, [-4.2, 2.0], [0.42, 2.6]),
        wall(111, [4.0, -2.1], [0.42, 2.5]),
        wall(112, [0.0, 5.0], [2.4, 0.42]),
        wall(113, [0.0, -5.2], [2.6, 0.42]),
    ];
    walls.sort_by_key(|wall| wall.id);
    walls
}

fn wall(id: u32, position: [f32; 2], half: [f32; 2]) -> Wall {
    Wall {
        id,
        position,
        half,
        health: 0.0,
        destructible: false,
    }
}

fn actor_aabb(position: [f32; 2], half: [f32; 2]) -> Aabb {
    Aabb::from_center_half_extents(
        [position[0], position[1], 0.0],
        [half[0], half[1], 0.35],
    )
}

fn wall_aabb(wall: Wall) -> Aabb {
    Aabb::from_center_half_extents(
        [wall.position[0], wall.position[1], 0.0],
        [wall.half[0], wall.half[1], 0.5],
    )
}

fn expanded(aabb: Aabb, amount: f32) -> Aabb {
    Aabb {
        min: [
            aabb.min[0] - amount,
            aabb.min[1] - amount,
            aabb.min[2],
        ],
        max: [
            aabb.max[0] + amount,
            aabb.max[1] + amount,
            aabb.max[2],
        ],
    }
}

fn move_with_sliding(
    position: [f32; 2],
    half: [f32; 2],
    delta: [f32; 2],
    walls: &[Wall],
) -> [f32; 2] {
    let mut next = position;
    let candidate_x = [
        (next[0] + delta[0]).clamp(-WORLD_HALF + 0.8, WORLD_HALF - 0.8),
        next[1],
    ];
    if !collides_with_walls(candidate_x, half, walls) {
        next = candidate_x;
    }
    let candidate_y = [
        next[0],
        (next[1] + delta[1]).clamp(-WORLD_HALF + 0.8, WORLD_HALF - 0.8),
    ];
    if !collides_with_walls(candidate_y, half, walls) {
        next = candidate_y;
    }
    next
}

fn collides_with_walls(position: [f32; 2], half: [f32; 2], walls: &[Wall]) -> bool {
    let aabb = actor_aabb(position, half);
    walls
        .iter()
        .any(|wall| aabb.overlaps(wall_aabb(*wall)))
}

fn segment_aabb_toi(
    from: [f32; 2],
    to: [f32; 2],
    target: Aabb,
    radius: f32,
) -> Option<f32> {
    let min = [target.min[0] - radius, target.min[1] - radius];
    let max = [target.max[0] + radius, target.max[1] + radius];
    let delta = [to[0] - from[0], to[1] - from[1]];
    let mut enter = 0.0_f32;
    let mut exit = 1.0_f32;

    for axis in 0..2 {
        if delta[axis].abs() <= f32::EPSILON {
            if from[axis] < min[axis] || from[axis] > max[axis] {
                return None;
            }
            continue;
        }
        let inverse = 1.0 / delta[axis];
        let mut near = (min[axis] - from[axis]) * inverse;
        let mut far = (max[axis] - from[axis]) * inverse;
        if near > far {
            std::mem::swap(&mut near, &mut far);
        }
        enter = enter.max(near);
        exit = exit.min(far);
        if enter > exit {
            return None;
        }
    }

    (0.0..=1.0).contains(&enter).then_some(enter)
}

fn normalize(vector: [f32; 2]) -> Option<[f32; 2]> {
    let length_sq = vector[0] * vector[0] + vector[1] * vector[1];
    if length_sq <= 1.0e-8 {
        return None;
    }
    let inverse = length_sq.sqrt().recip();
    Some([vector[0] * inverse, vector[1] * inverse])
}

fn normalize_or_zero(vector: [f32; 2]) -> [f32; 2] {
    normalize(vector).unwrap_or([0.0, 0.0])
}

fn inside_world(position: [f32; 2], margin: f32) -> bool {
    position[0].abs() <= WORLD_HALF + margin && position[1].abs() <= WORLD_HALF + margin
}

fn possible_pair_count(objects: usize) -> u64 {
    let objects = objects as u64;
    objects.saturating_mul(objects.saturating_sub(1)) / 2
}

fn two_mut<T>(values: &mut [T], left: usize, right: usize) -> (&mut T, &mut T) {
    assert_ne!(left, right);
    if left < right {
        let (head, tail) = values.split_at_mut(right);
        (&mut head[left], &mut tail[0])
    } else {
        let (head, tail) = values.split_at_mut(left);
        (&mut tail[0], &mut head[right])
    }
}

#[derive(Clone, Copy, Debug)]
struct SplitMix64 {
    state: u64,
}

impl SplitMix64 {
    fn new(seed: u64) -> Self {
        Self { state: seed }
    }

    fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut value = self.state;
        value = (value ^ (value >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        value = (value ^ (value >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        value ^ (value >> 31)
    }

    fn next_u32(&mut self) -> u32 {
        self.next_u64() as u32
    }

    fn unit_f32(&mut self) -> f32 {
        let mantissa = self.next_u32() >> 8;
        mantissa as f32 / (1_u32 << 24) as f32
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn swept_bullet_detects_a_thin_box_between_endpoints() {
        let target =
            Aabb::from_center_half_extents([0.0, 0.0, 0.0], [0.2, 0.8, 0.5]);
        let time = segment_aabb_toi([-2.0, 0.0], [2.0, 0.0], target, 0.05).unwrap();
        assert!(time > 0.4 && time < 0.5);
    }

    #[test]
    fn arena_broad_phases_preserve_pair_set_parity() {
        let arena = ZombieArenaWorld::new_inner(Algorithm::Naive, 42);
        let bodies = arena.collision_bodies();
        let config = arena.broad_phase_config(bodies.len());
        let reference = run_algorithm(Algorithm::Naive, config, &bodies).pairs;
        for algorithm in Algorithm::ALL {
            assert_eq!(run_algorithm(algorithm, config, &bodies).pairs, reference);
        }
    }

    #[test]
    fn identical_inputs_produce_identical_snapshots() {
        let mut left = ZombieArenaWorld::new_inner(Algorithm::UniformGrid, 7);
        let mut right = ZombieArenaWorld::new_inner(Algorithm::UniformGrid, 7);
        for frame in 0..240 {
            let movement = if frame % 120 < 60 {
                [1.0, 0.4]
            } else {
                [-0.4, 1.0]
            };
            let aim = [6.0, 3.0];
            let shoot = frame % 10 == 0;
            left.step(movement, aim, shoot);
            right.step(movement, aim, shoot);
        }
        assert_eq!(left.snapshot().unwrap(), right.snapshot().unwrap());
    }

    #[test]
    fn build_positions_snap_to_the_shared_grid() {
        let mut arena = ZombieArenaWorld::new_inner(Algorithm::Naive, 99);
        assert!(arena.build_at([2.34, -2.61]));
        let wall = arena.walls.last().unwrap();
        assert_eq!(wall.position, [2.0, -3.0]);
        assert!(wall.destructible);
    }
}
