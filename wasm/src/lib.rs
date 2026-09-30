#[path = "physics_engine.rs"]
mod physics_engine_evidence;
mod presets;

use bvh_kernels::DynamicAabbNodeSnapshot;
use bvh_trace_kernels::{StaticBvhNodeSnapshot, trace_static_bvh};
use collision_lab::{
    Algorithm, BlueNoiseTerrainConfig, BlueNoiseTerrainWorld as TerrainWorld, CollisionLayer,
    Config, InteractionConfig, InteractionWork, MotionConfig, RetainedSyncTrace, Scenario,
    Simulation, generate_scene, run_algorithm,
};
use octree_kernels::{OctreeBroadPhase, OctreeNodeSnapshot};
use presets::ScenePreset;
use serde_json::{Value, json};
use spatial_kernels::{Aabb, Axis3, Pair, SweepAndPruneBroadPhase, UniformGridBroadPhase};
use wasm_bindgen::prelude::*;

const TRACE_PAIR_PREVIEW_LIMIT: usize = 32;

#[wasm_bindgen]
pub struct BlueNoiseTerrainWorld {
    world: TerrainWorld,
}

#[wasm_bindgen]
impl BlueNoiseTerrainWorld {
    #[wasm_bindgen(constructor)]
    pub fn new(seed: u32) -> Result<BlueNoiseTerrainWorld, JsValue> {
        let world = TerrainWorld::new(BlueNoiseTerrainConfig {
            seed: u64::from(seed),
            ..BlueNoiseTerrainConfig::default()
        })
        .map_err(|error| JsValue::from_str(&error))?;
        Ok(Self { world })
    }

    pub fn terrain_json(&self) -> Result<String, JsValue> {
        let terrain = self.world.terrain();
        let config = terrain.config();
        let stats = terrain.stats();
        serde_json::to_string(&json!({
            "seed": config.seed,
            "gridSize": config.grid_size,
            "worldHalf": config.world_half,
            "heightScale": config.height_scale,
            "sites": terrain.sites().iter().map(|site| {
                let contact = terrain.contact_at(site.position[0], site.position[1]);
                json!({
                    "position": site.position,
                    "surfaceHeight": contact.height,
                    "amplitude": site.amplitude,
                })
            }).collect::<Vec<_>>(),
            "vertices": terrain.vertices(),
            "indices": terrain.indices(),
            "stats": {
                "vertices": terrain.vertices().len(),
                "triangles": terrain.triangle_count(),
                "blueNoiseSites": terrain.sites().len(),
                "candidatesPerSite": config.candidates_per_site,
                "candidateEvaluations": stats.candidate_evaluations,
                "heightContributions": stats.height_contributions,
                "minimumSiteDistance": stats.minimum_site_distance,
            },
        }))
        .map_err(|error| JsValue::from_str(&error.to_string()))
    }

    pub fn snapshot_json(&self) -> Result<String, JsValue> {
        terrain_snapshot_json(&self.world)
    }

    pub fn step_json(&mut self, move_x: f32, move_z: f32, jump: bool) -> Result<String, JsValue> {
        if !move_x.is_finite() || !move_z.is_finite() {
            return Err(JsValue::from_str("terrain movement input must be finite"));
        }
        self.world.step([move_x, move_z], jump);
        terrain_snapshot_json(&self.world)
    }
}

fn terrain_snapshot_json(world: &TerrainWorld) -> Result<String, JsValue> {
    let snapshot = world.snapshot();
    serde_json::to_string(&json!({
        "frame": snapshot.frame,
        "position": snapshot.position,
        "velocityY": snapshot.velocity_y,
        "grounded": snapshot.grounded,
        "contact": {
            "triangle": snapshot.contact.triangle,
            "height": snapshot.contact.height,
            "normal": snapshot.contact.normal,
            "vertices": snapshot.contact.vertices,
        },
        "triangleQueries": snapshot.triangle_queries,
        "totalTriangleQueries": snapshot.total_triangle_queries,
    }))
    .map_err(|error| JsValue::from_str(&error.to_string()))
}

