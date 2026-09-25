use physics_engine::{
    BodyId,
    approximate::{Body, Config, Report, Shape, Vector as V, World},
};
use serde_json::json;
use wasm_bindgen::prelude::*;

const PHYSICS_ENGINE_REVISION: &str = "44a8f54241f4467867cd483daaa5179d4468ea02";

#[derive(Clone, Copy)]
struct PairCase {
    left: &'static str,
    right: &'static str,
    left_shape: Shape,
    right_shape: Shape,
}

fn pair_cases() -> [PairCase; 10] {
    [
        PairCase {
            left: "sphere",
            right: "sphere",
            left_shape: Shape::Sphere(1.0),
            right_shape: Shape::Sphere(1.0),
        },
        PairCase {
            left: "sphere",
            right: "box",
            left_shape: Shape::Sphere(1.0),
            right_shape: Shape::Box(V(1.0, 0.8, 1.2)),
        },
        PairCase {
            left: "sphere",
            right: "capsule",
            left_shape: Shape::Sphere(1.0),
            right_shape: Shape::capsule(0.8, 0.6),
        },
        PairCase {
            left: "sphere",
            right: "wedge",
            left_shape: Shape::Sphere(1.0),
            right_shape: Shape::wedge(V(1.2, 0.9, 1.1)),
        },
        PairCase {
            left: "box",
            right: "box",
            left_shape: Shape::Box(V(1.0, 0.8, 1.2)),
            right_shape: Shape::Box(V(0.9, 1.1, 0.8)),
        },
        PairCase {
            left: "box",
            right: "capsule",
            left_shape: Shape::Box(V(1.0, 0.8, 1.2)),
            right_shape: Shape::capsule(0.8, 0.6),
        },
        PairCase {
            left: "box",
            right: "wedge",
            left_shape: Shape::Box(V(1.0, 0.8, 1.2)),
            right_shape: Shape::wedge(V(1.2, 0.9, 1.1)),
        },
        PairCase {
            left: "capsule",
            right: "capsule",
            left_shape: Shape::capsule(0.8, 0.6),
            right_shape: Shape::capsule(0.7, 0.65),
        },
        PairCase {
            left: "capsule",
            right: "wedge",
            left_shape: Shape::capsule(0.8, 0.6),
            right_shape: Shape::wedge(V(1.2, 0.9, 1.1)),
        },
        PairCase {
            left: "wedge",
            right: "wedge",
            left_shape: Shape::wedge(V(1.2, 0.9, 1.1)),
            right_shape: Shape::wedge(V(1.0, 1.1, 0.9)),
        },
    ]
}

#[wasm_bindgen]
pub fn physics_engine_primitive_matrix_json() -> Result<String, JsValue> {
    let mut pairs = Vec::with_capacity(10);
    let mut all_specialized = true;

    for case in pair_cases() {
        let report = primitive_pair_report(case.left_shape, case.right_shape)
            .map_err(|error| JsValue::from_str(&error))?;
        let geometry = report.geometry;
        let specialized_dispatches: u64 = geometry.specialized_pair_dispatches.iter().sum();
        let specialized = specialized_dispatches > 0 && geometry.generic_fallback_calls == 0;
        all_specialized &= specialized;

        pairs.push(json!({
            "left": case.left,
            "right": case.right,
            "specialized": specialized,
            "specializedDispatches": specialized_dispatches,
            "genericFallbackCalls": geometry.generic_fallback_calls,
            "supportEvaluations": geometry.support_evaluations,
            "satQueries": geometry.sat_queries,
            "satAxesTested": geometry.sat_axes_tested,
            "clipPasses": geometry.clip_passes,
            "primitiveQueries": geometry.primitive_queries,
            "primitiveAxesTested": geometry.primitive_axes_tested,
            "primitiveVertexTests": geometry.primitive_vertex_tests,
            "manifoldCandidates": geometry.manifold_candidates,
        }));
    }

    serde_json::to_string(&json!({
        "source": "physics-engine",
        "sourceRevision": PHYSICS_ENGINE_REVISION,
        "shapes": ["sphere", "box", "capsule", "wedge"],
        "allSpecialized": all_specialized,
        "pairs": pairs,
    }))
    .map_err(|error| JsValue::from_str(&error.to_string()))
}

#[wasm_bindgen]
pub fn physics_engine_capsule_wedge_ccd_json() -> Result<String, JsValue> {
    let mut world = World::new(Config {
        gravity: V::ZERO,
        ..Config::default()
    })
    .map_err(|error| JsValue::from_str(&error.to_string()))?;

    world
        .add_body(Body::new(
            BodyId(1),
            Shape::wedge(V(10.0, 10.0, 0.02)),
            V::ZERO,
            0.0,
        ))
        .map_err(|error| JsValue::from_str(&error.to_string()))?;

    let mut projectile = Body::new(
        BodyId(2),
        Shape::capsule(0.5, 0.1),
        V(-5.0, -5.0, 10.0),
        1.0,
    );
    projectile.velocity = V(0.0, 0.0, -10_000.0);
    projectile.ccd = true;
    projectile.retire_on_impact = true;
    world
        .add_body(projectile)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;

    let report = world
        .step(1.0 / 60.0)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    let hit = report.swept_contacts > 0 && report.retired == vec![BodyId(2)];

    serde_json::to_string(&json!({
        "source": "physics-engine",
        "sourceRevision": PHYSICS_ENGINE_REVISION,
        "scenario": "fast-capsule-thin-wedge",
        "hit": hit,
        "sweptContacts": report.swept_contacts,
        "retiredBodyIds": report.retired.iter().map(|id| id.0).collect::<Vec<_>>(),
        "primitiveQueries": report.geometry.primitive_queries,
        "primitiveSweepIterations": report.geometry.primitive_sweep_iterations,
        "genericFallbackCalls": report.geometry.generic_fallback_calls,
        "speed": 10_000.0,
        "stepSeconds": 1.0 / 60.0,
        "wedgeHalfThickness": 0.02,
        "capsuleRadius": 0.1,
    }))
    .map_err(|error| JsValue::from_str(&error.to_string()))
}

fn primitive_pair_report(left_shape: Shape, right_shape: Shape) -> Result<Report, String> {
    let mut world = World::new(Config {
        gravity: V::ZERO,
        ..Config::default()
    })
    .map_err(|error| error.to_string())?;

    let mut left = Body::new(BodyId(1), left_shape, V::ZERO, 1.0);
    left.rotation_locked = true;
    left.sleep_allowed = false;

    let mut right = Body::new(BodyId(2), right_shape, V(0.5, 0.0, 0.0), 0.0);
    right.sleep_allowed = false;

    world.add_body(left).map_err(|error| error.to_string())?;
    world.add_body(right).map_err(|error| error.to_string())?;
    world.step(1.0 / 60.0).map_err(|error| error.to_string())
}
