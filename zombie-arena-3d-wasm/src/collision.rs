use spatial_kernels::Aabb;

use crate::math::sub3;
use crate::{WORLD_HALF, Wall};

pub(crate) fn actor_aabb(position: [f32; 3], half: [f32; 3]) -> Aabb {
    Aabb::from_center_half_extents(position, half)
}

pub(crate) fn wall_aabb(wall: Wall) -> Aabb {
    Aabb::from_center_half_extents(wall.position, wall.half)
}

pub(crate) fn aabb_overlaps(left: Aabb, right: Aabb) -> bool {
    left.min[0] < right.max[0]
        && left.max[0] > right.min[0]
        && left.min[1] < right.max[1]
        && left.max[1] > right.min[1]
        && left.min[2] < right.max[2]
        && left.max[2] > right.min[2]
}

pub(crate) fn expand_xz(aabb: Aabb, amount: f32) -> Aabb {
    Aabb {
        min: [aabb.min[0] - amount, aabb.min[1], aabb.min[2] - amount],
        max: [aabb.max[0] + amount, aabb.max[1], aabb.max[2] + amount],
    }
}

pub(crate) fn collides_with_walls(position: [f32; 3], half: [f32; 3], walls: &[Wall]) -> bool {
    let actor = actor_aabb(position, half);
    walls
        .iter()
        .any(|wall| aabb_overlaps(actor, wall_aabb(*wall)))
}

pub(crate) fn move_with_sliding_3d(
    position: [f32; 3],
    half: [f32; 3],
    delta: [f32; 3],
    walls: &[Wall],
) -> [f32; 3] {
    let mut next = position;
    for axis in [0, 2] {
        let mut candidate = next;
        candidate[axis] += delta[axis];
        if !collides_with_walls(candidate, half, walls) {
            next = candidate;
        }
    }
    next
}

pub(crate) fn move_vertical(
    position: [f32; 3],
    half: [f32; 3],
    delta_y: f32,
    walls: &[Wall],
) -> (f32, bool) {
    let floor_y = half[1];
    let desired = position[1] + delta_y;
    if desired <= floor_y {
        return (floor_y, true);
    }

    let mut candidate = position;
    candidate[1] = desired;
    if !collides_with_walls(candidate, half, walls) {
        return (desired, false);
    }

    if delta_y < 0.0 {
        let actor_bottom = position[1] - half[1];
        let mut best_top = floor_y;
        for wall in walls {
            if overlaps_xz(position, half, *wall) {
                let top = wall.position[1] + wall.half[1] + half[1];
                if actor_bottom >= wall.position[1] + wall.half[1] - 0.15
                    && top <= position[1] + 0.15
                {
                    best_top = best_top.max(top);
                }
            }
        }
        return (best_top.min(position[1]), true);
    }

    (position[1], true)
}

pub(crate) fn is_supported(position: [f32; 3], half: [f32; 3], walls: &[Wall]) -> bool {
    if position[1] - half[1] <= 0.002 {
        return true;
    }
    walls.iter().any(|wall| {
        overlaps_xz(position, half, *wall)
            && ((position[1] - half[1]) - (wall.position[1] + wall.half[1])).abs() <= 0.02
    })
}

pub(crate) fn grounded_center_y(position: [f32; 3], half: [f32; 3], walls: &[Wall]) -> f32 {
    let mut y = half[1];
    for wall in walls {
        if overlaps_xz(position, half, *wall) {
            let top = wall.position[1] + wall.half[1] + half[1];
            if top <= position[1] + 0.05 {
                y = y.max(top);
            }
        }
    }
    y
}

fn overlaps_xz(position: [f32; 3], half: [f32; 3], wall: Wall) -> bool {
    (position[0] - wall.position[0]).abs() < half[0] + wall.half[0]
        && (position[2] - wall.position[2]).abs() < half[2] + wall.half[2]
}

pub(crate) fn segment_aabb_toi(
    from: [f32; 3],
    to: [f32; 3],
    aabb: Aabb,
    radius: f32,
) -> Option<f32> {
    let direction = sub3(to, from);
    let min = [
        aabb.min[0] - radius,
        aabb.min[1] - radius,
        aabb.min[2] - radius,
    ];
    let max = [
        aabb.max[0] + radius,
        aabb.max[1] + radius,
        aabb.max[2] + radius,
    ];
    let mut t_min = 0.0_f32;
    let mut t_max = 1.0_f32;

    for axis in 0..3 {
        if direction[axis].abs() < 1.0e-7 {
            if from[axis] < min[axis] || from[axis] > max[axis] {
                return None;
            }
            continue;
        }

        let inverse = direction[axis].recip();
        let mut near = (min[axis] - from[axis]) * inverse;
        let mut far = (max[axis] - from[axis]) * inverse;
        if near > far {
            std::mem::swap(&mut near, &mut far);
        }
        t_min = t_min.max(near);
        t_max = t_max.min(far);
        if t_min > t_max {
            return None;
        }
    }

    (t_max >= 0.0 && t_min <= 1.0).then_some(t_min.clamp(0.0, 1.0))
}

pub(crate) fn inside_world3(point: [f32; 3], radius: f32) -> bool {
    point[0].abs() <= WORLD_HALF + radius
        && point[2].abs() <= WORLD_HALF + radius
        && point[1] >= -radius
        && point[1] <= 12.0
}
