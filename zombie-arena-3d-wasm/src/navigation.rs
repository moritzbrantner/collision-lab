use std::{
    cmp::Ordering,
    collections::{BTreeMap, BTreeSet, BinaryHeap},
};

use wasm_bindgen::prelude::*;

use super::{
    NAV_CELL, NAV_MAX, NAV_MIN, PLAYER_HALF, ZOMBIE_HALF, ZombieArena3dWorld, aabb_overlaps,
    actor_aabb, wall_aabb,
};

const BUILT_WALL_ID_BASE: u32 = 10_000;
const BARRICADE_HALF: [f32; 3] = [0.46, 0.72, 0.46];
const BARRICADE_HEALTH: f32 = 100.0;

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub(crate) struct Cell {
    pub(crate) x: i32,
    pub(crate) z: i32,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct OpenNode {
    cell: Cell,
    g: u32,
    h: u32,
}

impl OpenNode {
    fn f(&self) -> u32 {
        self.g.saturating_add(self.h)
    }
}

impl Ord for OpenNode {
    fn cmp(&self, other: &Self) -> Ordering {
        // BinaryHeap is a max-heap. Reverse comparisons so the smallest
        // f/h/cell tuple wins. Cell ordering is the final deterministic tie-break.
        other
            .f()
            .cmp(&self.f())
            .then_with(|| other.h.cmp(&self.h))
            .then_with(|| other.cell.cmp(&self.cell))
    }
}

impl PartialOrd for OpenNode {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct PathSearch {
    pub(crate) path: Vec<Cell>,
    pub(crate) expanded: u32,
}

pub(crate) fn astar(
    start: Cell,
    goal: Cell,
    blocked: &BTreeSet<Cell>,
    min_cell: i32,
    max_cell: i32,
) -> Option<PathSearch> {
    if start == goal {
        return Some(PathSearch {
            path: vec![start],
            expanded: 0,
        });
    }

    let mut open = BinaryHeap::new();
    let mut best_g = BTreeMap::new();
    let mut came_from = BTreeMap::new();
    let mut expanded = 0_u32;

    open.push(OpenNode {
        cell: start,
        g: 0,
        h: manhattan(start, goal),
    });
    best_g.insert(start, 0_u32);

    while let Some(current) = open.pop() {
        if current.cell == goal {
            let raw_path = reconstruct_path(start, goal, &came_from);
            return Some(PathSearch {
                path: smooth_path(&raw_path, blocked),
                expanded,
            });
        }

        if best_g
            .get(&current.cell)
            .is_some_and(|known| current.g > *known)
        {
            continue;
        }

        expanded = expanded.saturating_add(1);
        for neighbor in neighbors(current.cell) {
            if neighbor.x < min_cell
                || neighbor.x > max_cell
                || neighbor.z < min_cell
                || neighbor.z > max_cell
                || (neighbor != goal && blocked.contains(&neighbor))
            {
                continue;
            }

            let next_g = current.g.saturating_add(1);
            if best_g.get(&neighbor).is_some_and(|known| next_g >= *known) {
                continue;
            }

            best_g.insert(neighbor, next_g);
            came_from.insert(neighbor, current.cell);
            open.push(OpenNode {
                cell: neighbor,
                g: next_g,
                h: manhattan(neighbor, goal),
            });
        }
    }

    None
}

fn smooth_path(path: &[Cell], blocked: &BTreeSet<Cell>) -> Vec<Cell> {
    if path.len() <= 2 {
        return path.to_vec();
    }

    let mut smoothed = Vec::with_capacity(path.len());
    let mut anchor = 0;
    smoothed.push(path[anchor]);

    while anchor + 1 < path.len() {
        let mut next = anchor + 1;
        for candidate in ((anchor + 1)..path.len()).rev() {
            if line_of_sight(path[anchor], path[candidate], blocked) {
                next = candidate;
                break;
            }
        }
        smoothed.push(path[next]);
        anchor = next;
    }

    smoothed
}

fn line_of_sight(from: Cell, to: Cell, blocked: &BTreeSet<Cell>) -> bool {
    let dx = to.x - from.x;
    let dz = to.z - from.z;
    let steps = dx.unsigned_abs().max(dz.unsigned_abs());
    if steps == 0 {
        return true;
    }

    let mut previous = from;
    for step in 1..=steps {
        let t = step as f32 / steps as f32;
        let current = Cell {
            x: (from.x as f32 + dx as f32 * t).round() as i32,
            z: (from.z as f32 + dz as f32 * t).round() as i32,
        };
        if current != to && blocked.contains(&current) {
            return false;
        }

        if current.x != previous.x && current.z != previous.z {
            let side_x = Cell {
                x: current.x,
                z: previous.z,
            };
            let side_z = Cell {
                x: previous.x,
                z: current.z,
            };
            if (side_x != to && blocked.contains(&side_x))
                || (side_z != to && blocked.contains(&side_z))
            {
                return false;
            }
        }
        previous = current;
    }

    true
}

fn reconstruct_path(start: Cell, goal: Cell, came_from: &BTreeMap<Cell, Cell>) -> Vec<Cell> {
    let mut path = vec![goal];
    let mut current = goal;
    while current != start {
        let Some(parent) = came_from.get(&current).copied() else {
            return vec![start];
        };
        current = parent;
        path.push(current);
    }
    path.reverse();
    path
}

fn manhattan(left: Cell, right: Cell) -> u32 {
    left.x
        .abs_diff(right.x)
        .saturating_add(left.z.abs_diff(right.z))
}

fn neighbors(cell: Cell) -> [Cell; 4] {
    [
        Cell {
            x: cell.x - 1,
            z: cell.z,
        },
        Cell {
            x: cell.x,
            z: cell.z - 1,
        },
        Cell {
            x: cell.x,
            z: cell.z + 1,
        },
        Cell {
            x: cell.x + 1,
            z: cell.z,
        },
    ]
}

#[wasm_bindgen]
impl ZombieArena3dWorld {
    pub fn build_json(&mut self, world_x: f32, world_z: f32) -> Result<String, JsValue> {
        if !world_x.is_finite() || !world_z.is_finite() {
            return Err(JsValue::from_str("barricade position must be finite"));
        }

        let cell = snap_cell(world_x, world_z);
        if cell.x <= NAV_MIN || cell.x >= NAV_MAX || cell.z <= NAV_MIN || cell.z >= NAV_MAX {
            return Err(JsValue::from_str("barricades must stay inside the arena"));
        }

        let candidate = super::Wall {
            id: self.next_barricade_id(),
            position: cell_center(cell),
            half: BARRICADE_HALF,
            low: false,
            health: BARRICADE_HEALTH,
            max_health: BARRICADE_HEALTH,
            destructible: true,
        };
        let bounds = wall_aabb(candidate);

        if self
            .walls
            .iter()
            .any(|wall| aabb_overlaps(bounds, wall_aabb(*wall)))
            || aabb_overlaps(bounds, actor_aabb(self.player.position, PLAYER_HALF))
            || self
                .zombies
                .iter()
                .any(|zombie| aabb_overlaps(bounds, actor_aabb(zombie.position, ZOMBIE_HALF)))
        {
            return Err(JsValue::from_str("that navigation cell is occupied"));
        }

        self.walls.push(candidate);
        self.invalidate_navigation();
        self.refresh_collision_metrics();
        self.snapshot_json()
    }

    pub fn remove_barricade_json(&mut self, world_x: f32, world_z: f32) -> Result<String, JsValue> {
        if !world_x.is_finite() || !world_z.is_finite() {
            return Err(JsValue::from_str("barricade position must be finite"));
        }

        let cell = snap_cell(world_x, world_z);
        let before = self.walls.len();
        self.walls.retain(|wall| {
            wall.id < BUILT_WALL_ID_BASE || super::world_to_cell(wall.position) != cell
        });
        if self.walls.len() == before {
            return Err(JsValue::from_str(
                "there is no built barricade in that cell",
            ));
        }

        self.invalidate_navigation();
        self.refresh_collision_metrics();
        self.snapshot_json()
    }
}

impl ZombieArena3dWorld {
    fn next_barricade_id(&self) -> u32 {
        self.walls
            .iter()
            .filter(|wall| wall.id >= BUILT_WALL_ID_BASE)
            .map(|wall| wall.id)
            .max()
            .unwrap_or(BUILT_WALL_ID_BASE - 1)
            .saturating_add(1)
    }

    pub(crate) fn invalidate_navigation(&mut self) {
        self.flow_field = None;
        for zombie in &mut self.zombies {
            zombie.path.clear();
            zombie.path_cursor = 0;
            zombie.path_goal = None;
            zombie.next_replan_frame = 0;
        }
    }
}

fn snap_cell(world_x: f32, world_z: f32) -> Cell {
    Cell {
        x: (world_x / NAV_CELL)
            .round()
            .clamp(NAV_MIN as f32, NAV_MAX as f32) as i32,
        z: (world_z / NAV_CELL)
            .round()
            .clamp(NAV_MIN as f32, NAV_MAX as f32) as i32,
    }
}

fn cell_center(cell: Cell) -> [f32; 3] {
    [
        cell.x as f32 * NAV_CELL,
        BARRICADE_HALF[1],
        cell.z as f32 * NAV_CELL,
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Algorithm, blocked_navigation_cells};

    #[test]
    fn deterministic_astar_routes_through_the_only_gap() {
        let blocked = (-3..=3)
            .filter(|z| *z != 2)
            .map(|z| Cell { x: 0, z })
            .collect::<BTreeSet<_>>();

        let search = astar(Cell { x: -3, z: 0 }, Cell { x: 3, z: 0 }, &blocked, -4, 4)
            .expect("path should exist");

        assert_eq!(search.path.first(), Some(&Cell { x: -3, z: 0 }));
        assert_eq!(search.path.last(), Some(&Cell { x: 3, z: 0 }));
        assert!(search.path.iter().all(|cell| !blocked.contains(cell)));
        assert!(search.path.len() >= 3, "the wall should force a detour");
    }

    #[test]
    fn deterministic_tie_break_is_stable() {
        let blocked = BTreeSet::new();
        let first = astar(Cell { x: 0, z: 0 }, Cell { x: 2, z: 2 }, &blocked, -4, 4)
            .expect("path should exist");
        let second = astar(Cell { x: 0, z: 0 }, Cell { x: 2, z: 2 }, &blocked, -4, 4)
            .expect("path should exist");
        assert_eq!(first.path, second.path);
    }

    #[test]
    fn open_grid_path_is_smoothed_to_endpoints() {
        let search = astar(
            Cell { x: -4, z: -3 },
            Cell { x: 4, z: 3 },
            &BTreeSet::new(),
            -5,
            5,
        )
        .expect("path should exist");
        assert_eq!(
            search.path,
            vec![Cell { x: -4, z: -3 }, Cell { x: 4, z: 3 }]
        );
    }

    #[test]
    fn smoothing_does_not_cut_blocked_corners() {
        let blocked = [Cell { x: 1, z: 0 }, Cell { x: 0, z: 1 }]
            .into_iter()
            .collect::<BTreeSet<_>>();
        assert!(!line_of_sight(
            Cell { x: 0, z: 0 },
            Cell { x: 1, z: 1 },
            &blocked
        ));
    }

    #[test]
    fn astar_reports_no_path_when_goal_is_sealed() {
        let blocked = [
            Cell { x: 0, z: 1 },
            Cell { x: 1, z: 0 },
            Cell { x: 0, z: -1 },
            Cell { x: -1, z: 0 },
        ]
        .into_iter()
        .collect::<BTreeSet<_>>();
        assert!(astar(Cell { x: 0, z: 0 }, Cell { x: 2, z: 2 }, &blocked, -3, 3).is_none());
    }

    #[test]
    fn runtime_barricade_is_destructible_and_updates_navigation() {
        let mut world = ZombieArena3dWorld::new_inner(Algorithm::UniformGrid, 41);
        world.zombies.clear();
        let target = Cell { x: 8, z: 8 };
        assert!(!blocked_navigation_cells(&world.walls).contains(&target));

        world
            .build_json(target.x as f32, target.z as f32)
            .expect("free cell should accept a barricade");
        let built = world
            .walls
            .iter()
            .find(|wall| wall.id >= BUILT_WALL_ID_BASE)
            .expect("built wall should exist");
        assert!(built.destructible);
        assert_eq!(built.health, BARRICADE_HEALTH);
        assert!(blocked_navigation_cells(&world.walls).contains(&target));

        world
            .remove_barricade_json(target.x as f32, target.z as f32)
            .expect("built barricade should be removable");
        assert!(!blocked_navigation_cells(&world.walls).contains(&target));
    }
}
