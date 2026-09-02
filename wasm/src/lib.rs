use collision_lab::{
    Algorithm, Config, MotionConfig, MotionKind, Scenario, Simulation, run_algorithm,
};
use serde_json::json;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct DemoWorld {
    simulation: Simulation,
}

#[wasm_bindgen]
impl DemoWorld {
    #[wasm_bindgen(constructor)]
    pub fn new(
        scenario: &str,
        objects: u32,
        cell_size: f32,
        fat_margin: f32,
        seed: u32,
        world_extent: f32,
        half_extent: f32,
        dynamic_fraction: f32,
        speed: f32,
    ) -> Result<DemoWorld, JsValue> {
        let scenario = Scenario::parse(scenario).map_err(|error| JsValue::from_str(&error))?;
        let config = Config {
            objects: objects as usize,
            cell_size,
            fat_margin,
            seed: u64::from(seed),
            world_extent,
            half_extent,
            scenario,
        }
        .validate()
        .map_err(|error| JsValue::from_str(&error))?;
        let motion = MotionConfig {
            dynamic_fraction,
            speed,
        }
        .validate()
        .map_err(|error| JsValue::from_str(&error))?;

        Ok(Self {
            simulation: Simulation::new(config, motion),
        })
    }

    pub fn snapshot_json(&self, algorithm: &str) -> Result<String, JsValue> {
        snapshot_json(&self.simulation, algorithm)
    }

    pub fn step_json(&mut self, algorithm: &str, dt_seconds: f32) -> Result<String, JsValue> {
        self.simulation.step(dt_seconds);
        snapshot_json(&self.simulation, algorithm)
    }
}

#[wasm_bindgen]
pub fn run_demo_json(
    algorithm: &str,
    scenario: &str,
    objects: u32,
    cell_size: f32,
    fat_margin: f32,
    seed: u32,
    world_extent: f32,
    half_extent: f32,
) -> Result<String, JsValue> {
    let world = DemoWorld::new(
        scenario,
        objects,
        cell_size,
        fat_margin,
        seed,
        world_extent,
        half_extent,
        0.0,
        0.0,
    )?;
    world.snapshot_json(algorithm)
}

fn snapshot_json(simulation: &Simulation, algorithm: &str) -> Result<String, JsValue> {
    let algorithm = Algorithm::parse(algorithm).map_err(|error| JsValue::from_str(&error))?;
    let config = simulation.config();
    let bodies = simulation.bodies();
    let result = run_algorithm(algorithm, config, &bodies);
    let possible_pairs =
        (config.objects as u64).saturating_mul(config.objects.saturating_sub(1) as u64) / 2;
    let (static_count, dynamic_count) = simulation.counts();

    let body_json: Vec<_> = simulation
        .entities()
        .iter()
        .map(|entity| {
            json!({
                "id": entity.body.id,
                "min": entity.body.aabb.min,
                "max": entity.body.aabb.max,
                "motion": match entity.motion {
                    MotionKind::Static => "static",
                    MotionKind::Dynamic => "dynamic",
                },
                "velocity": entity.velocity,
            })
        })
        .collect();
    let pair_json: Vec<_> = result.pairs.iter().map(|pair| [pair.a, pair.b]).collect();

    serde_json::to_string(&json!({
        "algorithm": algorithm.as_str(),
        "scenario": config.scenario.as_str(),
        "frame": simulation.frame(),
        "bodies": body_json,
        "pairs": pair_json,
        "counts": {
            "static": static_count,
            "dynamic": dynamic_count,
        },
        "stats": {
            "aabbTests": result.stats.aabb_tests,
            "occupiedCells": result.stats.occupied_cells,
        },
        "possiblePairs": possible_pairs,
    }))
    .map_err(|error| JsValue::from_str(&error.to_string()))
}