#[wasm_bindgen]
pub struct DemoWorld {
    simulation: Simulation,
    dynamic_trace: RetainedSyncTrace,
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
        sensor_fraction: f32,
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
        let interaction = InteractionConfig { sensor_fraction }
            .validate()
            .map_err(|error| JsValue::from_str(&error))?;
        let simulation = Simulation::new(config, motion, interaction);

        Ok(Self {
            simulation,
            dynamic_trace: RetainedSyncTrace::default(),
        })
    }

    pub fn snapshot_json(&mut self, algorithm: &str) -> Result<String, JsValue> {
        let algorithm = Algorithm::parse(algorithm).map_err(|error| JsValue::from_str(&error))?;
        snapshot_json(&mut self.simulation, algorithm, InteractionWork::default())
    }

    pub fn naive_overlap_count(&self) -> Result<u32, JsValue> {
        let bodies = self.simulation.bodies();
        let overlaps = run_algorithm(Algorithm::Naive, self.simulation.config(), &bodies)
            .pairs
            .len();
        u32::try_from(overlaps).map_err(|_| {
            JsValue::from_str("naive overlap count exceeds the WASM u32 benchmark result")
        })
    }

    pub fn uniform_grid_overlap_count(&self) -> Result<u32, JsValue> {
        let bodies = self.simulation.bodies();
        let overlaps = run_algorithm(Algorithm::UniformGrid, self.simulation.config(), &bodies)
            .pairs
            .len();
        u32::try_from(overlaps).map_err(|_| {
            JsValue::from_str("uniform-grid overlap count exceeds the WASM u32 benchmark result")
        })
    }

    pub fn step_json(&mut self, algorithm: &str, dt_seconds: f32) -> Result<String, JsValue> {
        let algorithm = Algorithm::parse(algorithm).map_err(|error| JsValue::from_str(&error))?;
        let dynamic = algorithm == Algorithm::DynamicAabbTree;
        let mut sync_work = InteractionWork::default();
        if dynamic && self.simulation.retained_dynamic_tree().is_none() {
            // Build before stepping so this frame's motion is recorded as
            // retained updates rather than folded into the initial build.
            sync_work.accumulate(self.simulation.sync_retained_dynamic_tree_traced().work);
        }
        self.simulation.step(dt_seconds);
        // The dynamic-tree scenario synchronizes the simulation's retained tree
        // through the traced path so the inspector sees the same updates the
        // interaction query relies on. Other algorithms leave retained state
        // untouched; pending bounds changes are applied if it is selected again.
        if dynamic {
            self.dynamic_trace = self.simulation.sync_retained_dynamic_tree_traced();
            sync_work.accumulate(self.dynamic_trace.work);
        }
        snapshot_json(&mut self.simulation, algorithm, sync_work)
    }

    pub fn trace_json(&mut self, algorithm: &str) -> Result<String, JsValue> {
        let algorithm = Algorithm::parse(algorithm).map_err(|error| JsValue::from_str(&error))?;
        if algorithm == Algorithm::DynamicAabbTree {
            dynamic_tree_trace_json(self)
        } else {
            trace_json(&self.simulation, algorithm)
        }
    }

    pub fn interaction_matrix_json(&self) -> Result<String, JsValue> {
        serde_json::to_string(&matrix_json(&self.simulation))
            .map_err(|error| JsValue::from_str(&error.to_string()))
    }

    pub fn set_layer_interaction(
        &mut self,
        left_bits: u32,
        right_bits: u32,
        allowed: bool,
    ) -> Result<(), JsValue> {
        let left = layer_from_bits(left_bits)?;
        let right = layer_from_bits(right_bits)?;
        self.simulation.set_layer_interaction(left, right, allowed);
        Ok(())
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
    let mut world = DemoWorld::new(
        scenario,
        objects,
        cell_size,
        fat_margin,
        seed,
        world_extent,
        half_extent,
        0.0,
        0.0,
        0.0,
    )?;
    world.snapshot_json(algorithm)
}

