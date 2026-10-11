//! Multi-scale operation work evidence for shared flow-field navigation.
//!
//! These tests feed the navigation `operations` in
//! `.performance/contract.json` through `scripts/collect-work-evidence.sh`.
//! They vary only the number of agents; the arena grid, its topology and the
//! goal stay fixed, except in the explicit change case. Each frame is checked
//! against an independent breadth-first oracle before any counter is
//! recorded, and the counters are the existing deterministic frame metrics
//! (`flow_field_builds`, `flow_field_expanded`, `flow_field_followers`).
//!
//! When `COLLISION_LAB_WORK_EVIDENCE_DIR` is set, the tests write
//! `<operation>.json` fragments and leave the declared bounds to
//! `coding-tooling performance work`. Without it, they assert the same bounds
//! themselves, so plain `cargo test` fails when the shared field is rebuilt
//! per agent.

use std::collections::{BTreeMap, BTreeSet, VecDeque};

use super::{
    Algorithm, Cell, NAV_MAX, NAV_MIN, NavigationMode, PLAYER_HALF, ZombieArena3dWorld,
    cell_to_world, world_to_cell,
};

/// One scale point: `(dimensions, metrics)` as `(name, value)` pairs.
type WorkSample = (Vec<(&'static str, u64)>, Vec<(&'static str, u64)>);

/// Agent counts at each scale point; grid, topology and goal stay fixed.
const AGENTS: [u64; 7] = [1, 2, 4, 8, 16, 32, 64];
/// Frames simulated after each preparation or change.
const FRAMES: u64 = 20;
/// Seed of the existing browser navigation comparison scenario.
const SEED: u64 = 5_904_189;
/// Navigation cells in the fixed arena grid: one full expansion at most.
const GRID_CELLS: u64 = ((NAV_MAX - NAV_MIN + 1) * (NAV_MAX - NAV_MIN + 1)) as u64;

fn work_evidence_dir() -> Option<std::path::PathBuf> {
    std::env::var_os("COLLISION_LAB_WORK_EVIDENCE_DIR").map(Into::into)
}

