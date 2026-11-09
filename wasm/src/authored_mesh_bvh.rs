//! An authored-mesh teaching adapter, not another production collider.
//! Physics Engine owns chunk bodies and movement; geometry-kernels owns exact queries and BVHs.

use geometry_kernels::{
    ray_triangle::{TriangleCulling, segment_triangle},
    triangle_mesh::{
        PreparedTriangleMesh3, TriangleMeshData3, TriangleMeshSegmentHit3, TriangleMeshWork3,
    },
};
use serde_json::{Value, json};
use wasm_bindgen::prelude::*;

const SOURCE: &str = "physics-engine/tests/fixtures/redbrand-cave.json";
const SOURCE_COMMIT: &str = "physics-engine@e7b636b7e37c310906eb0f9f96c7585ece406d75; MMORPG@9ccc3a57";
const TILE_SPACING: f32 = 110.0;

#[derive(Clone, Copy)]
struct TriangleSource {
    chunk: u64,
    local_triangle: u32,
}

#[derive(Clone, Copy)]
struct HitWitness {
    triangle: u32,
    fraction: f64,
    surface_point: [f64; 3],
    normal: Option<[f64; 3]>,
}

#[derive(Clone, Copy, Debug)]
struct Bounds {
    min: [f64; 3],
    max: [f64; 3],
}

impl Bounds {
    fn around(points: impl IntoIterator<Item = [f64; 3]>) -> Self {
        let mut bounds = Self {
            min: [f64::INFINITY; 3],
            max: [f64::NEG_INFINITY; 3],
        };
        for point in points {
            for (axis, value) in point.into_iter().enumerate() {
                bounds.min[axis] = bounds.min[axis].min(value);
                bounds.max[axis] = bounds.max[axis].max(value);
            }
        }
        bounds
    }

    fn union(self, other: Self) -> Self {
        Self {
            min: std::array::from_fn(|axis| self.min[axis].min(other.min[axis])),
            max: std::array::from_fn(|axis| self.max[axis].max(other.max[axis])),
        }
    }

    fn overlaps(self, other: Self) -> bool {
        (0..3).all(|axis| {
            self.min[axis] <= other.max[axis] && self.max[axis] >= other.min[axis]
        })
    }

    fn json(self) -> Value {
        json!({ "min": self.min, "max": self.max })
    }
}

struct TraceNode {
    bounds: Bounds,
    left: Option<usize>,
    right: Option<usize>,
    triangle: Option<u32>,
    depth: usize,
}

/// The trace reconstructs the pinned geometry-kernels median hierarchy from input triangle
/// AABBs. It does not inspect private kernel nodes. Tests compare visited-node and leaf counts
/// against the real kernel's counters, so a changed upstream split/traversal cannot pass silently.
fn trace_hierarchy(leaves: &mut [(u32, Bounds)], nodes: &mut Vec<TraceNode>, depth: usize) -> usize {
    let bounds = leaves
        .iter()
        .skip(1)
        .fold(leaves[0].1, |current, leaf| current.union(leaf.1));
    let index = nodes.len();
    nodes.push(TraceNode {
        bounds,
        left: None,
        right: None,
        triangle: Some(leaves[0].0),
        depth,
    });
    if leaves.len() > 1 {
        let axis = (0..3)
            .max_by(|&a, &b| {
                (bounds.max[a] - bounds.min[a])
                    .total_cmp(&(bounds.max[b] - bounds.min[b]))
            })
            .unwrap_or(0);
        leaves.sort_unstable_by(|a, b| {
            let mid = |leaf: &(u32, Bounds)| {
                leaf.1.min[axis] * 0.5 + leaf.1.max[axis] * 0.5
            };
            mid(a).total_cmp(&mid(b)).then(a.0.cmp(&b.0))
        });
        let middle = leaves.len() / 2;
        let (left, right) = leaves.split_at_mut(middle);
        let a = trace_hierarchy(left, nodes, depth + 1);
        let b = trace_hierarchy(right, nodes, depth + 1);
        nodes[index].left = Some(a);
        nodes[index].right = Some(b);
        nodes[index].triangle = None;
    }
    index
}

