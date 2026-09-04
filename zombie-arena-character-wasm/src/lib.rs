use serde_json::json;
use three_d_animation::{
    AnimationClip, AnimationTrack, Interpolation, Keyframe, KeyframeTrack, Quat, Transform,
    TransformNode, world_matrices,
};
use three_d_core::{Mesh, Vec3};
use wasm_bindgen::prelude::*;

const ROOT: usize = 0;
const TORSO: usize = 1;
const HEAD: usize = 2;
const LEFT_UPPER_ARM: usize = 3;
const LEFT_LOWER_ARM: usize = 4;
const RIGHT_UPPER_ARM: usize = 5;
const RIGHT_LOWER_ARM: usize = 6;
const LEFT_THIGH: usize = 7;
const LEFT_SHIN: usize = 8;
const RIGHT_THIGH: usize = 9;
const RIGHT_SHIN: usize = 10;
const NODE_COUNT: usize = 11;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ClipKind {
    Idle,
    Walk,
    Attack,
    Death,
}

impl ClipKind {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "idle" => Ok(Self::Idle),
            "walk" => Ok(Self::Walk),
            "attack" => Ok(Self::Attack),
            "death" => Ok(Self::Death),
            other => Err(format!(
                "unknown humanoid clip `{other}`; expected idle, walk, attack, or death"
            )),
        }
    }

    const fn as_str(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Walk => "walk",
            Self::Attack => "attack",
            Self::Death => "death",
        }
    }

    const fn loops(self) -> bool {
        !matches!(self, Self::Death)
    }
}

#[derive(Debug)]
struct Clips {
    idle: AnimationClip,
    walk: AnimationClip,
    attack: AnimationClip,
    death: AnimationClip,
}

impl Clips {
    fn get(&self, kind: ClipKind) -> &AnimationClip {
        match kind {
            ClipKind::Idle => &self.idle,
            ClipKind::Walk => &self.walk,
            ClipKind::Attack => &self.attack,
            ClipKind::Death => &self.death,
        }
    }
}

#[wasm_bindgen]
pub struct HumanoidAnimator {
    rest_pose: Vec<Transform>,
    hierarchy: Vec<TransformNode>,
    clips: Clips,
}

#[wasm_bindgen]
impl HumanoidAnimator {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Result<HumanoidAnimator, JsValue> {
        Self::new_inner().map_err(|error| JsValue::from_str(&error))
    }

    pub fn model_json(&self) -> Result<String, JsValue> {
        self.model()
            .map_err(|error| JsValue::from_str(&error.to_string()))
    }

    pub fn sample_pose_json(&self, clip: &str, time_seconds: f32) -> Result<String, JsValue> {
        if !time_seconds.is_finite() {
            return Err(JsValue::from_str("animation time must be finite"));
        }
        let kind = ClipKind::parse(clip).map_err(|error| JsValue::from_str(&error))?;
        self.sample_pose(kind, time_seconds)
            .map_err(|error| JsValue::from_str(&error))
    }
}

impl HumanoidAnimator {
    fn new_inner() -> Result<Self, String> {
        let rest_pose = rest_pose();
        let hierarchy = hierarchy(&rest_pose);
        world_matrices(&hierarchy).map_err(|error| error.to_string())?;
        Ok(Self {
            rest_pose,
            hierarchy,
            clips: Clips {
                idle: idle_clip()?,
                walk: walk_clip()?,
                attack: attack_clip()?,
                death: death_clip()?,
            },
        })
    }