#[wasm_bindgen]
pub fn preset_catalog_json(objects: u32) -> Result<String, JsValue> {
    let presets: Vec<_> = ScenePreset::ALL
        .into_iter()
        .map(|preset| preset_config_json(preset, objects as usize))
        .collect();
    serde_json::to_string(&presets).map_err(|error| JsValue::from_str(&error.to_string()))
}

#[wasm_bindgen]
pub fn preset_analysis_json(preset: &str, objects: u32) -> Result<String, JsValue> {
    let preset = ScenePreset::parse(preset).map_err(|error| JsValue::from_str(&error))?;
    let preset_config = preset.config(objects as usize);
    let config = preset_config.scene;
    let bodies = generate_scene(config);
    let possible_pairs =
        (config.objects as u64).saturating_mul(config.objects.saturating_sub(1) as u64) / 2;
    let reference = run_algorithm(Algorithm::Naive, config, &bodies);

    let measurements: Vec<_> = Algorithm::ALL
        .into_iter()
        .map(|algorithm| {
            let result = if algorithm == Algorithm::Naive {
                reference.clone()
            } else {
                run_algorithm(algorithm, config, &bodies)
            };
            let reduction = if possible_pairs == 0 {
                0.0
            } else {
                100.0 * (1.0 - result.stats.aabb_tests as f64 / possible_pairs as f64)
            };
            json!({
                "algorithm": algorithm.as_str(),
                "aabbTests": result.stats.aabb_tests,
                "overlaps": result.pairs.len(),
                "reduction": reduction,
                "pairParity": result.pairs == reference.pairs,
            })
        })
        .collect();

    serde_json::to_string(&json!({
        "preset": preset_config_json(preset, config.objects),
        "possiblePairs": possible_pairs,
        "overlaps": reference.pairs.len(),
        "pairParity": measurements.iter().all(|measurement| {
            measurement
                .get("pairParity")
                .and_then(Value::as_bool)
                .unwrap_or(false)
        }),
        "measurements": measurements,
    }))
    .map_err(|error| JsValue::from_str(&error.to_string()))
}

fn preset_config_json(preset: ScenePreset, objects: usize) -> Value {
    let preset_config = preset.config(objects);
    let config = preset_config.scene;
    json!({
        "id": preset.as_str(),
        "title": preset.title(),
        "description": preset.description(),
        "config": {
            "objects": config.objects,
            "scenario": config.scenario.as_str(),
            "cellSize": config.cell_size,
            "fatMargin": config.fat_margin,
            "seed": config.seed,
            "worldExtent": config.world_extent,
            "halfExtent": config.half_extent,
            "dynamicFraction": preset_config.motion.dynamic_fraction,
            "speed": preset_config.motion.speed,
            "sensorFraction": preset_config.interaction.sensor_fraction,
        },
    })
}

fn snapshot_json(
    simulation: &mut Simulation,
    algorithm: Algorithm,
    sync_work: InteractionWork,
) -> Result<String, JsValue> {
    let config = simulation.config();
    let interaction_result = simulation.interactions(algorithm);
    let mut work = sync_work;
    work.accumulate(interaction_result.work);
    let simulation = &*simulation;
    let possible_pairs =
        (config.objects as u64).saturating_mul(config.objects.saturating_sub(1) as u64) / 2;
    let (static_count, dynamic_count) = simulation.counts();
    let (solid_count, sensor_count) = simulation.interaction_counts();

    let body_json: Vec<_> = simulation
        .entities()
        .iter()
        .map(|entity| {
            json!({
                "id": entity.body.id,
                "min": entity.body.aabb.min,
                "max": entity.body.aabb.max,
                "motion": entity.motion.as_str(),
                "interaction": entity.interaction.as_str(),
                "layer": entity.layer.as_str(),
                "layerBits": entity.layer.bits(),
                "velocity": entity.velocity,
            })
        })
        .collect();
    let pair_json: Vec<_> = interaction_result
        .pairs
        .iter()
        .map(|pair| [pair.a, pair.b])
        .collect();
    let sensor_pair_json: Vec<_> = interaction_result
        .sensor_pairs
        .iter()
        .map(|pair| [pair.a, pair.b])
        .collect();

    serde_json::to_string(&json!({
        "algorithm": algorithm.as_str(),
        "scenario": config.scenario.as_str(),
        "frame": simulation.frame(),
        "bodies": body_json,
        "pairs": pair_json,
        "sensorPairs": sensor_pair_json,
        "counts": {
            "static": static_count,
            "dynamic": dynamic_count,
            "solid": solid_count,
            "sensor": sensor_count,
        },
        "stats": {
            "aabbTests": interaction_result.broad_phase.stats.aabb_tests,
            "occupiedCells": interaction_result.broad_phase.stats.occupied_cells,
            "spatialOverlaps": interaction_result.broad_phase.pairs.len(),
            "filteredOut": interaction_result.filtered_out,
            "interactionPairs": interaction_result.pairs.len(),
            "sensorPairs": interaction_result.sensor_pairs.len(),
        },
        "work": {
            "retained": work.retained,
            "fullBuilds": work.full_builds,
            "bodyUpdates": work.body_updates,
            "reinsertions": work.reinsertions,
            "bodiesMaterialized": work.bodies_materialized,
        },
        "interactionMatrix": matrix_json(simulation),
        "possiblePairs": possible_pairs,
    }))
    .map_err(|error| JsValue::from_str(&error.to_string()))
}

