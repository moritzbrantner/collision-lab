use collision_lab::{Algorithm, Config, Scenario, generate_scene, run_algorithm};
use serde_json::json;
use wasm_bindgen::prelude::*;

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
    let algorithm = Algorithm::parse(algorithm).map_err(|error| JsValue::from_str(&error))?;
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

    let bodies = generate_scene(config);
    let result = run_algorithm(algorithm, config, &bodies);
    let possible_pairs =
        (config.objects as u64).saturating_mul(config.objects.saturating_sub(1) as u64) / 2;

    let body_json: Vec<_> = bodies
        .iter()
        .map(|body| {
            json!({
                "id": body.id,
                "min": body.aabb.min,
                "max": body.aabb.max,
            })
        })
        .collect();
    let pair_json: Vec<_> = result.pairs.iter().map(|pair| [pair.a, pair.b]).collect();

    serde_json::to_string(&json!({
        "algorithm": algorithm.as_str(),
        "scenario": scenario.as_str(),
        "bodies": body_json,
        "pairs": pair_json,
        "stats": {
            "aabbTests": result.stats.aabb_tests,
            "occupiedCells": result.stats.occupied_cells,
        },
        "possiblePairs": possible_pairs,
    }))
    .map_err(|error| JsValue::from_str(&error.to_string()))
}