    fn model(&self) -> Result<String, serde_json::Error> {
        let cube = Mesh::unit_cube();
        let rest_world = world_matrices(&self.hierarchy).expect("validated humanoid hierarchy");
        let origins = rest_world
            .iter()
            .map(|matrix| {
                let origin = matrix.transform_point(Vec3::ZERO);
                [origin.x, origin.y, origin.z]
            })
            .collect::<Vec<_>>();
        let clip_metadata = [
            ClipKind::Idle,
            ClipKind::Walk,
            ClipKind::Attack,
            ClipKind::Death,
        ]
        .into_iter()
        .map(|kind| {
            let clip = self.clips.get(kind);
            json!({
                "name": kind.as_str(),
                "duration": clip.duration(),
                "loops": kind.loops(),
            })
        })
        .collect::<Vec<_>>();

        let value = json!({
            "source": {
                "geometry": "three-d-core",
                "animation": "three-d-animation",
                "revision": "416e3c9cd3bbc2fe6bb258eb1e04cf1245d9346e",
            },
            "mesh": {
                "vertices": cube.vertices().iter().map(vec3_array).collect::<Vec<_>>(),
                "indices": cube.indices(),
                "vertexCount": cube.vertices().len(),
                "triangleCount": cube.triangle_count(),
            },
            "nodes": self.rest_pose.iter().enumerate().map(|(index, transform)| {
                let spec = node_spec(index);
                json!({
                    "name": spec.name,
                    "parent": spec.parent,
                    "translation": vec3_array(&transform.translation),
                    "rotation": quat_array(transform.rotation),
                    "scale": vec3_array(&transform.scale),
                    "part": {
                        "size": spec.size,
                        "offset": spec.offset,
                    },
                })
            }).collect::<Vec<_>>(),
            "restWorldOrigins": origins,
            "clips": clip_metadata,
        });
        serde_json::to_string(&value)
    }

    fn sample_pose(&self, kind: ClipKind, time_seconds: f32) -> Result<String, String> {
        let clip = self.clips.get(kind);
        let duration = clip.duration();
        let sample_time = if kind.loops() && duration > 0.0 {
            time_seconds.rem_euclid(duration)
        } else {
            time_seconds.clamp(0.0, duration)
        };
        let mut pose = self.rest_pose.clone();
        clip.sample(sample_time, &mut pose)
            .map_err(|error| error.to_string())?;

        serde_json::to_string(&json!({
            "clip": kind.as_str(),
            "time": sample_time,
            "duration": duration,
            "nodes": pose.iter().map(|transform| json!({
                "translation": vec3_array(&transform.translation),
                "rotation": quat_array(transform.rotation),
                "scale": vec3_array(&transform.scale),
            })).collect::<Vec<_>>(),
        }))
        .map_err(|error| error.to_string())
    }
}

#[derive(Clone, Copy)]
struct NodeSpec {
    name: &'static str,
    parent: Option<usize>,
    size: [f32; 3],
    offset: [f32; 3],
}

fn node_spec(index: usize) -> NodeSpec {
    match index {
        ROOT => NodeSpec {
            name: "hips",
            parent: None,
            size: [0.56, 0.28, 0.34],
            offset: [0.0, 0.0, 0.0],
        },
        TORSO => NodeSpec {
            name: "torso",
            parent: Some(ROOT),
            size: [0.74, 0.9, 0.38],
            offset: [0.0, 0.45, 0.0],
        },
        HEAD => NodeSpec {
            name: "head",
            parent: Some(TORSO),
            size: [0.44, 0.46, 0.44],
            offset: [0.0, 0.23, 0.0],
        },
        LEFT_UPPER_ARM => NodeSpec {
            name: "left-upper-arm",
            parent: Some(TORSO),
            size: [0.22, 0.64, 0.22],
            offset: [0.0, -0.32, 0.0],
        },
        LEFT_LOWER_ARM => NodeSpec {
            name: "left-lower-arm",
            parent: Some(LEFT_UPPER_ARM),
            size: [0.18, 0.58, 0.18],
            offset: [0.0, -0.29, 0.0],
        },
        RIGHT_UPPER_ARM => NodeSpec {
            name: "right-upper-arm",
            parent: Some(TORSO),
            size: [0.22, 0.64, 0.22],
            offset: [0.0, -0.32, 0.0],
        },
        RIGHT_LOWER_ARM => NodeSpec {
            name: "right-lower-arm",
            parent: Some(RIGHT_UPPER_ARM),
            size: [0.18, 0.58, 0.18],
            offset: [0.0, -0.29, 0.0],
        },
        LEFT_THIGH => NodeSpec {
            name: "left-thigh",
            parent: Some(ROOT),
            size: [0.27, 0.72, 0.3],
            offset: [0.0, -0.36, 0.0],
        },
        LEFT_SHIN => NodeSpec {
            name: "left-shin",
            parent: Some(LEFT_THIGH),
            size: [0.23, 0.68, 0.25],
            offset: [0.0, -0.34, 0.0],
        },
        RIGHT_THIGH => NodeSpec {
            name: "right-thigh",
            parent: Some(ROOT),
            size: [0.27, 0.72, 0.3],
            offset: [0.0, -0.36, 0.0],
        },
        RIGHT_SHIN => NodeSpec {
            name: "right-shin",
            parent: Some(RIGHT_THIGH),
            size: [0.23, 0.68, 0.25],
            offset: [0.0, -0.34, 0.0],
        },
        _ => panic!("unknown humanoid node {index}"),
    }
}