fn matrix_json(simulation: &Simulation) -> Value {
    let matrix = simulation.interaction_matrix();
    let layers: Vec<_> = CollisionLayer::ALL
        .iter()
        .map(|layer| {
            json!({
                "name": layer.as_str(),
                "bits": layer.bits(),
                "allowsBits": matrix.row_bits(*layer),
            })
        })
        .collect();
    let entries: Vec<_> = CollisionLayer::ALL
        .iter()
        .flat_map(|left| {
            CollisionLayer::ALL.iter().map(move |right| {
                json!({
                    "left": left.bits(),
                    "right": right.bits(),
                    "allowed": matrix.allows(*left, *right),
                })
            })
        })
        .collect();

    json!({
        "layers": layers,
        "entries": entries,
    })
}

fn layer_from_bits(bits: u32) -> Result<CollisionLayer, JsValue> {
    if !bits.is_power_of_two() {
        return Err(JsValue::from_str(
            "collision layer must contain exactly one bit",
        ));
    }
    Ok(CollisionLayer::from_bits(bits))
}

fn trace_json(simulation: &Simulation, algorithm: Algorithm) -> Result<String, JsValue> {
    let config = simulation.config();
    let bodies = simulation.bodies();

    let value = match algorithm {
        Algorithm::UniformGrid => {
            let trace = UniformGridBroadPhase::new(config.cell_size).trace(&bodies);
            let cells: Vec<_> = trace
                .cells
                .iter()
                .map(|cell| {
                    json!({
                        "cell": cell.cell.as_array(),
                        "members": cell.members,
                        "candidateCount": cell.candidate_pairs.len(),
                        "testedCount": cell.tested_pairs.len(),
                        "overlapCount": cell.overlapping_pairs.len(),
                        "candidatePairs": pair_preview(&cell.candidate_pairs),
                        "testedPairs": pair_preview(&cell.tested_pairs),
                        "overlappingPairs": pair_preview(&cell.overlapping_pairs),
                    })
                })
                .collect();
            json!({
                "kind": "uniform-grid",
                "frame": simulation.frame(),
                "aabbTests": trace.result.stats.aabb_tests,
                "cellSize": config.cell_size,
                "steps": cells,
            })
        }
        Algorithm::Octree => {
            let trace = OctreeBroadPhase::default().trace(&bodies);
            json!({
                "kind": "octree",
                "frame": simulation.frame(),
                "aabbTests": trace.result.stats.aabb_tests,
                "root": trace.root,
                "leafCount": trace.leaf_count,
                "occupiedLeafCount": trace.occupied_leaf_count,
                "nodes": trace.nodes.iter().map(octree_node_json).collect::<Vec<_>>(),
            })
        }
        Algorithm::SweepAndPrune => {
            let trace = SweepAndPruneBroadPhase::new(Axis3::X).trace(&bodies);
            let steps: Vec<_> = trace
                .steps
                .iter()
                .map(|step| {
                    json!({
                        "current": step.current,
                        "intervalMin": step.interval_min,
                        "intervalMax": step.interval_max,
                        "expired": step.expired,
                        "activeBeforeTests": step.active_before_tests,
                        "testedCount": step.tested_pairs.len(),
                        "overlapCount": step.overlapping_pairs.len(),
                        "testedPairs": pair_preview(&step.tested_pairs),
                        "overlappingPairs": pair_preview(&step.overlapping_pairs),
                        "activeAfter": step.active_after,
                    })
                })
                .collect();
            json!({
                "kind": "sweep-and-prune",
                "frame": simulation.frame(),
                "axis": "x",
                "aabbTests": trace.result.stats.aabb_tests,
                "order": trace.order,
                "steps": steps,
            })
        }
        Algorithm::StaticBvh => {
            let trace = trace_static_bvh(&bodies);
            let steps: Vec<_> = trace
                .steps
                .iter()
                .map(|step| {
                    json!({
                        "left": step.left,
                        "right": step.right,
                        "kind": step.kind.as_str(),
                        "potentialPairs": step.potential_pairs,
                        "pair": step.pair.map(|pair| [pair.a, pair.b]),
                        "overlap": step.overlap,
                    })
                })
                .collect();
            json!({
                "kind": "static-bvh",
                "frame": simulation.frame(),
                "aabbTests": trace.result.stats.aabb_tests,
                "nodePairVisits": trace.node_pair_visits,
                "prunedPotentialPairs": trace.pruned_potential_pairs,
                "representedPairs": trace.represented_pair_count(),
                "root": trace.root,
                "nodes": trace.nodes.iter().map(static_bvh_node_json).collect::<Vec<_>>(),
                "steps": steps,
            })
        }
        _ => json!({
            "kind": "unsupported",
            "frame": simulation.frame(),
            "algorithm": algorithm.as_str(),
        }),
    };

    serde_json::to_string(&value).map_err(|error| JsValue::from_str(&error.to_string()))
}

