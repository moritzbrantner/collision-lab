use bvh_kernels::{DynamicAabbNodeSnapshot, DynamicAabbTree, DynamicAabbUpdateTrace};
use bvh_trace_kernels::{StaticBvhNodeSnapshot, trace_static_bvh};
use collision_lab::{
    Algorithm, CollisionLayer, Config, InteractionConfig, MotionConfig, MotionKind, Scenario,
    Simulation, run_algorithm,
};
use octree_kernels::{OctreeBroadPhase, OctreeNodeSnapshot};
use serde_json::{Value, json};
use spatial_kernels::{Aabb, Axis3, Pair, SweepAndPruneBroadPhase, UniformGridBroadPhase};
use wasm_bindgen::prelude::*;

const TRACE_PAIR_PREVIEW_LIMIT: usize = 32;

#[derive(Clone, Copy, Debug)]
struct DynamicUpdateSummary {
    id: u32,
    reinserted: bool,
    previous_fat_bounds: Aabb,
    current_fat_bounds: Aabb,
}

#[derive(Clone, Debug, Default)]
struct DynamicFrameTrace {
    updates: Vec<DynamicUpdateSummary>,
    focus: Option<DynamicAabbUpdateTrace>,
}

#[wasm_bindgen]
pub struct DemoWorld {
    simulation: Simulation,
    dynamic_tree: DynamicAabbTree,
    dynamic_trace: DynamicFrameTrace,
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
        let mut dynamic_tree = DynamicAabbTree::new(config.fat_margin);
        for body in simulation.bodies() {
            dynamic_tree.insert(body);
        }

        Ok(Self {
            simulation,
            dynamic_tree,
            dynamic_trace: DynamicFrameTrace::default(),
        })
    }

    pub fn snapshot_json(&self, algorithm: &str) -> Result<String, JsValue> {
        snapshot_json(&self.simulation, algorithm)
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
        self.simulation.step(dt_seconds);
        self.update_dynamic_tree();
        snapshot_json(&self.simulation, algorithm)
    }

    pub fn trace_json(&self, algorithm: &str) -> Result<String, JsValue> {
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

impl DemoWorld {
    fn update_dynamic_tree(&mut self) {
        let moving_bodies: Vec<_> = self
            .simulation
            .entities()
            .iter()
            .filter(|entity| entity.motion == MotionKind::Dynamic)
            .map(|entity| entity.body)
            .collect();

        let focus_id = moving_bodies
            .iter()
            .find(|body| {
                self.dynamic_tree
                    .fat_bounds(body.id)
                    .is_some_and(|fat| !fat.contains(body.aabb))
            })
            .map(|body| body.id)
            .or_else(|| moving_bodies.first().map(|body| body.id));

        let mut updates = Vec::with_capacity(moving_bodies.len());
        let mut focus = None;
        for body in moving_bodies {
            let previous_fat_bounds = self
                .dynamic_tree
                .fat_bounds(body.id)
                .expect("simulation body must exist in retained dynamic tree");
            if focus_id == Some(body.id) {
                let trace = self.dynamic_tree.update_with_trace(body);
                updates.push(DynamicUpdateSummary {
                    id: body.id,
                    reinserted: trace.reinserted,
                    previous_fat_bounds: trace.previous_fat_bounds,
                    current_fat_bounds: trace.current_fat_bounds,
                });
                focus = Some(trace);
            } else {
                let reinserted = self.dynamic_tree.update(body);
                let current_fat_bounds = self
                    .dynamic_tree
                    .fat_bounds(body.id)
                    .expect("updated simulation body must remain in retained dynamic tree");
                updates.push(DynamicUpdateSummary {
                    id: body.id,
                    reinserted,
                    previous_fat_bounds,
                    current_fat_bounds,
                });
            }
        }

        self.dynamic_trace = DynamicFrameTrace { updates, focus };
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
        0.0,
    )?;
    world.snapshot_json(algorithm)
}

fn snapshot_json(simulation: &Simulation, algorithm: &str) -> Result<String, JsValue> {
    let algorithm = Algorithm::parse(algorithm).map_err(|error| JsValue::from_str(&error))?;
    let config = simulation.config();
    let interaction_result = simulation.interactions(algorithm);
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

fn dynamic_tree_trace_json(world: &DemoWorld) -> Result<String, JsValue> {
    let config = world.simulation.config();
    let nodes = world.dynamic_tree.debug_nodes();
    let current_bodies = world.simulation.bodies();
    let retained_pairs = world.dynamic_tree.overlapping_pairs();
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
        "height": world.dynamic_tree.height(),
        "nodeCount": world.dynamic_tree.node_count(),
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