fn rest_pose() -> Vec<Transform> {
    vec![
        translated(0.0, 0.0, 0.0),
        translated(0.0, 0.18, 0.0),
        translated(0.0, 1.0, 0.0),
        translated(-0.49, 0.73, 0.0),
        translated(0.0, -0.62, 0.0),
        translated(0.49, 0.73, 0.0),
        translated(0.0, -0.62, 0.0),
        translated(-0.21, -0.12, 0.0),
        translated(0.0, -0.72, 0.0),
        translated(0.21, -0.12, 0.0),
        translated(0.0, -0.72, 0.0),
    ]
}

fn hierarchy(pose: &[Transform]) -> Vec<TransformNode> {
    (0..NODE_COUNT)
        .map(|index| TransformNode {
            parent: node_spec(index).parent,
            local: pose[index],
        })
        .collect()
}

fn translated(x: f32, y: f32, z: f32) -> Transform {
    Transform {
        translation: Vec3::new(x, y, z),
        ..Transform::IDENTITY
    }
}

fn idle_clip() -> Result<AnimationClip, String> {
    AnimationClip::new(
        "idle",
        vec![
            rotation_track(
                TORSO,
                &[
                    (0.0, euler(0.0, 0.0, -0.025)),
                    (1.0, euler(0.0, 0.0, 0.025)),
                    (2.0, euler(0.0, 0.0, -0.025)),
                ],
            )?,
            rotation_track(
                HEAD,
                &[
                    (0.0, euler(0.0, -0.08, 0.0)),
                    (1.0, euler(0.0, 0.08, 0.0)),
                    (2.0, euler(0.0, -0.08, 0.0)),
                ],
            )?,
            rotation_track(
                LEFT_UPPER_ARM,
                &[
                    (0.0, euler(-0.04, 0.0, -0.05)),
                    (1.0, euler(0.04, 0.0, -0.02)),
                    (2.0, euler(-0.04, 0.0, -0.05)),
                ],
            )?,
            rotation_track(
                RIGHT_UPPER_ARM,
                &[
                    (0.0, euler(0.04, 0.0, 0.05)),
                    (1.0, euler(-0.04, 0.0, 0.02)),
                    (2.0, euler(0.04, 0.0, 0.05)),
                ],
            )?,
        ],
    )
    .map_err(|error| error.to_string())
}