struct MeshCase {
    prepared: PreparedTriangleMesh3,
    triangles: Vec<[[f32; 3]; 3]>,
    sources: Vec<TriangleSource>,
    nodes: Vec<TraceNode>,
    replicas: u32,
}

fn triplet(value: &Value) -> Result<[f32; 3], String> {
    let coords = value
        .as_array()
        .filter(|coords| coords.len() == 3)
        .ok_or("fixture needs three coordinates")?;
    let mut result = [0.0; 3];
    for axis in 0..3 {
        result[axis] = coords[axis]
            .as_f64()
            .ok_or("fixture coordinate must be numeric")? as f32;
    }
    Ok(result)
}

impl MeshCase {
    fn new(replicas: u32) -> Result<Self, String> {
        if !matches!(replicas, 1 | 4 | 16) {
            return Err("replicas must be 1, 4, or 16".to_owned());
        }
        let fixture: Value = serde_json::from_str(include_str!("../fixtures/redbrand-cave.json"))
            .map_err(|error| error.to_string())?;
        let chunks = fixture.as_array().ok_or("fixture must be an array")?;
        let mut vertices: Vec<[f64; 3]> = Vec::new();
        let mut triangles = Vec::new();
        let mut sources = Vec::new();
        let mut indices = Vec::new();

        for replica in 0..replicas {
            let offset = [
                (replica % 4) as f32 * TILE_SPACING,
                0.0,
                (replica / 4) as f32 * TILE_SPACING,
            ];
            for chunk in chunks {
                let id = chunk["id"].as_u64().ok_or("fixture chunk needs an ID")?;
                let position = triplet(&chunk["position"])?;
                let local_vertices = chunk["vertices"]
                    .as_array()
                    .ok_or("fixture needs vertices")?;
                let base = u32::try_from(vertices.len()).map_err(|e| e.to_string())?;
                for vertex in local_vertices {
                    let point = triplet(vertex)?;
                    vertices.push(std::array::from_fn(|axis| {
                        // Preserve the owner's centimetre-to-metre f32 conversion.
                        (point[axis] * 0.01 + position[axis] * 0.01 + offset[axis]) as f64
                    }));
                }
                for (local_triangle, triangle) in chunk["triangles"]
                    .as_array()
                    .ok_or("fixture needs triangles")?
                    .iter()
                    .enumerate()
                {
                    let values = triangle.as_array().filter(|v| v.len() == 3).ok_or("bad triangle")?;
                    let mut corners = [0_u32; 3];
                    for corner in 0..3 {
                        let local = u32::try_from(values[corner].as_u64().ok_or("bad index")?)
                            .map_err(|e| e.to_string())?;
                        corners[corner] = base.checked_add(local).ok_or("index overflow")?;
                    }
                    if corners.iter().any(|&i| i as usize >= vertices.len()) {
                        return Err("triangle references a missing vertex".into());
                    }
                    let geometry = corners.map(|i| {
                        vertices[i as usize].map(|component| component as f32)
                    });
                    triangles.push(geometry);
                    indices.push(corners);
                    sources.push(TriangleSource {
                        chunk: id,
                        local_triangle: u32::try_from(local_triangle).map_err(|e| e.to_string())?,
                    });
                }
            }
        }

        let prepared = PreparedTriangleMesh3::try_new(TriangleMeshData3 {
            vertices: vertices.clone(),
            triangles: indices,
        })
        .map_err(|error| error.to_string())?;
        let mut leaves = triangles
            .iter()
            .enumerate()
            .map(|(index, triangle)| {
                (index as u32, Bounds::around(triangle.map(|point| point.map(f64::from))))
            })
            .collect::<Vec<_>>();
        let mut nodes = Vec::with_capacity(triangles.len() * 2 - 1);
        trace_hierarchy(&mut leaves, &mut nodes, 0);
        if nodes.len() as u64 != prepared.preparation().nodes_prepared {
            return Err("trace reconstruction no longer matches the kernel node count".into());
        }
        Ok(Self {
            prepared,
            triangles,
            sources,
            nodes,
            replicas,
        })
    }

