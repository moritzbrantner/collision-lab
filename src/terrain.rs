const FIXED_DT: f32 = 1.0 / 60.0;
const WALKER_HALF_HEIGHT: f32 = 0.85;
const WALKER_SPEED: f32 = 5.2;
const JUMP_IMPULSE: f32 = 6.4;
const GRAVITY: f32 = -17.0;
/// The walker capsule's radius; `WALKER_HALF_HEIGHT` is its center-to-bottom distance.
const WALKER_RADIUS: f32 = 0.34;
/// Steepest climbable slope: `acos(0.48)`, about 61.3 degrees.
const MAX_SLOPE_CLIMB_ANGLE: f32 = 1.070_142;
/// Rapier character-controller skin between the capsule and the terrain.
const CONTACT_OFFSET: f32 = 0.01;
/// How far a walking capsule is pulled down onto the ground below it each step.
const SNAP_TO_GROUND: f32 = 0.3;
/// Half thickness of the boundary walls around the terrain.
const WALL_THICKNESS: f32 = 0.5;
/// Height above the tallest possible terrain from which support rays start.
const SUPPORT_RAY_CLEARANCE: f32 = 1.0;

use rapier3d::control::{CharacterLength, KinematicCharacterController};
use rapier3d::parry::query::DefaultQueryDispatcher;
use rapier3d::prelude::*;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BlueNoiseTerrainConfig {
    pub seed: u64,
    pub grid_size: usize,
    pub site_count: usize,
    pub candidates_per_site: usize,
    pub world_half: f32,
    pub height_scale: f32,
}

impl Default for BlueNoiseTerrainConfig {
    fn default() -> Self {
        Self {
            seed: 73,
            grid_size: 65,
            site_count: 84,
            candidates_per_site: 32,
            world_half: 14.0,
            height_scale: 2.6,
        }
    }
}

