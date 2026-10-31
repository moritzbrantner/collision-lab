use crate::Wall;

pub(crate) fn arena_walls() -> Vec<Wall> {
    vec![
        wall(100, [0.0, 1.5, -14.0], [14.5, 1.5, 0.5], false),
        wall(101, [0.0, 1.5, 14.0], [14.5, 1.5, 0.5], false),
        wall(102, [-14.0, 1.5, 0.0], [0.5, 1.5, 14.5], false),
        wall(103, [14.0, 1.5, 0.0], [0.5, 1.5, 14.5], false),
        wall(110, [-4.5, 1.1, -2.0], [0.6, 1.1, 5.0], false),
        wall(111, [4.5, 1.1, 2.5], [0.6, 1.1, 4.5], false),
        wall(112, [0.0, 1.1, -6.5], [3.2, 1.1, 0.6], false),
        wall(113, [0.0, 1.1, 7.0], [3.0, 1.1, 0.6], false),
        wall(120, [-1.6, 0.45, 1.5], [1.0, 0.45, 1.0], true),
        wall(121, [2.0, 0.45, -1.0], [1.0, 0.45, 1.0], true),
        wall(122, [-7.5, 0.45, 6.0], [1.3, 0.45, 0.8], true),
    ]
}

pub(crate) const fn wall(id: u32, position: [f32; 3], half: [f32; 3], low: bool) -> Wall {
    Wall {
        id,
        position,
        half,
        low,
        health: 0.0,
        max_health: 0.0,
        destructible: false,
    }
}
