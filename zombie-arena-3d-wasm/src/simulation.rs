use collision_lab::{Config, Scenario, run_algorithm};
use spatial_kernels::Body;

use crate::collision::{
    aabb_overlaps, actor_aabb, collides_with_walls, expand_xz, grounded_center_y, inside_world3,
    is_supported, move_vertical, move_with_sliding_3d, segment_aabb_toi, wall_aabb,
};
use crate::flow_field::FlowField;
use crate::math::{
    add3, distance_squared_xz, length_squared2, lerp3, normalize2_or_zero, normalize3, scale3,
};
use crate::navigation::{astar, cell_to_world, world_to_cell};
use crate::{
    BARRICADE_ATTACK_REACH, BROAD_PHASE_CELL_SIZE, BROAD_PHASE_FAT_MARGIN, BULLET_LIFETIME,
    BULLET_RADIUS, BULLET_SPEED, Bullet, FIRE_INTERVAL, FIXED_DT, GRAVITY, JUMP_IMPULSE,
    MAX_ZOMBIES, NAV_MAX, NAV_MIN, NavigationMode, PATH_REPLAN_FRAMES, PLAYER_HALF,
    PLAYER_HIT_COOLDOWN, PLAYER_HIT_DAMAGE, PLAYER_ID, PLAYER_SPEED, SPAWN_INTERVAL_FRAMES,
    SweepDebug, WORLD_HALF, Wall, ZOMBIE_BARRICADE_DPS, ZOMBIE_HALF, ZOMBIE_MAX_HEALTH,
    ZOMBIE_SEPARATION_RADIUS, ZOMBIE_SEPARATION_WEIGHT, ZOMBIE_SPEED, Zombie, ZombieArena3dWorld,
};

#[derive(Clone, Copy, Debug)]
enum BulletHit {
    Wall,
    Zombie(usize),
}

