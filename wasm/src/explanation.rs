use serde_json::{Value, json};
use spatial_kernels::{
    Aabb, Axis3, Body, BroadPhase, NaiveBroadPhase, Pair, SweepAndPruneBroadPhase,
    UniformGridBroadPhase,
};

const CELL_SIZE: f32 = 3.0;

struct TeachingBody {
    label: &'static str,
    body: Body,
}

pub fn explanation_json(algorithm: &str) -> Result<String, String> {
    let teaching = teaching_scene();
    let bodies: Vec<_> = teaching.iter().map(|entry| entry.body).collect();
    let body_json: Vec<_> = teaching
        .iter()
        .map(|entry| {
            json!({
                "id": entry.body.id,
                "label": entry.label,
                "min": [entry.body.aabb.min[0], entry.body.aabb.min[1]],
                "max": [entry.body.aabb.max[0], entry.body.aabb.max[1]],
            })
        })
        .collect();

    let value = match algorithm {
        "naive" => naive_explanation(body_json, &bodies),
        "uniform-grid" => grid_explanation(body_json, &bodies),
        "sweep-and-prune" => sweep_explanation(body_json, &bodies),
        other => {
            return Err(format!(
                "unsupported explanation algorithm `{other}`; expected naive, uniform-grid, or sweep-and-prune"
            ));
        }
    };

    serde_json::to_string(&value).map_err(|error| error.to_string())
}

fn naive_explanation(body_json: Vec<Value>, bodies: &[Body]) -> Value {
    let result = NaiveBroadPhase.detect(bodies);
    let mut steps = Vec::new();
    let mut tested = 0_u64;
    let total = result.stats.aabb_tests;

    for left in 0..bodies.len() {
        for right in (left + 1)..bodies.len() {
            tested += 1;
            let pair = Pair::new(bodies[left].id, bodies[right].id);
            let overlaps = bodies[left].aabb.overlaps(bodies[right].aabb);
            steps.push(json!({
                "kind": "pair-test",
                "pair": [pair.a, pair.b],
                "overlaps": overlaps,
                "tested": tested,
                "totalTests": total,
                "message": if overlaps {
                    "These two boxes overlap, so the pair survives."
                } else {
                    "These boxes are separate, but naive search still had to test them."
                },
            }));
        }
    }

    json!({
        "algorithm": "naive",
        "title": "Naive all-pairs",
        "summary": "Test every unique pair. It is easy to trust, but it wastes work on objects that are obviously far apart.",
        "formula": "n(n-1)/2",
        "bodyCount": bodies.len(),
        "possiblePairs": total,
        "overlapPairs": pair_values(&result.pairs),
        "bodies": body_json,
        "steps": steps,
    })
}

fn grid_explanation(body_json: Vec<Value>, bodies: &[Body]) -> Value {
    let trace = UniformGridBroadPhase::new(CELL_SIZE).trace(bodies);
    let steps: Vec<_> = trace
        .cells
        .iter()
        .filter(|step| step.cell.z == 0)
        .map(|step| {
            json!({
                "kind": "cell",
                "cell": [step.cell.x, step.cell.y],
                "members": step.members,
                "candidatePairs": pair_values(&step.candidate_pairs),
                "testedPairs": pair_values(&step.tested_pairs),
                "overlappingPairs": pair_values(&step.overlapping_pairs),
                "message": match (step.members.len(), step.tested_pairs.len()) {
                    (0 | 1, _) => "With fewer than two objects, this cell creates no pair test.",
                    (_, 0) => "This cell contains a repeated candidate that was already tested in another shared cell.",
                    _ => "Only objects sharing this cell become candidates for exact AABB tests.",
                },
            })
        })
        .collect();

    json!({
        "algorithm": "uniform-grid",
        "title": "Uniform grid",
        "summary": "Partition space first. Objects that never share a cell never become collision candidates.",
        "cellSize": CELL_SIZE,
        "aabbTests": trace.result.stats.aabb_tests,
        "overlapPairs": pair_values(&trace.result.pairs),
        "bodies": body_json,
        "steps": steps,
    })
}

fn sweep_explanation(body_json: Vec<Value>, bodies: &[Body]) -> Value {
    let trace = SweepAndPruneBroadPhase::new(Axis3::X).trace(bodies);
    let steps: Vec<_> = trace
        .steps
        .iter()
        .map(|step| {
            json!({
                "kind": "sweep",
                "current": step.current,
                "intervalMin": step.interval_min,
                "intervalMax": step.interval_max,
                "expired": step.expired,
                "activeBeforeTests": step.active_before_tests,
                "testedPairs": pair_values(&step.tested_pairs),
                "overlappingPairs": pair_values(&step.overlapping_pairs),
                "activeAfter": step.active_after,
                "message": if step.active_before_tests.is_empty() {
                    "No earlier X interval is still active, so this body needs no exact pair test."
                } else {
                    "Only bodies whose X intervals are still active can overlap this body in 2D."
                },
            })
        })
        .collect();

    json!({
        "algorithm": "sweep-and-prune",
        "title": "Sweep and prune",
        "summary": "Sort by one axis, discard intervals that have already ended, and only test the active set.",
        "axis": "x",
        "order": trace.order,
        "aabbTests": trace.result.stats.aabb_tests,
        "overlapPairs": pair_values(&trace.result.pairs),
        "bodies": body_json,
        "steps": steps,
    })
}

fn teaching_scene() -> Vec<TeachingBody> {
    vec![
        teaching_body(0, "A", [1.0, 1.0], [3.2, 3.0]),
        teaching_body(1, "B", [2.6, 1.7], [4.5, 3.5]),
        teaching_body(2, "C", [6.0, 1.2], [7.8, 2.8]),
        teaching_body(3, "D", [7.3, 2.2], [9.2, 4.0]),
        teaching_body(4, "E", [1.5, 5.0], [3.0, 6.7]),
        teaching_body(5, "F", [8.7, 5.0], [10.5, 6.6]),
    ]
}

fn teaching_body(id: u32, label: &'static str, min: [f32; 2], max: [f32; 2]) -> TeachingBody {
    TeachingBody {
        label,
        body: Body::new(
            id,
            Aabb::new([min[0], min[1], 0.05], [max[0], max[1], 0.45]),
        ),
    }
}

fn pair_values(pairs: &[Pair]) -> Vec<Value> {
    pairs.iter().map(|pair| json!([pair.a, pair.b])).collect()
}