fn dynamic_tree_trace_json(world: &mut DemoWorld) -> Result<String, JsValue> {
    if world.simulation.retained_dynamic_tree().is_none()
        || world.simulation.pending_retained_updates() > 0
    {
        world.dynamic_trace = world.simulation.sync_retained_dynamic_tree_traced();
    }
    let world = &*world;
    let config = world.simulation.config();
    let tree = world
        .simulation
        .retained_dynamic_tree()
        .expect("synchronization keeps retained state");
    let nodes = tree.debug_nodes();
    let current_bodies = world.simulation.bodies();
    let retained_pairs = tree.overlapping_pairs();
    let snapshot_pairs = run_algorithm(Algorithm::DynamicAabbTree, config, &current_bodies).pairs;
    let reinsertion_count = world
        .dynamic_trace
        .updates
        .iter()
        .filter(|update| update.reinserted)
        .count();
    let contained_count = world.dynamic_trace.updates.len() - reinsertion_count;
    let updates: Vec<_> = world
        .dynamic_trace
        .updates
        .iter()
        .map(|update| {
            json!({
                "id": update.id,
                "reinserted": update.reinserted,
                "previousFatBounds": aabb_json(update.previous_fat_bounds),
                "currentFatBounds": aabb_json(update.current_fat_bounds),
            })
        })
        .collect();

    let focus = world.dynamic_trace.focus.as_ref().map(|trace| {
        json!({
            "id": trace.id,
            "reinserted": trace.reinserted,
            "previousFatBounds": aabb_json(trace.previous_fat_bounds),
            "currentFatBounds": aabb_json(trace.current_fat_bounds),
            "heightBefore": trace.height_before,
            "heightAfter": trace.height_after,
            "changedNodes": trace.changed_nodes,
            "beforeNodes": trace.before_nodes.iter().map(dynamic_node_json).collect::<Vec<_>>(),
            "afterNodes": trace.after_nodes.iter().map(dynamic_node_json).collect::<Vec<_>>(),
        })
    });

    serde_json::to_string(&json!({
        "kind": "dynamic-aabb-tree",
        "frame": world.simulation.frame(),
        "fatMargin": config.fat_margin,
        "height": tree.height(),
        "nodeCount": tree.node_count(),
        "reinsertionCount": reinsertion_count,
        "containedCount": contained_count,
        "pairParity": retained_pairs == snapshot_pairs,
        "updates": updates,
        "focus": focus,
        "nodes": nodes.iter().map(dynamic_node_json).collect::<Vec<_>>(),
    }))
    .map_err(|error| JsValue::from_str(&error.to_string()))
}

