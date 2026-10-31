pub(crate) fn normalize2_or_zero(value: [f32; 2]) -> [f32; 2] {
    let length_sq = length_squared2(value);
    if length_sq <= 1.0e-8 {
        [0.0, 0.0]
    } else {
        let inverse = length_sq.sqrt().recip();
        [value[0] * inverse, value[1] * inverse]
    }
}

pub(crate) fn normalize3(value: [f32; 3]) -> Option<[f32; 3]> {
    let length_sq = value[0] * value[0] + value[1] * value[1] + value[2] * value[2];
    if length_sq <= 1.0e-8 {
        None
    } else {
        let inverse = length_sq.sqrt().recip();
        Some([value[0] * inverse, value[1] * inverse, value[2] * inverse])
    }
}

pub(crate) fn length_squared2(value: [f32; 2]) -> f32 {
    value[0] * value[0] + value[1] * value[1]
}

pub(crate) fn distance_squared_xz(left: [f32; 3], right: [f32; 3]) -> f32 {
    let dx = left[0] - right[0];
    let dz = left[2] - right[2];
    dx * dx + dz * dz
}

pub(crate) fn add3(left: [f32; 3], right: [f32; 3]) -> [f32; 3] {
    [left[0] + right[0], left[1] + right[1], left[2] + right[2]]
}

pub(crate) fn sub3(left: [f32; 3], right: [f32; 3]) -> [f32; 3] {
    [left[0] - right[0], left[1] - right[1], left[2] - right[2]]
}

pub(crate) fn scale3(value: [f32; 3], scalar: f32) -> [f32; 3] {
    [value[0] * scalar, value[1] * scalar, value[2] * scalar]
}

pub(crate) fn lerp3(from: [f32; 3], to: [f32; 3], t: f32) -> [f32; 3] {
    [
        from[0] + (to[0] - from[0]) * t,
        from[1] + (to[1] - from[1]) * t,
        from[2] + (to[2] - from[2]) * t,
    ]
}