    fn preparation_json(&self) -> Value {
        let preparation = self.prepared.preparation();
        json!({
            "replicas": self.replicas,
            "triangles": preparation.triangles_prepared,
            "nodes": preparation.nodes_prepared,
            "retainedBytes": preparation.retained_bytes,
            "builds": 1,
            "sourceChunks": 14 * self.replicas,
        })
    }

    fn trace_segment(&self, start: [f64; 3], end: [f64; 3]) -> (Vec<Value>, u64, u64) {
        let mut bounds = Bounds::around([start, end]);
        bounds.min = bounds.min.map(f64::next_down);
        bounds.max = bounds.max.map(f64::next_up);
        let mut steps = Vec::new();
        let mut tested = 0;
        let mut stack = vec![0];
        while let Some(index) = stack.pop() {
            let node = &self.nodes[index];
            let overlaps = node.bounds.overlaps(bounds);
            let kind = if !overlaps {
                "rejected"
            } else if node.triangle.is_some() {
                tested += 1;
                "candidate"
            } else {
                "descend"
            };
            steps.push(json!({
                "node": index,
                "depth": node.depth,
                "kind": kind,
                "bounds": node.bounds.json(),
                "triangle": node.triangle,
                "source": node.triangle.map(|id| json!({
                    "chunk": self.sources[id as usize].chunk,
                    "triangle": self.sources[id as usize].local_triangle,
                })),
            }));
            if overlaps && node.triangle.is_none() {
                if let (Some(left), Some(right)) = (node.left, node.right) {
                    stack.push(right);
                    stack.push(left);
                }
            }
        }
        let visited = steps.len() as u64;
        (steps, visited, tested)
    }

    fn segment_reference(&self, start: [f32; 3], end: [f32; 3]) -> Option<HitWitness> {
        self.triangles
            .iter()
            .enumerate()
            .filter_map(|(id, triangle)| {
                segment_triangle(start, end, *triangle, TriangleCulling::None)
                    .map(|hit| HitWitness {
                        triangle: id as u32,
                        fraction: hit.fraction,
                        surface_point: hit.point,
                        normal: None,
                    })
            })
            .min_by(|a, b| {
                a.fraction.total_cmp(&b.fraction).then(a.triangle.cmp(&b.triangle))
            })
    }

    fn capsule_reference(&self, p: [f64; 3], q: [f64; 3], displacement: [f64; 3]) -> Result<Option<HitWitness>, String> {
        let mut best: Option<(HitWitness, f64)> = None;
        for (id, triangle) in self.triangles.iter().enumerate() {
            // Exhaustive oracle: a one-triangle kernel query per authored triangle, without
            // testing a mesh BVH. Its temporary preparation is excluded from retained cost.
            let prepared = PreparedTriangleMesh3::try_new(TriangleMeshData3 {
                vertices: triangle.iter().map(|v| v.map(f64::from)).collect(),
                triangles: vec![[0, 1, 2]],
            }).map_err(|error| error.to_string())?;
            if let Some(hit) = prepared.capsule_sweep(p, q, 0.3, displacement, 32)
                .map_err(|error| error.to_string())?
            {
                let rate = displacement.iter().zip(hit.contact.normal).map(|(d, n)| *d * n).sum::<f64>();
                let candidate = HitWitness {
                    triangle: id as u32,
                    fraction: hit.fraction,
                    surface_point: hit.contact.point,
                    normal: Some(hit.contact.normal),
                };
                if best.is_none_or(|(current, current_rate)| {
                    candidate.fraction < current.fraction
                        || (candidate.fraction == current.fraction
                            && rate.total_cmp(&current_rate)
                                .then(candidate.triangle.cmp(&current.triangle)).is_lt())
                }) {
                    best = Some((candidate, rate));
                }
            }
        }
        Ok(best.map(|(hit, _)| hit))
    }

