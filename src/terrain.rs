const FIXED_DT: f32 = 1.0 / 60.0;
const WALKER_HALF_HEIGHT: f32 = 0.85;
const WALKER_SPEED: f32 = 5.2;
const JUMP_IMPULSE: f32 = 6.4;
const GRAVITY: f32 = -17.0;
const MAX_WALKABLE_SLOPE_Y: f32 = 0.48;
const MAX_STEP_HEIGHT: f32 = 0.36;

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

    #[must_use]
    pub fn contact_at(&self, x: f32, z: f32) -> TerrainContact {
        let grid_size = self.config.grid_size;
        let cell_size = self.cell_size();
        let max_cell = grid_size - 2;
        let x = x.clamp(-self.config.world_half, self.config.world_half);
        let z = z.clamp(-self.config.world_half, self.config.world_half);
        let grid_x =
            ((x + self.config.world_half) / cell_size).min((grid_size - 1) as f32 - f32::EPSILON);
        let grid_z =
            ((z + self.config.world_half) / cell_size).min((grid_size - 1) as f32 - f32::EPSILON);
        let cell_x = (grid_x.floor() as usize).min(max_cell);
        let cell_z = (grid_z.floor() as usize).min(max_cell);
        let local_x = grid_x - cell_x as f32;
        let local_z = grid_z - cell_z as f32;
        let cell_index = cell_z * (grid_size - 1) + cell_x;
        let first_triangle = if (cell_x + cell_z) % 2 == 0 {
            local_z >= local_x
        } else {
            local_x + local_z <= 1.0
        };
        let triangle_in_cell = if first_triangle { 0 } else { 1 };
        let index_offset = (cell_index * 2 + triangle_in_cell) * 3;
        let vertices = [
            self.vertices[self.indices[index_offset] as usize],
            self.vertices[self.indices[index_offset + 1] as usize],
            self.vertices[self.indices[index_offset + 2] as usize],
        ];
        let height = barycentric_height(x, z, vertices);
        let normal = triangle_normal(vertices);

        TerrainContact {
            triangle: u32::try_from(cell_index * 2 + triangle_in_cell)
                .expect("validated terrain grid fits triangle identifiers"),
            height,
            normal,
            vertices,
        }
    }

    fn cell_size(&self) -> f32 {
        self.config.world_half * 2.0 / (self.config.grid_size - 1) as f32
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TerrainWalkerSnapshot {
    pub frame: u64,
    pub position: [f32; 3],
    pub velocity_y: f32,
    pub grounded: bool,
    pub contact: TerrainContact,
    pub triangle_queries: u64,
    pub total_triangle_queries: u64,
}

#[derive(Clone, Debug)]
pub struct BlueNoiseTerrainWorld {
    terrain: BlueNoiseTerrain,
    position: [f32; 3],
    velocity_y: f32,
    grounded: bool,
    frame: u64,
    triangle_queries: u64,
    total_triangle_queries: u64,
    contact: TerrainContact,
}

impl BlueNoiseTerrainWorld {
    pub fn new(config: BlueNoiseTerrainConfig) -> Result<Self, String> {
        let terrain = BlueNoiseTerrain::generate(config)?;
        let contact = terrain.contact_at(0.0, 0.0);
        Ok(Self {
            terrain,
            position: [0.0, contact.height + WALKER_HALF_HEIGHT, 0.0],
            velocity_y: 0.0,
            grounded: true,
            frame: 0,
            triangle_queries: 1,
            total_triangle_queries: 1,
            contact,
        })
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
            triangle_queries: self.triangle_queries,
            total_triangle_queries: self.total_triangle_queries,
        }
    }

    pub fn step(&mut self, movement: [f32; 2], jump: bool) -> TerrainWalkerSnapshot {
        self.frame = self.frame.saturating_add(1);
        self.triangle_queries = 0;
        let movement = normalize2_or_zero(movement);
        let distance = WALKER_SPEED * FIXED_DT;
        let was_grounded = self.grounded;

        for (axis, amount) in [(0, movement[0] * distance), (2, movement[1] * distance)] {
            let mut candidate = self.position;
            candidate[axis] = (candidate[axis] + amount).clamp(
                -self.terrain.config.world_half + 0.35,
                self.terrain.config.world_half - 0.35,
            );
            let candidate_contact = self.query_contact(candidate[0], candidate[2]);
            let height_delta = candidate_contact.height - self.contact.height;
            if !was_grounded
                || (candidate_contact.normal[1] >= MAX_WALKABLE_SLOPE_Y
                    && height_delta <= MAX_STEP_HEIGHT)
            {
                self.position[axis] = candidate[axis];
                self.contact = candidate_contact;
            }
        }

        if jump && self.grounded {
            self.velocity_y = JUMP_IMPULSE;
            self.grounded = false;
        }

        if self.grounded {
            self.position[1] = self.contact.height + WALKER_HALF_HEIGHT;
        } else {
            self.velocity_y += GRAVITY * FIXED_DT;
            self.position[1] += self.velocity_y * FIXED_DT;
            self.contact = self.query_contact(self.position[0], self.position[2]);
            let support_y = self.contact.height + WALKER_HALF_HEIGHT;
            if self.position[1] <= support_y && self.velocity_y <= 0.0 {
                self.position[1] = support_y;
                self.velocity_y = 0.0;
                self.grounded = true;
            }
        }

        self.snapshot()
    }

    fn query_contact(&mut self, x: f32, z: f32) -> TerrainContact {
        self.triangle_queries = self.triangle_queries.saturating_add(1);
        self.total_triangle_queries = self.total_triangle_queries.saturating_add(1);
        self.terrain.contact_at(x, z)
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

fn barycentric_height(x: f32, z: f32, vertices: [[f32; 3]; 3]) -> f32 {
    let [a, b, c] = vertices;
    let denominator = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
    let a_weight = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / denominator;
    let b_weight = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / denominator;
    let c_weight = 1.0 - a_weight - b_weight;
    a_weight * a[1] + b_weight * b[1] + c_weight * c[1]
}

fn triangle_normal(vertices: [[f32; 3]; 3]) -> [f32; 3] {
    let first = sub3(vertices[1], vertices[0]);
    let second = sub3(vertices[2], vertices[0]);
    let cross = [
        first[1] * second[2] - first[2] * second[1],
        first[2] * second[0] - first[0] * second[2],
        first[0] * second[1] - first[1] * second[0],
    ];
    let length = (cross[0] * cross[0] + cross[1] * cross[1] + cross[2] * cross[2]).sqrt();
    [cross[0] / length, cross[1] / length, cross[2] / length]
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

fn sub3(left: [f32; 3], right: [f32; 3]) -> [f32; 3] {
    [left[0] - right[0], left[1] - right[1], left[2] - right[2]]
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
    fn contact_height_is_interpolated_from_the_selected_mesh_triangle() {
        let terrain = BlueNoiseTerrain::generate(BlueNoiseTerrainConfig::default())
            .expect("default terrain is valid");
        let contact = terrain.contact_at(2.37, -4.81);
        let expected = barycentric_height(2.37, -4.81, contact.vertices);

        assert!((contact.height - expected).abs() <= f32::EPSILON);
        assert!(contact.normal[1] > 0.0);
        assert!((length3(contact.normal) - 1.0).abs() < 1.0e-5);
    }

    #[test]
    fn walker_remains_supported_by_the_authoritative_mesh() {
        let mut world = BlueNoiseTerrainWorld::new(BlueNoiseTerrainConfig::default())
            .expect("default terrain is valid");
        for _ in 0..180 {
            world.step([1.0, 0.35], false);
        }
        let snapshot = world.snapshot();
        let contact = world
            .terrain()
            .contact_at(snapshot.position[0], snapshot.position[2]);

        assert!(snapshot.grounded);
        assert!((snapshot.position[1] - (contact.height + WALKER_HALF_HEIGHT)).abs() < 1.0e-5);
        assert!(snapshot.total_triangle_queries > snapshot.frame);
    }

    #[test]
    fn jumping_leaves_and_returns_to_the_mesh() {
        let mut world = BlueNoiseTerrainWorld::new(BlueNoiseTerrainConfig::default())
            .expect("default terrain is valid");
        world.step([0.0, 0.0], true);
        assert!(!world.snapshot().grounded);
        for _ in 0..120 {
            world.step([0.0, 0.0], false);
        }
        assert!(world.snapshot().grounded);
    }

    fn length3(value: [f32; 3]) -> f32 {
        (value[0] * value[0] + value[1] * value[1] + value[2] * value[2]).sqrt()
    }
}