fn write_work_evidence(dir: &std::path::Path, operation: &str, samples: &[WorkSample]) {
    fn fields(pairs: &[(&str, u64)]) -> String {
        pairs
            .iter()
            .map(|(name, value)| format!("\"{name}\":{value}"))
            .collect::<Vec<_>>()
            .join(",")
    }
    let samples = samples
        .iter()
        .map(|(dimensions, metrics)| {
            format!(
                "{{\"dimensions\":{{{}}},\"metrics\":{{{}}}}}",
                fields(dimensions),
                fields(metrics)
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    std::fs::write(
        dir.join(format!("{operation}.json")),
        format!("{{\"id\":\"{operation}\",\"samples\":[{samples}]}}\n"),
    )
    .expect("work evidence directory must be writable");
}

fn metric(sample: &WorkSample, name: &str) -> u64 {
    sample
        .1
        .iter()
        .find(|(metric, _)| *metric == name)
        .map(|(_, value)| *value)
        .unwrap_or_else(|| panic!("sample is missing metric {name}"))
}

/// Independent breadth-first distances to `goal` over the same 4-connected
/// grid rules the flow field documents (goal may be blocked, other blocked
/// cells are impassable).
fn oracle_distances(goal: Cell, blocked: &BTreeSet<Cell>) -> BTreeMap<Cell, u32> {
    let mut distances = BTreeMap::from([(goal, 0_u32)]);
    let mut frontier = VecDeque::from([goal]);
    while let Some(cell) = frontier.pop_front() {
        let distance = distances[&cell];
        for (dx, dz) in [(-1, 0), (1, 0), (0, -1), (0, 1)] {
            let next = Cell {
                x: cell.x + dx,
                z: cell.z + dz,
            };
            let inside =
                (NAV_MIN..=NAV_MAX).contains(&next.x) && (NAV_MIN..=NAV_MAX).contains(&next.z);
            if inside && !blocked.contains(&next) && !distances.contains_key(&next) {
                distances.insert(next, distance + 1);
                frontier.push_back(next);
            }
        }
    }
    distances
}

/// Work counted over one `step_zombies` call.
#[derive(Default)]
struct FrameWork {
    builds: u64,
    expanded: u64,
    followers: u64,
}

impl FrameWork {
    fn add(&mut self, other: Self) {
        self.builds += other.builds;
        self.expanded += other.expanded;
        self.followers += other.followers;
    }
}

/// Runs one zombie-navigation frame and checks every agent's flow-field
/// target against the oracle before returning the frame's counters.
fn checked_frame(world: &mut ZombieArena3dWorld) -> FrameWork {
    world.metrics.flow_field_builds = 0;
    world.metrics.flow_field_expanded = 0;
    world.metrics.flow_field_followers = 0;
    world.step_zombies();

    let goal = world_to_cell(world.player.position);
    let oracle = oracle_distances(goal, &world.blocked_navigation);
    let field = world
        .flow_field
        .as_ref()
        .expect("flow-field mode keeps a field");
    assert_eq!(field.goal, goal, "the field must target the current goal");
    assert_eq!(field.reachable_cells(), oracle.len());
    if world.metrics.flow_field_builds > 0 {
        assert_eq!(
            world.metrics.flow_field_expanded,
            oracle.len() as u64,
            "one build expands every reachable cell exactly once"
        );
    }

    let agents = world.zombies.len();
    assert_eq!(world.zombie_position_scratch.len(), agents);
    assert_eq!(world.flow_target_scratch.len(), agents);
    for (position, target) in world
        .zombie_position_scratch
        .iter()
        .zip(&world.flow_target_scratch)
    {
        let cell = world_to_cell(*position);
        let distance = *oracle
            .get(&cell)
            .unwrap_or_else(|| panic!("agent cell {cell:?} must be reachable"));
        let target = target.unwrap_or_else(|| panic!("agent at {cell:?} must follow the field"));
        if distance == 0 {
            assert_eq!(target, world.player.position);
        } else {
            let next = world_to_cell(target);
            assert_eq!(target, cell_to_world(next));
            assert_eq!(cell.x.abs_diff(next.x) + cell.z.abs_diff(next.z), 1);
            assert_eq!(
                oracle.get(&next),
                Some(&(distance - 1)),
                "agent at {cell:?} must descend the oracle distance"
            );
        }
    }

    FrameWork {
        builds: world.metrics.flow_field_builds,
        expanded: world.metrics.flow_field_expanded,
        followers: world.metrics.flow_field_followers,
    }
}

fn run_frames(world: &mut ZombieArena3dWorld, frames: u64) -> FrameWork {
    let mut work = FrameWork::default();
    for _ in 0..frames {
        work.add(checked_frame(world));
    }
    work
}

/// Flow-field world with exactly `agents` zombies, no prepared field yet.
fn world_with_agents(agents: u64) -> ZombieArena3dWorld {
    let mut world = ZombieArena3dWorld::new_inner(Algorithm::UniformGrid, SEED);
    world.zombies.clear();
    for _ in 0..agents {
        world.spawn_zombie();
    }
    world.navigation_mode = NavigationMode::FlowField;
    world.invalidate_navigation();
    assert!(world.flow_field.is_none());
    world
}

#[test]
fn shared_flow_field_builds_once_regardless_of_agent_count() {
    let samples: Vec<WorkSample> = AGENTS
        .into_iter()
        .map(|agents| {
            let mut world = world_with_agents(agents);
            let builds_before = world.flow_field_builds_total;
            // Preparation frame plus FRAMES frames at a fixed goal.
            let work = run_frames(&mut world, 1 + FRAMES);
            assert_eq!(
                world.flow_field_builds_total - builds_before,
                work.builds,
                "per-frame build metric must agree with the cumulative counter"
            );
            (
                vec![("agents", agents)],
                vec![
                    ("planning-builds", work.builds),
                    ("expanded-cells", work.expanded),
                    ("follow-lookups", work.followers),
                ],
            )
        })
        .collect();

    if let Some(dir) = work_evidence_dir() {
        write_work_evidence(&dir, "shared-flow-field-fixed-goal", &samples);
        return;
    }
    // Keep these in sync with .performance/contract.json.
    let expanded = metric(&samples[0], "expanded-cells");
    for sample in &samples {
        let agents = sample.0[0].1;
        assert_eq!(metric(sample, "planning-builds"), 1, "{agents} agents");
        assert_eq!(
            metric(sample, "expanded-cells"),
            expanded,
            "{agents} agents"
        );
        assert!(metric(sample, "expanded-cells") <= GRID_CELLS);
        assert_eq!(
            metric(sample, "follow-lookups"),
            agents * (1 + FRAMES),
            "every agent follows the shared field once per frame"
        );
    }
}

#[test]
fn topology_or_goal_change_rebuilds_the_shared_field_exactly_once() {
    let samples: Vec<WorkSample> = AGENTS
        .into_iter()
        .map(|agents| {
            let mut world = world_with_agents(agents);
            run_frames(&mut world, 1 + FRAMES);

            // Topology change: one runtime barricade on an open cell inside the
            // prepared field.
            let barricade = Cell { x: 9, z: -9 };
            assert!(!world.blocked_navigation.contains(&barricade));
            world
                .build_json(barricade.x as f32, barricade.z as f32)
                .expect("the barricade cell must be free");
            assert!(world.blocked_navigation.contains(&barricade));
            assert!(
                world.flow_field.is_none(),
                "topology change invalidates the field"
            );
            let topology = run_frames(&mut world, FRAMES);

            // Goal change: the player moves to another open cell.
            let goal = Cell { x: -9, z: 9 };
            assert!(!world.blocked_navigation.contains(&goal));
            world.player.position = [goal.x as f32, PLAYER_HALF[1], goal.z as f32];
            assert_eq!(world_to_cell(world.player.position), goal);
            let goal_change = run_frames(&mut world, FRAMES);

            (
                vec![("agents", agents)],
                vec![
                    ("topology-change-builds", topology.builds),
                    ("topology-change-expanded-cells", topology.expanded),
                    ("goal-change-builds", goal_change.builds),
                    ("goal-change-expanded-cells", goal_change.expanded),
                ],
            )
        })
        .collect();

    // A stale field would fail the oracle checks above, so at least one
    // rebuild per change is part of correctness, not of the work bound.
    for sample in &samples {
        assert!(metric(sample, "topology-change-builds") >= 1);
        assert!(metric(sample, "goal-change-builds") >= 1);
    }

    if let Some(dir) = work_evidence_dir() {
        write_work_evidence(&dir, "shared-flow-field-change-rebuild", &samples);
        return;
    }
    // Keep these in sync with .performance/contract.json.
    for sample in &samples {
        let agents = sample.0[0].1;
        assert_eq!(
            metric(sample, "topology-change-builds"),
            1,
            "{agents} agents"
        );
        assert_eq!(metric(sample, "goal-change-builds"), 1, "{agents} agents");
        for name in [
            "topology-change-expanded-cells",
            "goal-change-expanded-cells",
        ] {
            assert_eq!(
                metric(sample, name),
                metric(&samples[0], name),
                "{agents} agents"
            );
            assert!(metric(sample, name) <= GRID_CELLS);
        }
    }
}
