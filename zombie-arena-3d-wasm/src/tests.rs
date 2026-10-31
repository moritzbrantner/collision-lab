use super::*;

#[test]
fn world_starts_with_real_3d_state_and_paths() {
    let world = ZombieArena3dWorld::new_inner(Algorithm::UniformGrid, 42);
    assert_eq!(world.player.position[1], PLAYER_HALF[1]);
    assert_eq!(world.zombies.len(), INITIAL_ZOMBIES);
    assert!(world.zombies.iter().all(|zombie| !zombie.path.is_empty()));
}

#[test]
fn jump_changes_vertical_state_deterministically() {
    let mut world = ZombieArena3dWorld::new_inner(Algorithm::Naive, 7);
    let before = world.player.position[1];
    world.step([0.0, 0.0], [0.0, 0.0, -1.0], true, false);
    assert!(world.player.position[1] > before);
    assert!(world.player.velocity[1] > 0.0);
    assert!(!world.player.grounded);
}

#[test]
fn bullet_sweep_hits_a_box_in_three_dimensions() {
    let target = Aabb::from_center_half_extents([2.0, 1.0, 0.0], [0.5, 0.5, 0.5]);
    let hit = segment_aabb_toi([0.0, 1.0, 0.0], [4.0, 1.0, 0.0], target, 0.05);
    assert!(hit.is_some());
    let miss = segment_aabb_toi([0.0, 3.0, 0.0], [4.0, 3.0, 0.0], target, 0.05);
    assert!(miss.is_none());
}

#[test]
fn low_obstacle_can_support_player_above_ground() {
    let low = wall(999, [0.0, 0.45, 0.0], [1.0, 0.45, 1.0], true);
    let position = [0.0, 0.9 + PLAYER_HALF[1], 0.0];
    assert!(is_supported(position, PLAYER_HALF, &[low]));
}

#[test]
fn local_separation_pushes_neighbors_apart_symmetrically() {
    let positions = [[0.0, ZOMBIE_HALF[1], 0.0], [0.8, ZOMBIE_HALF[1], 0.0]];
    let left = local_separation(0, &positions);
    let right = local_separation(1, &positions);
    assert!(left[0] < 0.0);
    assert!(right[0] > 0.0);
    assert!((left[0] + right[0]).abs() < 1.0e-6);
}

#[test]
fn zombie_damage_destroys_runtime_barricade_and_invalidates_paths() {
    let mut world = ZombieArena3dWorld::new_inner(Algorithm::UniformGrid, 91);
    world.zombies.clear();
    world
        .build_json(8.0, 8.0)
        .expect("free cell should accept barricade");
    world.zombies.push(Zombie {
        id: 9_001,
        position: [7.05, ZOMBIE_HALF[1], 8.0],
        health: ZOMBIE_MAX_HEALTH,
        path: vec![Cell { x: 7, z: 8 }, Cell { x: 8, z: 8 }],
        path_cursor: 1,
        path_goal: Some(Cell { x: 8, z: 8 }),
        next_replan_frame: 999,
    });

    for _ in 0..240 {
        world.attack_barricades();
        if !world.walls.iter().any(|wall| wall.destructible) {
            break;
        }
    }

    assert!(!world.walls.iter().any(|wall| wall.destructible));
    assert_eq!(world.destroyed_barricades_total, 1);
    assert!(world.zombies[0].path.is_empty());
    assert_eq!(world.zombies[0].next_replan_frame, 0);
}

#[test]
fn flow_field_cache_rebuilds_only_when_invalidated() {
    let mut world = ZombieArena3dWorld::new_inner(Algorithm::UniformGrid, 77);
    world.navigation_mode = NavigationMode::FlowField;
    world.invalidate_navigation();

    world.step_zombies();
    assert_eq!(world.flow_field_builds_total, 1);
    assert!(world.flow_field.is_some());
    world.step_zombies();
    assert_eq!(world.flow_field_builds_total, 1);

    world.invalidate_navigation();
    assert!(world.flow_field.is_none());
    world.step_zombies();
    assert_eq!(world.flow_field_builds_total, 2);
}

#[test]
fn navigation_cache_and_scratch_buffers_are_reused_without_topology_changes() {
    let mut world = ZombieArena3dWorld::new_inner(Algorithm::UniformGrid, 123);
    let rebuilds = world.navigation_cache_rebuilds_total;

    world.step_zombies();
    let position_ptr = world.zombie_position_scratch.as_ptr();
    let position_capacity = world.zombie_position_scratch.capacity();
    let _ = world.snapshot().expect("snapshot should serialize");

    world.step_zombies();
    let _ = world.snapshot().expect("snapshot should serialize");

    assert_eq!(world.navigation_cache_rebuilds_total, rebuilds);
    assert_eq!(world.zombie_position_scratch.as_ptr(), position_ptr);
    assert_eq!(world.zombie_position_scratch.capacity(), position_capacity);
}

#[test]
fn astar_accepts_blocked_start_and_goal_without_copying_obstacles() {
    let start = Cell { x: -2, z: 0 };
    let goal = Cell { x: 2, z: 0 };
    let blocked = [start, goal].into_iter().collect::<BTreeSet<_>>();
    let search = astar(start, goal, &blocked, -4, 4).expect("path should exist");

    assert_eq!(search.path.first(), Some(&start));
    assert_eq!(search.path.last(), Some(&goal));
}

#[test]
fn runtime_buffers_reuse_capacity_after_warmup() {
    let mut world = ZombieArena3dWorld::new_inner(Algorithm::UniformGrid, 321);
    world
        .build_json(8.0, 8.0)
        .expect("free cell should accept a barricade");
    world.fire();
    world.step_bullets();
    world.resolve_actor_overlaps();
    world.attack_barricades();
    world.refresh_collision_metrics();

    let body_capacity = world.collision_body_scratch.capacity();
    let damage_capacity = world.barricade_damage_scratch.capacity();
    let mut bullet_capacities = [
        world.bullets.capacity(),
        world.bullet_survivor_scratch.capacity(),
    ];
    bullet_capacities.sort_unstable();

    world.step_bullets();
    world.resolve_actor_overlaps();
    world.attack_barricades();
    world.refresh_collision_metrics();

    let mut next_bullet_capacities = [
        world.bullets.capacity(),
        world.bullet_survivor_scratch.capacity(),
    ];
    next_bullet_capacities.sort_unstable();

    assert!(body_capacity > 0);
    assert!(damage_capacity >= world.walls.len());
    assert!(bullet_capacities[1] > 0);
    assert_eq!(world.collision_body_scratch.capacity(), body_capacity);
    assert_eq!(world.barricade_damage_scratch.capacity(), damage_capacity);
    assert_eq!(next_bullet_capacities, bullet_capacities);
}

#[test]
fn zombie_id_lookup_remains_correct_with_gaps() {
    let mut world = ZombieArena3dWorld::new_inner(Algorithm::UniformGrid, 456);
    let removed_id = world.zombies[3].id;
    let retained_id = world.zombies[4].id;
    world.zombies.retain(|zombie| zombie.id != removed_id);

    assert!(world.zombies.windows(2).all(|pair| pair[0].id < pair[1].id));
    assert_eq!(world.zombie_index(removed_id), None);
    let expected = world
        .zombies
        .iter()
        .position(|zombie| zombie.id == retained_id)
        .expect("retained zombie should exist");
    assert_eq!(world.zombie_index(retained_id), Some(expected));
}