    fn query(&self, x: f64, mode: &str) -> Result<Value, String> {
        if !x.is_finite() || !(45.0..=85.0).contains(&x) {
            return Err("origin X must be finite and between 45 and 85 metres".into());
        }
        if !matches!(mode, "ray" | "segment" | "capsule") {
            return Err("mode must be ray, segment, or capsule".into());
        }
        let x = f64::from(x as f32);
        let start = [x, 12.0, -138.0];
        let end = [x, if mode == "ray" { 0.0 } else { 10.0 }, -138.0];
        let mut work = TriangleMeshWork3::default();
        let (accelerated, reference, trace) = if mode == "capsule" {
            let p = [x, 11.4, -138.0];
            let q = [x, 12.0, -138.0];
            let displacement = [0.0, -2.0, 0.0];
            let hit = self.prepared.capsule_sweep_counted(p, q, 0.3, displacement, 32, &mut work)
                .map_err(|error| error.to_string())?;
            let accelerated = hit.map(|hit| HitWitness {
                triangle: hit.contact.triangle,
                fraction: hit.fraction,
                surface_point: hit.contact.point,
                normal: Some(hit.contact.normal),
            });
            let reference = self.capsule_reference(p, q, displacement)?;
            (accelerated, reference, Vec::new())
        } else {
            let hit: Option<TriangleMeshSegmentHit3> = self
                .prepared
                .segment_hit_counted(start, end, &mut work)
                .map_err(|error| error.to_string())?;
            let accelerated = hit.map(|hit| HitWitness {
                triangle: hit.triangle,
                fraction: hit.fraction,
                surface_point: hit.point,
                normal: Some(hit.normal),
            });
            let reference = self.segment_reference(start.map(|v| v as f32), end.map(|v| v as f32));
            let (steps, visited, tested) = self.trace_segment(start, end);
            if visited != work.nodes_visited || tested != work.triangles_tested {
                return Err("trace and kernel counters diverged; update the trace adapter".into());
            }
            (accelerated, reference, steps)
        };
        let parity = match (accelerated, reference) {
            (None, None) => true,
            (Some(a), Some(b)) => a.triangle == b.triangle
                && (a.fraction - b.fraction).abs() <= 1e-8
                && a.surface_point.iter().zip(b.surface_point).all(|(a, b)| (*a - b).abs() <= 1e-7),
            _ => false,
        };
        let witness = |hit: Option<HitWitness>| hit.map(|hit| {
            let source = self.sources[hit.triangle as usize];
            json!({
                "triangle": hit.triangle,
                "chunk": source.chunk,
                "localTriangle": source.local_triangle,
                "fraction": hit.fraction,
                "surfacePoint": hit.surface_point,
                "normal": hit.normal,
                "queryPosition": [x, (if mode == "capsule" { 11.7 } else { start[1] }) + (end[1] - start[1]) * hit.fraction, -138.0],
            })
        });
        Ok(json!({
            "mode": mode,
            "origin": start,
            "end": end,
            "accelerated": witness(accelerated),
            "reference": witness(reference),
            "parity": parity,
            "counts": {
                "bruteTriangleTests": self.triangles.len(),
                "bvhNodesVisited": work.nodes_visited,
                "bvhTrianglesTested": work.triangles_tested,
                "sweepIterations": work.sweep_iterations,
                "retainedBuilds": 1,
            },
            "trace": trace,
            "traceKind": if mode == "capsule" { "kernel-counts-only" } else { "validated-hierarchy-reconstruction" },
            "preparation": self.preparation_json(),
        }))
    }
}

#[wasm_bindgen]
pub struct AuthoredMeshBvhLesson {
    case: MeshCase,
}

