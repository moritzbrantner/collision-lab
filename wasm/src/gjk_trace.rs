use geometry_kernels::{
    gjk::GjkStatus,
    planar::gjk_intersection_trace_planar_xy,
    support::{ConvexHull3, MinkowskiSupportPoint},
};
use serde_json::{Value, json};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn convex_gjk_trace_json(left_json: &str, right_json: &str) -> Result<String, JsValue> {
    let left = parse_polygon(left_json, "left")?;
    let right = parse_polygon(right_json, "right")?;
    let left_hull = ConvexHull3::new(&left);
    let right_hull = ConvexHull3::new(&right);
    let trace = gjk_intersection_trace_planar_xy(&left_hull, &right_hull);

    let steps: Vec<_> = trace
        .steps
        .iter()
        .map(|step| {
            let simplex: Vec<_> = step.simplex[..step.simplex_len]
                .iter()
                .map(support_json)
                .collect();
            json!({
                "iteration": step.iteration,
                "queryDirection": step.query_direction,
                "support": support_json(&step.support),
                "simplex": simplex,
                "nextSearchDirection": step.next_search_direction,
                "terminalStatus": step.terminal_status.map(status_name),
            })
        })
        .collect();

    serde_json::to_string(&json!({
        "status": status_name(trace.result.status),
        "intersection": trace.result.intersection(),
        "iterations": trace.result.iterations,
        "simplex": trace.result.simplex[..trace.result.simplex_len]
            .iter()
            .map(support_json)
            .collect::<Vec<_>>(),
        "searchDirection": trace.result.search_direction,
        "steps": steps,
    }))
    .map_err(|error| JsValue::from_str(&error.to_string()))
}

fn parse_polygon(value: &str, label: &str) -> Result<Vec<[f64; 3]>, JsValue> {
    let points: Vec<[f64; 2]> = serde_json::from_str(value)
        .map_err(|error| JsValue::from_str(&format!("invalid {label} convex proxy: {error}")))?;
    if points.is_empty() {
        return Err(JsValue::from_str(&format!(
            "{label} convex proxy must contain at least one point"
        )));
    }
    Ok(points.into_iter().map(|[x, y]| [x, y, 0.0]).collect())
}

fn support_json(point: &MinkowskiSupportPoint) -> Value {
    json!({
        "point": point.point,
        "left": point.left,
        "right": point.right,
    })
}

const fn status_name(status: GjkStatus) -> &'static str {
    match status {
        GjkStatus::Intersecting => "intersecting",
        GjkStatus::Separated => "separated",
        GjkStatus::NoProgress => "no-progress",
        GjkStatus::IterationLimit => "iteration-limit",
    }
}