fn dynamic_node_json(node: &DynamicAabbNodeSnapshot) -> Value {
    json!({
        "index": node.index,
        "bounds": aabb_json(node.bounds),
        "exactBounds": node.exact_bounds.map(aabb_json),
        "height": node.height,
        "body": node.body,
        "parent": node.parent,
        "left": node.left,
        "right": node.right,
        "isRoot": node.is_root,
    })
}

fn static_bvh_node_json(node: &StaticBvhNodeSnapshot) -> Value {
    json!({
        "index": node.index,
        "bounds": aabb_json(node.bounds),
        "depth": node.depth,
        "body": node.body,
        "left": node.left,
        "right": node.right,
        "leafCount": node.leaf_count,
        "isRoot": node.is_root,
    })
}

fn octree_node_json(node: &OctreeNodeSnapshot) -> Value {
    json!({
        "index": node.index,
        "bounds": aabb_json(node.bounds),
        "depth": node.depth,
        "members": node.members,
        "children": node.children,
        "isLeaf": node.is_leaf(),
    })
}

fn aabb_json(aabb: Aabb) -> Value {
    json!({
        "min": aabb.min,
        "max": aabb.max,
    })
}

fn pair_preview(pairs: &[Pair]) -> Vec<Value> {
    pairs
        .iter()
        .take(TRACE_PAIR_PREVIEW_LIMIT)
        .map(|pair| json!([pair.a, pair.b]))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const DT: f32 = 1.0 / 30.0;

    fn dynamic_demo() -> DemoWorld {
        DemoWorld::new("uniform", 6, 4.0, 1.25, 1703, 8.0, 0.7, 1.0, 6.0, 0.0)
            .expect("valid demo configuration")
    }

    fn parse(json: &str) -> Value {
        serde_json::from_str(json).expect("valid JSON")
    }

    #[test]
    fn first_dynamic_step_uses_retained_updates_with_a_focus() {
        let mut world = dynamic_demo();
        let snapshot = parse(&world.step_json("dynamic-aabb-tree", DT).unwrap());
        assert_eq!(snapshot["work"]["retained"], true);
        assert_eq!(snapshot["work"]["fullBuilds"], 1);
        assert_eq!(snapshot["work"]["bodyUpdates"], 6);
        assert_eq!(snapshot["work"]["bodiesMaterialized"], 0);

        let trace = parse(&world.trace_json("dynamic-aabb-tree").unwrap());
        assert!(trace["focus"].is_object());
        assert_eq!(trace["pairParity"], true);

        for _ in 0..30 {
            let snapshot = parse(&world.step_json("dynamic-aabb-tree", DT).unwrap());
            assert_eq!(snapshot["work"]["fullBuilds"], 0);
            assert_eq!(snapshot["work"]["bodyUpdates"], 6);
            let trace = parse(&world.trace_json("dynamic-aabb-tree").unwrap());
            assert_eq!(trace["pairParity"], true);
        }
    }

    #[test]
    fn other_algorithms_rebuild_without_touching_retained_state() {
        let mut world = dynamic_demo();
        let snapshot = parse(&world.step_json("sweep-and-prune", DT).unwrap());
        assert_eq!(snapshot["work"]["retained"], false);
        assert_eq!(snapshot["work"]["fullBuilds"], 1);
        assert!(world.simulation.retained_dynamic_tree().is_none());
    }
}
