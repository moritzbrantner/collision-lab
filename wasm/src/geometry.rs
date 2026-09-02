use geometry_kernels::{Sphere, aabb_aabb, sphere_sphere};
use serde_json::json;
use spatial_kernels::Aabb;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn sphere_sphere_json(
    left_x: f32,
    left_y: f32,
    left_z: f32,
    left_radius: f32,
    right_x: f32,
    right_y: f32,
    right_z: f32,
    right_radius: f32,
) -> Result<String, JsValue> {
    let left = Sphere::new([left_x, left_y, left_z], left_radius);
    let right = Sphere::new([right_x, right_y, right_z], right_radius);
    let relation = sphere_sphere(left, right);

    serde_json::to_string(&json!({
        "left": { "center": left.center, "radius": left.radius },
        "right": { "center": right.center, "radius": right.radius },
        "centerDistanceSquared": relation.center_distance_squared,
        "centerDistance": relation.center_distance,
        "radiusSum": relation.radius_sum,
        "radiusSumSquared": relation.radius_sum * relation.radius_sum,
        "signedSeparation": relation.signed_separation,
        "overlaps": relation.overlaps,
    }))
    .map_err(|error| JsValue::from_str(&error.to_string()))
}

#[allow(clippy::too_many_arguments)]
#[wasm_bindgen]
pub fn aabb_aabb_json(
    left_center_x: f32,
    left_center_y: f32,
    left_center_z: f32,
    left_half_x: f32,
    left_half_y: f32,
    left_half_z: f32,
    right_center_x: f32,
    right_center_y: f32,
    right_center_z: f32,
    right_half_x: f32,
    right_half_y: f32,
    right_half_z: f32,
) -> Result<String, JsValue> {
    let left = Aabb::from_center_half_extents(
        [left_center_x, left_center_y, left_center_z],
        [left_half_x, left_half_y, left_half_z],
    );
    let right = Aabb::from_center_half_extents(
        [right_center_x, right_center_y, right_center_z],
        [right_half_x, right_half_y, right_half_z],
    );
    let relation = aabb_aabb(left, right);

    serde_json::to_string(&json!({
        "left": { "min": left.min, "max": left.max },
        "right": { "min": right.min, "max": right.max },
        "axisOverlap": relation.axis_overlap,
        "overlaps": relation.overlaps,
    }))
    .map_err(|error| JsValue::from_str(&error.to_string()))
}
