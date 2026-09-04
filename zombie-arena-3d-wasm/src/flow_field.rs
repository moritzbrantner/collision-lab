use std::collections::{BTreeMap, BTreeSet, VecDeque};

use crate::navigation::Cell;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct FlowField {
    pub(crate) goal: Cell,
    distances: BTreeMap<Cell, u32>,
    pub(crate) expanded: u32,
}

impl FlowField {
    pub(crate) fn build(
        goal: Cell,
        blocked: &BTreeSet<Cell>,
        min_cell: i32,
        max_cell: i32,
    ) -> Self {
        let mut distances = BTreeMap::new();
        let mut frontier = VecDeque::new();
        distances.insert(goal, 0_u32);
        frontier.push_back(goal);
        let mut expanded = 0_u32;

        while let Some(cell) = frontier.pop_front() {
            expanded = expanded.saturating_add(1);
            let distance = distances[&cell];
            for neighbor in neighbors(cell) {
                if neighbor.x < min_cell
                    || neighbor.x > max_cell
                    || neighbor.z < min_cell
                    || neighbor.z > max_cell
                    || (neighbor != goal && blocked.contains(&neighbor))
                    || distances.contains_key(&neighbor)
                {
                    continue;
                }
                distances.insert(neighbor, distance.saturating_add(1));
                frontier.push_back(neighbor);
            }
        }

        Self {
            goal,
            distances,
            expanded,
        }
    }

    pub(crate) fn next_cell(&self, current: Cell) -> Option<Cell> {
        let current_distance = self.distances.get(&current).copied()?;
        if current_distance == 0 {
            return Some(current);
        }

        neighbors(current)
            .into_iter()
            .filter_map(|neighbor| {
                self.distances
                    .get(&neighbor)
                    .copied()
                    .filter(|distance| *distance < current_distance)
                    .map(|distance| (distance, neighbor))
            })
            .min()
            .map(|(_, cell)| cell)
    }

    pub(crate) fn reachable_cells(&self) -> usize {
        self.distances.len()
    }
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
    fn field_routes_every_reachable_cell_toward_goal() {
        let field = FlowField::build(Cell { x: 2, z: 2 }, &BTreeSet::new(), -3, 3);
        let mut current = Cell { x: -2, z: -1 };
        let mut steps = 0;
        while current != field.goal {
            current = field.next_cell(current).expect("cell should be reachable");
            steps += 1;
            assert!(steps < 20);
        }
        assert_eq!(steps, 7);
    }

    #[test]
    fn field_respects_blocked_wall_and_unreachable_region() {
        let blocked = (-2..=2).map(|z| Cell { x: 0, z }).collect::<BTreeSet<_>>();
        let field = FlowField::build(Cell { x: 2, z: 0 }, &blocked, -2, 2);
        assert!(field.next_cell(Cell { x: -2, z: 0 }).is_none());
        assert!(field.next_cell(Cell { x: 1, z: 0 }).is_some());
    }

    #[test]
    fn equal_cost_ties_use_stable_cell_order() {
        let field = FlowField::build(Cell { x: 2, z: 2 }, &BTreeSet::new(), -3, 3);
        assert_eq!(
            field.next_cell(Cell { x: 0, z: 0 }),
            Some(Cell { x: 0, z: 1 })
        );
    }
}
