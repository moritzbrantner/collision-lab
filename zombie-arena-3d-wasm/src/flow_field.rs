use std::collections::{BTreeSet, VecDeque};

use crate::navigation::{Cell, GridBounds, neighbors};

const UNREACHED: u32 = u32::MAX;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct FlowField {
    pub(crate) goal: Cell,
    bounds: GridBounds,
    distances: Vec<u32>,
    pub(crate) expanded: u32,
}

impl FlowField {
    pub(crate) fn build(
        goal: Cell,
        blocked: &BTreeSet<Cell>,
        min_cell: i32,
        max_cell: i32,
    ) -> Self {
        let bounds = GridBounds::new(min_cell, max_cell);
        let mut distances = vec![UNREACHED; bounds.cell_count()];
        let mut frontier = VecDeque::new();
        // Callers clamp the goal to the grid.
        let goal_index = bounds
            .index(goal)
            .expect("flow-field goal must lie inside the grid");
        distances[goal_index] = 0;
        frontier.push_back((goal, 0_u32));
        let mut expanded = 0_u32;

        while let Some((cell, distance)) = frontier.pop_front() {
            expanded = expanded.saturating_add(1);
            for neighbor in neighbors(cell) {
                let Some(index) = bounds.index(neighbor) else {
                    continue;
                };
                if distances[index] != UNREACHED
                    || (neighbor != goal && blocked.contains(&neighbor))
                {
                    continue;
                }
                let next = distance.saturating_add(1);
                distances[index] = next;
                frontier.push_back((neighbor, next));
            }
        }

        Self {
            goal,
            bounds,
            distances,
            expanded,
        }
    }

    fn distance(&self, cell: Cell) -> Option<u32> {
        self.bounds
            .index(cell)
            .map(|index| self.distances[index])
            .filter(|distance| *distance != UNREACHED)
    }

    pub(crate) fn next_cell(&self, current: Cell) -> Option<Cell> {
        let current_distance = self.distance(current)?;
        if current_distance == 0 {
            return Some(current);
        }

        neighbors(current)
            .into_iter()
            .filter_map(|neighbor| {
                self.distance(neighbor)
                    .filter(|distance| *distance < current_distance)
                    .map(|distance| (distance, neighbor))
            })
            .min()
            .map(|(_, cell)| cell)
    }

    pub(crate) fn reachable_cells(&self) -> usize {
        // The search expands each reachable cell exactly once.
        self.expanded as usize
    }
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
