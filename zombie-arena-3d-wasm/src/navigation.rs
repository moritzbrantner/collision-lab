use std::{
    cmp::Ordering,
    collections::{BTreeMap, BTreeSet, BinaryHeap},
};

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
        // BinaryHeap is a max-heap. Reverse every comparison so the smallest
        // f/h/cell tuple is popped first. The final cell tie-break makes A*
        // fully deterministic across native and WASM builds.
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

    let start_h = manhattan(start, goal);
    open.push(OpenNode {
        cell: start,
        g: 0,
        h: start_h,
    });
    best_g.insert(start, 0_u32);

    while let Some(current) = open.pop() {
        if current.cell == goal {
            return Some(PathSearch {
                path: reconstruct_path(start, goal, &came_from),
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
            let should_update = best_g.get(&neighbor).is_none_or(|known| next_g < *known);
            if !should_update {
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

#[cfg(test)]
mod tests {
    use super::*;

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
        assert!(search.path.contains(&Cell { x: 0, z: 2 }));
        assert!(search.path.iter().all(|cell| !blocked.contains(cell)));
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
}