impl BlueNoiseTerrainConfig {
    pub fn validate(self) -> Result<Self, String> {
        if !(3..=257).contains(&self.grid_size) {
            return Err("terrain grid size must be between 3 and 257".to_owned());
        }
        if self.site_count == 0 || self.site_count > 4_096 {
            return Err("blue-noise site count must be between 1 and 4096".to_owned());
        }
        if self.candidates_per_site == 0 || self.candidates_per_site > 256 {
            return Err("blue-noise candidate count must be between 1 and 256".to_owned());
        }
        if !self.world_half.is_finite() || self.world_half <= 0.0 {
            return Err("terrain world half extent must be positive and finite".to_owned());
        }
        if !self.height_scale.is_finite() || self.height_scale <= 0.0 {
            return Err("terrain height scale must be positive and finite".to_owned());
        }
        Ok(self)
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BlueNoiseSite {
    pub position: [f32; 2],
    pub amplitude: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TerrainGenerationStats {
    pub candidate_evaluations: u64,
    pub height_contributions: u64,
    pub minimum_site_distance: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TerrainContact {
    pub triangle: u32,
    pub height: f32,
    pub normal: [f32; 3],
    pub vertices: [[f32; 3]; 3],
}

#[derive(Clone, Debug)]
pub struct BlueNoiseTerrain {
    config: BlueNoiseTerrainConfig,
    sites: Vec<BlueNoiseSite>,
    vertices: Vec<[f32; 3]>,
    indices: Vec<u32>,
    stats: TerrainGenerationStats,
}

impl BlueNoiseTerrain {
    pub fn generate(config: BlueNoiseTerrainConfig) -> Result<Self, String> {
        let config = config.validate()?;
        let mut site_rng = SplitMix64::new(config.seed ^ 0x424C_5545_4E4F_4953);
        let positions = generate_best_candidate_sites(config, &mut site_rng);
        let mut amplitude_rng = SplitMix64::new(config.seed ^ 0x4845_4947_4854_5354);
        let sites = positions
            .into_iter()
            .map(|position| {
                let sign = if amplitude_rng.next_u32() & 1 == 0 {
                    -1.0
                } else {
                    1.0
                };
                let amplitude = sign * amplitude_rng.range_f32(0.45, 1.0);
                BlueNoiseSite {
                    position,
                    amplitude,
                }
            })
            .collect::<Vec<_>>();

        let mut vertices = generate_vertices(config, &sites);
        normalize_heights(&mut vertices, config.height_scale);
        let indices = generate_indices(config.grid_size)?;
        let minimum_site_distance = minimum_site_distance(&sites, config.world_half);
        let candidate_evaluations = u64::try_from(config.site_count.saturating_sub(1))
            .unwrap_or(u64::MAX)
            .saturating_mul(u64::try_from(config.candidates_per_site).unwrap_or(u64::MAX));
        let height_contributions = u64::try_from(vertices.len())
            .unwrap_or(u64::MAX)
            .saturating_mul(u64::try_from(sites.len()).unwrap_or(u64::MAX));

        Ok(Self {
            config,
            sites,
            vertices,
            indices,
            stats: TerrainGenerationStats {
                candidate_evaluations,
                height_contributions,
                minimum_site_distance,
            },
        })
    }

    #[must_use]
    pub const fn config(&self) -> BlueNoiseTerrainConfig {
        self.config
    }

    #[must_use]
    pub fn sites(&self) -> &[BlueNoiseSite] {
        &self.sites
    }

    #[must_use]
    pub fn vertices(&self) -> &[[f32; 3]] {
        &self.vertices
    }

    #[must_use]
    pub fn indices(&self) -> &[u32] {
        &self.indices
    }

    #[must_use]
    pub const fn stats(&self) -> TerrainGenerationStats {
        self.stats
    }

    #[must_use]
    pub fn triangle_count(&self) -> usize {
        self.indices.len() / 3
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TerrainWalkerSnapshot {
    pub frame: u64,
    pub position: [f32; 3],
    pub velocity_y: f32,
    pub grounded: bool,
    pub contact: TerrainContact,
    /// Rapier queries issued during the last step (one controller move, one support ray).
    pub engine_queries: u64,
    pub total_engine_queries: u64,
}

/// The walker on the blue-noise terrain, with Rapier as the collision and support authority.
///
/// The terrain is one persistent Rapier triangle-mesh collider built from the generated index
/// buffer, so Rapier's triangle ids are the lab's triangle ids. Four static walls keep the walker
/// on the terrain. The walker is a capsule moved by Rapier's `KinematicCharacterController`,
/// which owns sliding, slope limits, ground snapping and the grounded state; the lab owns only
/// movement intent (speed, jump impulse and gravity). The support evidence (active triangle,
/// height and normal) is a Rapier ray cast straight down from the capsule's center.
pub struct BlueNoiseTerrainWorld {
    terrain: BlueNoiseTerrain,
    physics: PhysicsWorld,
    terrain_collider: ColliderHandle,
    walker: Capsule,
    walking: KinematicCharacterController,
    airborne: KinematicCharacterController,
    position: [f32; 3],
    velocity_y: f32,
    grounded: bool,
    frame: u64,
    engine_queries: u64,
    total_engine_queries: u64,
    contact: TerrainContact,
}

impl BlueNoiseTerrainWorld {
    pub fn new(config: BlueNoiseTerrainConfig) -> Result<Self, String> {
        let terrain = BlueNoiseTerrain::generate(config)?;
        let mut physics = PhysicsWorld::new();
        // Gravity and jumps are movement intent the lab owns: no Rapier body is dynamic.
        physics.gravity = Vector::ZERO;
        physics.integration_parameters.dt = FIXED_DT;

        let vertices = terrain
            .vertices()
            .iter()
            .map(|vertex| Vector::new(vertex[0], vertex[1], vertex[2]))
            .collect();
        let indices = terrain
            .indices()
            .chunks_exact(3)
            .map(|triangle| [triangle[0], triangle[1], triangle[2]])
            .collect();
        // Fixing internal edges keeps the capsule from catching on shared triangle edges; it
        // keeps the triangle order, so Rapier's triangle ids match the index buffer.
        let terrain_collider = physics.colliders.insert(
            ColliderBuilder::trimesh_with_flags(
                vertices,
                indices,
                TriMeshFlags::FIX_INTERNAL_EDGES,
            )
            .map_err(|error| format!("Rapier rejected the terrain mesh: {error}"))?
            .build(),
        );
        insert_walls(&mut physics, terrain.config());
        physics.detect_collisions(&(), &());

        let airborne = KinematicCharacterController {
            up: Vector::Y,
            offset: CharacterLength::Absolute(CONTACT_OFFSET),
            slide: true,
            autostep: None,
            max_slope_climb_angle: MAX_SLOPE_CLIMB_ANGLE,
            min_slope_slide_angle: MAX_SLOPE_CLIMB_ANGLE,
            snap_to_ground: None,
            normal_nudge_factor: KinematicCharacterController::default().normal_nudge_factor,
        };
        let walking = KinematicCharacterController {
            snap_to_ground: Some(CharacterLength::Absolute(SNAP_TO_GROUND)),
            ..airborne
        };

        let mut world = Self {
            terrain,
            physics,
            terrain_collider,
            walker: Capsule::new_y(WALKER_HALF_HEIGHT - WALKER_RADIUS, WALKER_RADIUS),
            walking,
            airborne,
            position: [0.0, 0.0, 0.0],
            velocity_y: 0.0,
            grounded: false,
            frame: 0,
            engine_queries: 0,
            total_engine_queries: 0,
            contact: TerrainContact {
                triangle: 0,
                height: 0.0,
                normal: [0.0, 1.0, 0.0],
                vertices: [[0.0; 3]; 3],
            },
        };
        let spawn = world
            .support_at(0.0, 0.0)
            .ok_or_else(|| "the terrain has no support at the spawn point".to_owned())?;
        // Rest the capsule's lower sphere on the spawn triangle's plane, then let the
        // controller settle it.
        world.position = [
            0.0,
            spawn.height
                + WALKER_HALF_HEIGHT
                + WALKER_RADIUS * (1.0 / spawn.normal[1] - 1.0)
                + CONTACT_OFFSET,
            0.0,
        ];
        world.contact = spawn;
        world.move_walker(Vector::new(0.0, -SNAP_TO_GROUND, 0.0), true);
        world.engine_queries = world.engine_queries.saturating_add(1);
        world.total_engine_queries = world.engine_queries;
        Ok(world)
    }

    #[must_use]
    pub fn terrain(&self) -> &BlueNoiseTerrain {
        &self.terrain
    }

    #[must_use]
    pub const fn snapshot(&self) -> TerrainWalkerSnapshot {
        TerrainWalkerSnapshot {
            frame: self.frame,
            position: self.position,
            velocity_y: self.velocity_y,
            grounded: self.grounded,
            contact: self.contact,
            engine_queries: self.engine_queries,
            total_engine_queries: self.total_engine_queries,
        }
    }

    /// The terrain triangle straight below `(x, z)`, as Rapier's ray cast reports it.
    #[must_use]
    pub fn support_at(&self, x: f32, z: f32) -> Option<TerrainContact> {
        let collider = &self.physics.colliders[self.terrain_collider];
        let mesh = collider.shape().as_trimesh()?;
        let top = self.terrain.config().height_scale + SUPPORT_RAY_CLEARANCE;
        let ray = Ray::new(Vector::new(x, top, z), -Vector::Y);
        let hit = collider.shape().cast_ray_and_get_normal(
            collider.position(),
            &ray,
            top + self.terrain.config().height_scale + SUPPORT_RAY_CLEARANCE,
            true,
        )?;
        let triangle = mesh.triangle(hit.subshape);
        Some(TerrainContact {
            triangle: hit.subshape,
            height: ray.point_at(hit.time_of_impact).y,
            normal: hit.normal.into(),
            vertices: [triangle.a.into(), triangle.b.into(), triangle.c.into()],
        })
    }

    pub fn step(&mut self, movement: [f32; 2], jump: bool) -> TerrainWalkerSnapshot {
        self.frame = self.frame.saturating_add(1);
        self.engine_queries = 0;
        let movement = normalize2_or_zero(movement);
        let distance = WALKER_SPEED * FIXED_DT;
        let walking = self.grounded && !jump;
        if jump && self.grounded {
            self.velocity_y = JUMP_IMPULSE;
        }
        self.velocity_y += GRAVITY * FIXED_DT;
        let desired = Vector::new(
            movement[0] * distance,
            self.velocity_y * FIXED_DT,
            movement[1] * distance,
        );
        self.move_walker(desired, walking);
        self.total_engine_queries = self
            .total_engine_queries
            .saturating_add(self.engine_queries);
        self.snapshot()
    }

    /// One controller move plus the support ray under the new position.
    fn move_walker(&mut self, desired: Vector, walking: bool) {
        let queries = self.physics.broad_phase.as_query_pipeline(
            &DefaultQueryDispatcher,
            &self.physics.bodies,
            &self.physics.colliders,
            QueryFilter::default(),
        );
        let controller = if walking {
            &self.walking
        } else {
            &self.airborne
        };
        let movement = controller.move_shape(
            FIXED_DT,
            &queries,
            &self.walker,
            &Pose::from_translation(Vector::from(self.position)),
            desired,
            |_| {},
        );
        self.position = (Vector::from(self.position) + movement.translation).into();
        // A rising walker is never grounded, even while it is still within the contact offset.
        self.grounded = movement.grounded && self.velocity_y <= 0.0;
        if self.grounded {
            self.velocity_y = 0.0;
        }
        if let Some(contact) = self.support_at(self.position[0], self.position[2]) {
            self.contact = contact;
        }
        self.engine_queries = self.engine_queries.saturating_add(2);
    }
}

/// Static walls just outside the walker's reach on every side, high enough for any jump.
fn insert_walls(physics: &mut PhysicsWorld, config: BlueNoiseTerrainConfig) {
    let inner = config.world_half;
    let half_height = config.height_scale + 6.0;
    let half_length = config.world_half + WALL_THICKNESS;
    for (center, half_extents) in [
        (
            [inner + WALL_THICKNESS, 0.0, 0.0],
            [WALL_THICKNESS, half_height, half_length],
        ),
        (
            [-inner - WALL_THICKNESS, 0.0, 0.0],
            [WALL_THICKNESS, half_height, half_length],
        ),
        (
            [0.0, 0.0, inner + WALL_THICKNESS],
            [half_length, half_height, WALL_THICKNESS],
        ),
        (
            [0.0, 0.0, -inner - WALL_THICKNESS],
            [half_length, half_height, WALL_THICKNESS],
        ),
    ] {
        physics.colliders.insert(
            ColliderBuilder::cuboid(half_extents[0], half_extents[1], half_extents[2])
                .translation(Vector::from(center))
                .build(),
        );
    }
}

fn generate_best_candidate_sites(
    config: BlueNoiseTerrainConfig,
    rng: &mut SplitMix64,
) -> Vec<[f32; 2]> {
    let mut sites = Vec::with_capacity(config.site_count);
    sites.push(random_site(rng, config.world_half));
    while sites.len() < config.site_count {
        let mut best = random_site(rng, config.world_half);
        let mut best_distance = nearest_wrapped_distance_squared(best, &sites, config.world_half);
        for _ in 1..config.candidates_per_site {
            let candidate = random_site(rng, config.world_half);
            let distance = nearest_wrapped_distance_squared(candidate, &sites, config.world_half);
            if distance > best_distance {
                best = candidate;
                best_distance = distance;
            }
        }
        sites.push(best);
    }
    sites
}

fn generate_vertices(config: BlueNoiseTerrainConfig, sites: &[BlueNoiseSite]) -> Vec<[f32; 3]> {
    let cell_size = config.world_half * 2.0 / (config.grid_size - 1) as f32;
    let feature_radius = config.world_half * 2.0 / (config.site_count as f32).sqrt() * 1.75;
    let mut vertices = Vec::with_capacity(config.grid_size * config.grid_size);
    for z_index in 0..config.grid_size {
        let z = -config.world_half + z_index as f32 * cell_size;
        for x_index in 0..config.grid_size {
            let x = -config.world_half + x_index as f32 * cell_size;
            let mut height = 0.0;
            for site in sites {
                let dx = wrapped_axis_distance(x, site.position[0], config.world_half);
                let dz = wrapped_axis_distance(z, site.position[1], config.world_half);
                let distance = (dx * dx + dz * dz).sqrt();
                let influence = (1.0 - distance / feature_radius).clamp(0.0, 1.0);
                let smooth = influence * influence * (3.0 - 2.0 * influence);
                height += site.amplitude * smooth;
            }
            let edge_distance = (config.world_half - x.abs()).min(config.world_half - z.abs());
            let edge_fade = (edge_distance / (config.world_half * 0.18)).clamp(0.0, 1.0);
            vertices.push([x, height * edge_fade, z]);
        }
    }
    vertices
}

fn normalize_heights(vertices: &mut [[f32; 3]], height_scale: f32) {
    let mean = vertices.iter().map(|vertex| vertex[1]).sum::<f32>() / vertices.len() as f32;
    let max_abs = vertices
        .iter()
        .map(|vertex| (vertex[1] - mean).abs())
        .fold(0.0_f32, f32::max)
        .max(f32::EPSILON);
    for vertex in vertices {
        vertex[1] =
            ((vertex[1] - mean) / max_abs * height_scale).clamp(-height_scale, height_scale);
    }
}

fn generate_indices(grid_size: usize) -> Result<Vec<u32>, String> {
    let vertex_count = grid_size
        .checked_mul(grid_size)
        .ok_or_else(|| "terrain vertex count overflowed".to_owned())?;
    if vertex_count > u32::MAX as usize {
        return Err("terrain vertex count must fit u32 indices".to_owned());
    }
    let mut indices = Vec::with_capacity((grid_size - 1) * (grid_size - 1) * 6);
    for z in 0..grid_size - 1 {
        for x in 0..grid_size - 1 {
            let a = u32::try_from(z * grid_size + x).map_err(|error| error.to_string())?;
            let b = a + 1;
            let c = a + u32::try_from(grid_size).map_err(|error| error.to_string())?;
            let d = c + 1;
            if (x + z) % 2 == 0 {
                indices.extend_from_slice(&[a, c, d, a, d, b]);
            } else {
                indices.extend_from_slice(&[a, c, b, b, c, d]);
            }
        }
    }
    Ok(indices)
}

fn minimum_site_distance(sites: &[BlueNoiseSite], world_half: f32) -> f32 {
    if sites.len() < 2 {
        return 0.0;
    }
    let mut minimum = f32::INFINITY;
    for (index, site) in sites.iter().enumerate() {
        for other in &sites[index + 1..] {
            let dx = wrapped_axis_distance(site.position[0], other.position[0], world_half);
            let dz = wrapped_axis_distance(site.position[1], other.position[1], world_half);
            minimum = minimum.min((dx * dx + dz * dz).sqrt());
        }
    }
    minimum
}

fn nearest_wrapped_distance_squared(
    candidate: [f32; 2],
    sites: &[[f32; 2]],
    world_half: f32,
) -> f32 {
    sites
        .iter()
        .map(|site| {
            let dx = wrapped_axis_distance(candidate[0], site[0], world_half);
            let dz = wrapped_axis_distance(candidate[1], site[1], world_half);
            dx * dx + dz * dz
        })
        .fold(f32::INFINITY, f32::min)
}

fn wrapped_axis_distance(left: f32, right: f32, world_half: f32) -> f32 {
    let direct = (left - right).abs();
    direct.min(world_half * 2.0 - direct)
}

fn random_site(rng: &mut SplitMix64, world_half: f32) -> [f32; 2] {
    [
        rng.range_f32(-world_half, world_half),
        rng.range_f32(-world_half, world_half),
    ]
}

fn normalize2_or_zero(value: [f32; 2]) -> [f32; 2] {
    let length_squared = value[0] * value[0] + value[1] * value[1];
    if length_squared <= f32::EPSILON {
        [0.0, 0.0]
    } else {
        let inverse = length_squared.sqrt().recip();
        [value[0] * inverse, value[1] * inverse]
    }
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
        let mut value = self.state;
        value = (value ^ (value >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        value = (value ^ (value >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        value ^ (value >> 31)
    }

    fn next_u32(&mut self) -> u32 {
        (self.next_u64() >> 32) as u32
    }

    fn unit_f32(&mut self) -> f32 {
        self.next_u32() as f32 / u32::MAX as f32
    }

    fn range_f32(&mut self, min: f32, max: f32) -> f32 {
        min + (max - min) * self.unit_f32()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terrain_generation_is_deterministic_and_well_formed() {
        let first = BlueNoiseTerrain::generate(BlueNoiseTerrainConfig::default())
            .expect("default terrain is valid");
        let second = BlueNoiseTerrain::generate(BlueNoiseTerrainConfig::default())
            .expect("default terrain is valid");

        assert_eq!(first.sites(), second.sites());
        assert_eq!(first.vertices(), second.vertices());
        assert_eq!(first.indices(), second.indices());
        assert_eq!(first.vertices().len(), 65 * 65);
        assert_eq!(first.triangle_count(), 64 * 64 * 2);
        assert!(first.indices().iter().all(|index| *index < 65 * 65));
        assert!(first.stats().minimum_site_distance > 1.0);
    }

    #[test]
    fn rapier_support_reports_the_index_buffer_triangle_and_its_plane() {
        let world = BlueNoiseTerrainWorld::new(BlueNoiseTerrainConfig::default())
            .expect("default terrain is valid");
        let terrain = world.terrain();
        for (x, z) in [(2.37, -4.81), (0.0, 0.0), (-9.1, 7.3), (11.2, 11.9)] {
            let contact = world.support_at(x, z).expect("terrain covers the point");
            let offset = contact.triangle as usize * 3;
            let expected_vertices = [
                terrain.vertices()[terrain.indices()[offset] as usize],
                terrain.vertices()[terrain.indices()[offset + 1] as usize],
                terrain.vertices()[terrain.indices()[offset + 2] as usize],
            ];

            assert_eq!(contact.vertices, expected_vertices);
            assert!((contact.height - barycentric_height(x, z, contact.vertices)).abs() < 1.0e-4);
            assert!(contact.normal[1] > 0.0);
            assert!((length3(contact.normal) - 1.0).abs() < 1.0e-5);
        }
    }

    #[test]
    fn walker_remains_supported_by_the_rapier_mesh() {
        let mut world = BlueNoiseTerrainWorld::new(BlueNoiseTerrainConfig::default())
            .expect("default terrain is valid");
        assert!(world.snapshot().grounded);
        for _ in 0..180 {
            world.step([1.0, 0.35], false);
        }
        let snapshot = world.snapshot();
        let contact = world
            .support_at(snapshot.position[0], snapshot.position[2])
            .expect("the walker stays above the terrain");
        // A capsule resting on a plane with normal `n` has its center `r / n.y - r` above the
        // height a vertical line through its center meets, on top of its flat-ground height.
        let resting =
            WALKER_HALF_HEIGHT + WALKER_RADIUS * (1.0 / contact.normal[1] - 1.0) + CONTACT_OFFSET;

        assert!(snapshot.grounded);
        assert!(snapshot.position[0] > 4.0, "the walker crossed the terrain");
        assert!(
            (snapshot.position[1] - contact.height - resting).abs() < 0.1,
            "center {} above support {} (expected {resting})",
            snapshot.position[1],
            contact.height,
        );
        assert!(snapshot.total_engine_queries > snapshot.frame);
    }

    #[test]
    fn walls_keep_the_walker_on_the_terrain() {
        let mut world = BlueNoiseTerrainWorld::new(BlueNoiseTerrainConfig::default())
            .expect("default terrain is valid");
        let limit = BlueNoiseTerrainConfig::default().world_half - WALKER_RADIUS + 1.0e-3;
        for _ in 0..360 {
            let snapshot = world.step([-1.0, 1.0], false);
            assert!(snapshot.position[0].abs() <= limit && snapshot.position[2].abs() <= limit);
        }
    }

    #[test]
    fn jumping_leaves_and_returns_to_the_mesh() {
        let mut world = BlueNoiseTerrainWorld::new(BlueNoiseTerrainConfig::default())
            .expect("default terrain is valid");
        let start = world.snapshot().position[1];
        world.step([0.0, 0.0], true);
        assert!(!world.snapshot().grounded);
        let mut apex = start;
        for _ in 0..120 {
            apex = apex.max(world.step([0.0, 0.0], false).position[1]);
        }
        // Ballistic apex: v^2 / 2g = 6.4^2 / 34, about 1.2 m, less discretization.
        assert!(
            apex - start > 1.0 && apex - start < 1.3,
            "apex rise {}",
            apex - start
        );
        let landed = world.snapshot();
        assert!(landed.grounded);
        assert!((landed.position[1] - start).abs() < 0.05);
    }

    #[test]
    fn same_inputs_replay_identically() {
        let run = || {
            let mut world = BlueNoiseTerrainWorld::new(BlueNoiseTerrainConfig::default())
                .expect("default terrain is valid");
            (0..240)
                .map(|frame| {
                    let angle = frame as f32 * 0.03;
                    world.step([angle.cos(), angle.sin()], frame % 70 == 0)
                })
                .collect::<Vec<_>>()
        };
        assert_eq!(run(), run());
    }

    /// Independent reference: the height of the triangle's plane at `(x, z)`.
    fn barycentric_height(x: f32, z: f32, vertices: [[f32; 3]; 3]) -> f32 {
        let [a, b, c] = vertices;
        let denominator = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
        let a_weight = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / denominator;
        let b_weight = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / denominator;
        let c_weight = 1.0 - a_weight - b_weight;
        a_weight * a[1] + b_weight * b[1] + c_weight * c[1]
    }

    fn length3(value: [f32; 3]) -> f32 {
        (value[0] * value[0] + value[1] * value[1] + value[2] * value[2]).sqrt()
    }
}