impl ZombieArena3dWorld {
    pub(crate) fn step(&mut self, movement: [f32; 2], aim: [f32; 3], jump: bool, shoot: bool) {
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

    pub(crate) fn move_player(&mut self, movement: [f32; 2], jump: bool) {
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

    pub(crate) fn fire(&mut self) {
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

    pub(crate) fn step_zombies(&mut self) {
        let goal = world_to_cell(self.player.position);
        let frame = self.frame;
        let walls = &self.walls;
        let blocked = &self.blocked_navigation;

        let mut positions = std::mem::take(&mut self.zombie_position_scratch);
        positions.clear();
        positions.extend(self.zombies.iter().map(|zombie| zombie.position));

        let mut flow_targets = std::mem::take(&mut self.flow_target_scratch);
        flow_targets.clear();
        if self.navigation_mode == NavigationMode::FlowField {
            if self
                .flow_field
                .as_ref()
                .is_none_or(|field| field.goal != goal)
            {
                let field = FlowField::build(goal, blocked, NAV_MIN, NAV_MAX);
                self.metrics.flow_field_builds = 1;
                self.metrics.flow_field_expanded = u64::from(field.expanded);
                self.flow_field_builds_total = self.flow_field_builds_total.saturating_add(1);
                self.flow_field = Some(field);
            }
            let field = self.flow_field.as_ref().expect("flow field just built");
            flow_targets.extend(positions.iter().copied().map(|position| {
                let current = world_to_cell(position);
                if current == goal {
                    Some(self.player.position)
                } else {
                    field.next_cell(current).map(cell_to_world)
                }
            }));
        }

        for index in 0..self.zombies.len() {
            let start = world_to_cell(positions[index]);
            let avoidance = local_separation(index, &positions);
            let fallback = nearest_destructible_wall_target(positions[index], walls)
                .unwrap_or(self.player.position);

            let target = match self.navigation_mode {
                NavigationMode::Astar => {
                    let zombie = &mut self.zombies[index];
                    let needs_replan = frame >= zombie.next_replan_frame
                        || zombie.path_goal != Some(goal)
                        || zombie.path_cursor >= zombie.path.len();

                    if needs_replan {
                        self.metrics.path_replans = self.metrics.path_replans.saturating_add(1);
                        self.path_replans_total = self.path_replans_total.saturating_add(1);

                        if let Some(search) = astar(start, goal, blocked, NAV_MIN, NAV_MAX) {
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
            zombie.position = move_with_sliding_3d(zombie.position, ZOMBIE_HALF, delta, walls);
            zombie.position[1] = grounded_center_y(zombie.position, ZOMBIE_HALF, walls);
        }

        self.zombie_position_scratch = positions;
        self.flow_target_scratch = flow_targets;
    }

    pub(crate) fn step_bullets(&mut self) {
        let mut bullets = std::mem::take(&mut self.bullets);
        let mut survivors = std::mem::take(&mut self.bullet_survivor_scratch);
        survivors.clear();

        for mut bullet in bullets.drain(..) {
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
        self.bullet_survivor_scratch = bullets;
        self.bullets = survivors;
    }

    pub(crate) fn resolve_actor_overlaps(&mut self) {
        let mut bodies = std::mem::take(&mut self.collision_body_scratch);
        self.fill_collision_bodies(&mut bodies);
        let result = run_algorithm(
            self.algorithm,
            self.broad_phase_config(bodies.len()),
            &bodies,
        );
        self.resolved_bodies.clear();
        self.resolved_bodies.extend_from_slice(&bodies);
        self.collision_body_scratch = bodies;

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
        self.resolved_broad_phase = Some((self.algorithm, result));
    }

    pub(crate) fn attack_barricades(&mut self) {
        if !self.walls.iter().any(|wall| wall.destructible) {
            return;
        }

        let mut damage = std::mem::take(&mut self.barricade_damage_scratch);
        damage.clear();
        damage.resize(self.walls.len(), 0.0);
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

        for (wall, damage) in self.walls.iter_mut().zip(damage.iter().copied()) {
            if wall.destructible && damage > 0.0 {
                wall.health = (wall.health - damage).max(0.0);
            }
        }

        let before = self.walls.len();
        self.walls
            .retain(|wall| !wall.destructible || wall.health > 0.0);
        let destroyed = before.saturating_sub(self.walls.len());
        self.barricade_damage_scratch = damage;
        if destroyed > 0 {
            let destroyed = u64::try_from(destroyed).unwrap_or(u64::MAX);
            self.metrics.destroyed_barricades = destroyed;
            self.destroyed_barricades_total =
                self.destroyed_barricades_total.saturating_add(destroyed);
            self.invalidate_navigation();
        }
    }

    pub(crate) fn separate_zombies(&mut self, left: usize, right: usize) {
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

    pub(crate) fn spawn_zombie(&mut self) {
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

    pub(crate) fn replan_all_zombies(&mut self) {
        for zombie in &mut self.zombies {
            zombie.next_replan_frame = 0;
        }
        self.step_zombies();
    }

    pub(crate) fn refresh_collision_metrics(&mut self) {
        let mut bodies = std::mem::take(&mut self.collision_body_scratch);
        self.fill_collision_bodies(&mut bodies);
        // Detection is a pure function of the algorithm and bodies, so the result
        // from overlap resolution still holds if nothing has moved since.
        let result = match self.resolved_broad_phase.take() {
            Some((algorithm, result))
                if algorithm == self.algorithm && self.resolved_bodies == bodies =>
            {
                result
            }
            _ => run_algorithm(
                self.algorithm,
                self.broad_phase_config(bodies.len()),
                &bodies,
            ),
        };
        self.metrics.possible_pairs = possible_pair_count(bodies.len());
        self.collision_body_scratch = bodies;
        self.metrics.aabb_tests = result.stats.aabb_tests;
        self.metrics.occupied_cells = result.stats.occupied_cells.unwrap_or(0);
        self.metrics.overlaps = result.pairs.len();
        self.metrics.overlap_pairs = result.pairs;
    }

    pub(crate) fn fill_collision_bodies(&self, bodies: &mut Vec<Body>) {
        bodies.clear();
        bodies.reserve(1 + self.zombies.len() + self.walls.len());
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
    }

    pub(crate) fn broad_phase_config(&self, objects: usize) -> Config {
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

    pub(crate) fn zombie_index(&self, id: u32) -> Option<usize> {
        self.zombies
            .binary_search_by_key(&id, |zombie| zombie.id)
            .ok()
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

pub(crate) fn local_separation(index: usize, positions: &[[f32; 3]]) -> [f32; 2] {
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
