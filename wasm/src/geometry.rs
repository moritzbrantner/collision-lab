use geometry_kernels::obb3::{Obb3, obb3_sat};
use geometry_kernels::primitives::{Capsule, capsule_capsule, sphere_aabb, sphere_capsule};
use geometry_kernels::{Obb2, Sphere, aabb_aabb, obb2_sat, sphere_sphere};
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

#[allow(clippy::too_many_arguments)]
#[wasm_bindgen]
pub fn sphere_aabb_json(
    sphere_x: f32,
    sphere_y: f32,
    sphere_z: f32,
    sphere_radius: f32,
    box_center_x: f32,
    box_center_y: f32,
    box_center_z: f32,
    box_half_x: f32,
    box_half_y: f32,
    box_half_z: f32,
) -> Result<String, JsValue> {
    let sphere = Sphere::new([sphere_x, sphere_y, sphere_z], sphere_radius);
    let aabb = Aabb::from_center_half_extents(
        [box_center_x, box_center_y, box_center_z],
        [box_half_x, box_half_y, box_half_z],
    );
    let relation = sphere_aabb(sphere, aabb);

    serde_json::to_string(&json!({
        "sphere": { "center": sphere.center, "radius": sphere.radius },
        "aabb": { "min": aabb.min, "max": aabb.max },
        "closestPoint": relation.closest_point,
        "centerDistanceSquared": relation.center_distance_squared,
        "centerDistance": relation.center_distance,
        "signedSeparation": relation.signed_separation,
        "overlaps": relation.overlaps,
    }))
    .map_err(|error| JsValue::from_str(&error.to_string()))
}