#[wasm_bindgen]
impl AuthoredMeshBvhLesson {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Result<AuthoredMeshBvhLesson, JsValue> {
        Ok(Self { case: MeshCase::new(1).map_err(|e| JsValue::from_str(&e))? })
    }

    pub fn query_json(&self, origin_x: f64, mode: &str) -> Result<String, JsValue> {
        self.case.query(origin_x, mode)
            .and_then(|value| serde_json::to_string(&value).map_err(|e| e.to_string()))
            .map_err(|e| JsValue::from_str(&e))
    }

    pub fn scale_json(&self) -> Result<String, JsValue> {
        let mut cases = Vec::new();
        for replicas in [1, 4, 16] {
            let case = if replicas == 1 { None } else {
                Some(MeshCase::new(replicas).map_err(|e| JsValue::from_str(&e))?)
            };
            let case = case.as_ref().unwrap_or(&self.case);
            let report = case.query(62.0, "segment").map_err(|e| JsValue::from_str(&e))?;
            cases.push(json!({
                "preparation": case.preparation_json(),
                "counts": report["counts"],
                "parity": report["parity"],
            }));
        }
        serde_json::to_string(&json!({
            "source": SOURCE,
            "sourceCommit": SOURCE_COMMIT,
            "referenceImplementation": "https://github.com/moritzbrantner/physics-engine/pull/493",
            "kernel": "geometry-kernels::triangle_mesh::PreparedTriangleMesh3",
            "description": "Teaching-only flattened copies of the authored chunk fixture; the engine retains separate static chunk bodies.",
            "scales": cases,
        })).map_err(|e| JsValue::from_str(&e.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn authored_fixture_is_retained_with_stable_triangle_provenance() {
        let case = MeshCase::new(1).expect("authored mesh must prepare");
        assert_eq!(case.triangles.len(), 14 * 12);
        assert_eq!(case.nodes.len(), case.triangles.len() * 2 - 1);
        assert_eq!(case.sources[0].chunk, 540);
        assert_eq!(case.sources[8 * 12].chunk, 640);
        assert_eq!(case.sources[8 * 12].local_triangle, 0);
    }

    #[test]
    fn segment_reference_and_reconstructed_traversal_match_kernel() {
        let case = MeshCase::new(1).expect("authored mesh must prepare");
        for mode in ["ray", "segment"] {
            for x in [45.0, 49.0, 58.0, 62.0, 67.0, 70.0, 78.0, 85.0] {
                let report = case.query(x, mode).expect("valid query");
                assert!(report["parity"].as_bool().unwrap(), "{mode} at {x}: {report}");
                assert_eq!(report["trace"].as_array().unwrap().len() as u64, report["counts"]["bvhNodesVisited"].as_u64().unwrap());
            }
        }
    }

    #[test]
    fn capsule_sweep_agrees_with_exhaustive_triangle_reference() {
        let case = MeshCase::new(1).expect("authored mesh must prepare");
        let report = case.query(62.0, "capsule").expect("valid capsule sweep");
        assert!(report["parity"].as_bool().unwrap(), "{report}");
        assert!(report["accelerated"].is_object());
        assert_eq!(report["traceKind"], "kernel-counts-only");
    }

    #[test]
    fn static_replication_reduces_triangle_tests_without_rebuilding_per_query() {
        for replicas in [1, 4, 16] {
            let case = MeshCase::new(replicas).expect("authored mesh must prepare");
            let report = case.query(62.0, "segment").expect("valid query");
            assert!(report["parity"].as_bool().unwrap(), "{report}");
            assert!(report["counts"]["bvhTrianglesTested"].as_u64().unwrap() < (14 * 12 * replicas) as u64);
            assert_eq!(report["counts"]["retainedBuilds"], 1);
            assert_eq!(case.prepared.preparation().nodes_prepared, 2 * (14 * 12 * replicas) as u64 - 1);
        }
    }
}