fn walk_clip() -> Result<AnimationClip, String> {
    let cycle = [0.0, 0.25, 0.5, 0.75, 1.0];
    AnimationClip::new(
        "walk",
        vec![
            rotation_track_angles(LEFT_THIGH, &cycle, &[0.58, 0.0, -0.58, 0.0, 0.58])?,
            rotation_track_angles(RIGHT_THIGH, &cycle, &[-0.58, 0.0, 0.58, 0.0, -0.58])?,
            rotation_track_angles(LEFT_SHIN, &cycle, &[0.08, 0.3, 0.08, -0.12, 0.08])?,
            rotation_track_angles(RIGHT_SHIN, &cycle, &[0.08, -0.12, 0.08, 0.3, 0.08])?,
            rotation_track_angles(LEFT_UPPER_ARM, &cycle, &[-0.46, 0.0, 0.46, 0.0, -0.46])?,
            rotation_track_angles(RIGHT_UPPER_ARM, &cycle, &[0.46, 0.0, -0.46, 0.0, 0.46])?,
            rotation_track(
                TORSO,
                &[
                    (0.0, euler(0.04, -0.06, 0.0)),
                    (0.5, euler(0.04, 0.06, 0.0)),
                    (1.0, euler(0.04, -0.06, 0.0)),
                ],
            )?,
        ],
    )
    .map_err(|error| error.to_string())
}

fn attack_clip() -> Result<AnimationClip, String> {
    AnimationClip::new(
        "attack",
        vec![
            rotation_track(
                TORSO,
                &[
                    (0.0, euler(0.0, 0.0, 0.0)),
                    (0.2, euler(0.16, 0.0, 0.0)),
                    (0.42, euler(0.22, 0.0, 0.0)),
                    (0.7, euler(0.0, 0.0, 0.0)),
                ],
            )?,
            rotation_track(
                LEFT_UPPER_ARM,
                &[
                    (0.0, euler(0.0, 0.0, -0.04)),
                    (0.2, euler(1.18, 0.0, -0.1)),
                    (0.42, euler(1.4, 0.0, -0.08)),
                    (0.7, euler(0.0, 0.0, -0.04)),
                ],
            )?,
            rotation_track(
                RIGHT_UPPER_ARM,
                &[
                    (0.0, euler(0.0, 0.0, 0.04)),
                    (0.2, euler(1.18, 0.0, 0.1)),
                    (0.42, euler(1.4, 0.0, 0.08)),
                    (0.7, euler(0.0, 0.0, 0.04)),
                ],
            )?,
            rotation_track(
                LEFT_LOWER_ARM,
                &[
                    (0.0, euler(0.0, 0.0, 0.0)),
                    (0.28, euler(0.34, 0.0, 0.0)),
                    (0.7, euler(0.0, 0.0, 0.0)),
                ],
            )?,
            rotation_track(
                RIGHT_LOWER_ARM,
                &[
                    (0.0, euler(0.0, 0.0, 0.0)),
                    (0.28, euler(0.34, 0.0, 0.0)),
                    (0.7, euler(0.0, 0.0, 0.0)),
                ],
            )?,
        ],
    )
    .map_err(|error| error.to_string())
}

fn death_clip() -> Result<AnimationClip, String> {
    let translation = KeyframeTrack::new(
        vec![
            Keyframe {
                time: 0.0,
                value: Vec3::ZERO,
            },
            Keyframe {
                time: 0.45,
                value: Vec3::new(0.0, -0.12, 0.0),
            },
            Keyframe {
                time: 1.1,
                value: Vec3::new(0.0, -0.72, 0.0),
            },
        ],
        Interpolation::SmoothStep,
    )
    .map_err(|error| error.to_string())?;
    AnimationClip::new(
        "death",
        vec![
            AnimationTrack::Translation {
                node: ROOT,
                track: translation,
            },
            rotation_track(
                ROOT,
                &[
                    (0.0, euler(0.0, 0.0, 0.0)),
                    (0.45, euler(0.12, 0.0, 0.55)),
                    (1.1, euler(0.22, 0.0, 1.45)),
                ],
            )?,
            rotation_track(
                LEFT_UPPER_ARM,
                &[
                    (0.0, euler(0.0, 0.0, -0.04)),
                    (1.1, euler(-0.72, 0.0, -0.55)),
                ],
            )?,
            rotation_track(
                RIGHT_UPPER_ARM,
                &[(0.0, euler(0.0, 0.0, 0.04)), (1.1, euler(0.55, 0.0, 0.48))],
            )?,
        ],
    )
    .map_err(|error| error.to_string())
}