#[allow(clippy::too_many_arguments)]
#[wasm_bindgen]
pub fn sphere_capsule_json(
    sphere_x: f32,
    sphere_y: f32,
    sphere_z: f32,
    sphere_radius: f32,
    capsule_start_x: f32,
    capsule_start_y: f32,
    capsule_start_z: f32,
    capsule_end_x: f32,
    capsule_end_y: f32,
    capsule_end_z: f32,
    capsule_radius: f32,
) -> Result<String, JsValue> {
    let sphere = Sphere::new([sphere_x, sphere_y, sphere_z], sphere_radius);
    let capsule = Capsule::new(
        [capsule_start_x, capsule_start_y, capsule_start_z],
        [capsule_end_x, capsule_end_y, capsule_end_z],
        capsule_radius,
    );
    let relation = sphere_capsule(sphere, capsule);

    serde_json::to_string(&json!({
        "sphere": { "center": sphere.center, "radius": sphere.radius },
        "capsule": {
            "start": capsule.segment.start,
            "end": capsule.segment.end,
            "radius": capsule.radius,
        },
        "capsuleAxisPoint": relation.capsule_axis_point,
        "capsuleParameter": relation.capsule_parameter,
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
pub fn capsule_capsule_json(
    left_start_x: f32,
    left_start_y: f32,
    left_start_z: f32,
    left_end_x: f32,
    left_end_y: f32,
    left_end_z: f32,
    left_radius: f32,
    right_start_x: f32,
    right_start_y: f32,
    right_start_z: f32,
    right_end_x: f32,
    right_end_y: f32,
    right_end_z: f32,
    right_radius: f32,
) -> Result<String, JsValue> {
    let left = Capsule::new(
        [left_start_x, left_start_y, left_start_z],
        [left_end_x, left_end_y, left_end_z],
        left_radius,
    );
    let right = Capsule::new(
        [right_start_x, right_start_y, right_start_z],
        [right_end_x, right_end_y, right_end_z],
        right_radius,
    );
    let relation = capsule_capsule(left, right);

    serde_json::to_string(&json!({
        "left": {
            "start": left.segment.start,
            "end": left.segment.end,
            "radius": left.radius,
        },
        "right": {
            "start": right.segment.start,
            "end": right.segment.end,
            "radius": right.radius,
        },
        "leftAxisPoint": relation.left_axis_point,
        "rightAxisPoint": relation.right_axis_point,
        "leftParameter": relation.left_parameter,
        "rightParameter": relation.right_parameter,
        "axisDistanceSquared": relation.axis_distance_squared,
        "axisDistance": relation.axis_distance,
        "radiusSum": relation.radius_sum,
        "radiusSumSquared": relation.radius_sum * relation.radius_sum,
        "signedSeparation": relation.signed_separation,
        "overlaps": relation.overlaps,
    }))
    .map_err(|error| JsValue::from_str(&error.to_string()))
}

#[allow(clippy::too_many_arguments)]
#[wasm_bindgen]
pub fn obb2_sat_json(
    left_x: f32,
    left_y: f32,
    left_half_x: f32,
    left_half_y: f32,
    left_rotation: f32,
    right_x: f32,
    right_y: f32,
    right_half_x: f32,
    right_half_y: f32,
    right_rotation: f32,
) -> Result<String, JsValue> {
    let left = Obb2::new([left_x, left_y], [left_half_x, left_half_y], left_rotation);
    let right = Obb2::new(
        [right_x, right_y],
        [right_half_x, right_half_y],
        right_rotation,
    );
    let relation = obb2_sat(left, right);
    let axis_labels = ["A.x", "A.y", "B.x", "B.y"];
    let axes: Vec<_> = relation
        .axes
        .iter()
        .enumerate()
        .map(|(index, axis)| {
            json!({
                "index": index,
                "label": axis_labels[index],
                "axis": axis.axis,
                "leftRadius": axis.left_radius,
                "rightRadius": axis.right_radius,
                "centerDistance": axis.center_distance,
                "signedOverlap": axis.signed_overlap,
                "separating": axis.separating,
                "critical": relation.critical_axis == index,
            })
        })
        .collect();

    serde_json::to_string(&json!({
        "left": {
            "center": left.center,
            "halfExtents": left.half_extents,
            "rotationRadians": left.rotation_radians,
        },
        "right": {
            "center": right.center,
            "halfExtents": right.half_extents,
            "rotationRadians": right.rotation_radians,
        },
        "axes": axes,
        "criticalAxis": relation.critical_axis,
        "overlaps": relation.overlaps,
    }))
    .map_err(|error| JsValue::from_str(&error.to_string()))
}

#[allow(clippy::too_many_arguments)]
#[wasm_bindgen]
pub fn obb3_sat_json(
    left_x: f32,
    left_y: f32,
    left_z: f32,
    left_half_x: f32,
    left_half_y: f32,
    left_half_z: f32,
    left_rotation_x: f32,
    left_rotation_y: f32,
    left_rotation_z: f32,
    right_x: f32,
    right_y: f32,
    right_z: f32,
    right_half_x: f32,
    right_half_y: f32,
    right_half_z: f32,
    right_rotation_x: f32,
    right_rotation_y: f32,
    right_rotation_z: f32,
) -> Result<String, JsValue> {
    let left = Obb3::new(
        [left_x, left_y, left_z],
        [left_half_x, left_half_y, left_half_z],
        [left_rotation_x, left_rotation_y, left_rotation_z],
    );
    let right = Obb3::new(
        [right_x, right_y, right_z],
        [right_half_x, right_half_y, right_half_z],
        [right_rotation_x, right_rotation_y, right_rotation_z],
    );
    let relation = obb3_sat(left, right);
    let axis_labels = [
        "A.x", "A.y", "A.z", "B.x", "B.y", "B.z", "A.x×B.x", "A.x×B.y", "A.x×B.z", "A.y×B.x",
        "A.y×B.y", "A.y×B.z", "A.z×B.x", "A.z×B.y", "A.z×B.z",
    ];
    let axes: Vec<_> = relation
        .axes
        .iter()
        .enumerate()
        .map(|(index, axis)| {
            json!({
                "index": index,
                "label": axis_labels[index],
                "axis": axis.axis,
                "leftRadius": axis.left_radius,
                "rightRadius": axis.right_radius,
                "centerDistance": axis.center_distance,
                "signedOverlap": axis.signed_overlap,
                "separating": axis.separating,
                "active": axis.active,
                "critical": relation.critical_axis == index,
            })
        })
        .collect();

    serde_json::to_string(&json!({
        "left": {
            "center": left.center,
            "halfExtents": left.half_extents,
            "rotationRadiansXYZ": left.rotation_radians_xyz,
            "axes": left.axes(),
        },
        "right": {
            "center": right.center,
            "halfExtents": right.half_extents,
            "rotationRadiansXYZ": right.rotation_radians_xyz,
            "axes": right.axes(),
        },
        "axes": axes,
        "criticalAxis": relation.critical_axis,
        "activeAxisCount": relation.active_axis_count,
        "overlaps": relation.overlaps,
    }))
    .map_err(|error| JsValue::from_str(&error.to_string()))
}