fn rotation_track_angles(
    node: usize,
    times: &[f32],
    x_angles: &[f32],
) -> Result<AnimationTrack, String> {
    let frames = times
        .iter()
        .copied()
        .zip(x_angles.iter().copied())
        .map(|(time, angle)| (time, euler(angle, 0.0, 0.0)))
        .collect::<Vec<_>>();
    rotation_track(node, &frames)
}

fn rotation_track(node: usize, frames: &[(f32, Quat)]) -> Result<AnimationTrack, String> {
    let track = KeyframeTrack::new(
        frames
            .iter()
            .copied()
            .map(|(time, value)| Keyframe { time, value })
            .collect(),
        Interpolation::SmoothStep,
    )
    .map_err(|error| error.to_string())?;
    Ok(AnimationTrack::Rotation { node, track })
}

fn euler(x: f32, y: f32, z: f32) -> Quat {
    Quat::from_euler_xyz(x, y, z)
}

fn vec3_array(value: &Vec3) -> [f32; 3] {
    [value.x, value.y, value.z]
}

fn quat_array(value: Quat) -> [f32; 4] {
    [value.x, value.y, value.z, value.w]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pose(animator: &HumanoidAnimator, clip: ClipKind, time: f32) -> serde_json::Value {
        serde_json::from_str(&animator.sample_pose(clip, time).unwrap()).unwrap()
    }

    #[test]
    fn shared_model_is_an_articulated_unit_cube_humanoid() {
        let animator = HumanoidAnimator::new_inner().unwrap();
        let model: serde_json::Value = serde_json::from_str(&animator.model().unwrap()).unwrap();
        assert_eq!(model["nodes"].as_array().unwrap().len(), NODE_COUNT);
        assert_eq!(model["mesh"]["vertexCount"], 8);
        assert_eq!(model["mesh"]["triangleCount"], 12);
        assert_eq!(model["nodes"][HEAD]["parent"].as_u64(), Some(TORSO as u64));
    }

    #[test]
    fn walk_swings_opposite_legs() {
        let animator = HumanoidAnimator::new_inner().unwrap();
        let pose = pose(&animator, ClipKind::Walk, 0.0);
        let left = pose["nodes"][LEFT_THIGH]["rotation"][0].as_f64().unwrap();
        let right = pose["nodes"][RIGHT_THIGH]["rotation"][0].as_f64().unwrap();
        assert!(left * right < 0.0);
    }

    #[test]
    fn looping_clips_repeat_but_death_clamps() {
        let animator = HumanoidAnimator::new_inner().unwrap();
        assert_eq!(
            pose(&animator, ClipKind::Walk, 0.25),
            pose(&animator, ClipKind::Walk, 1.25)
        );
        let death_end = pose(&animator, ClipKind::Death, 1.1);
        let death_late = pose(&animator, ClipKind::Death, 8.0);
        assert_eq!(death_end, death_late);
    }

    #[test]
    fn death_lowers_and_rotates_the_root() {
        let animator = HumanoidAnimator::new_inner().unwrap();
        let death = pose(&animator, ClipKind::Death, 1.1);
        assert!(death["nodes"][ROOT]["translation"][1].as_f64().unwrap() < -0.6);
        let rotation = death["nodes"][ROOT]["rotation"].as_array().unwrap();
        assert!(
            rotation
                .iter()
                .take(3)
                .any(|value| value.as_f64().unwrap().abs() > 0.1)
        );
    }

    #[test]
    fn invalid_clip_is_rejected() {
        assert!(ClipKind::parse("dance").is_err());
    }
}
