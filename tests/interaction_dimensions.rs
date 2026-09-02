use collision_lab::{Config, InteractionConfig, MotionConfig, Scenario, Simulation};

#[test]
fn changing_sensor_density_does_not_change_motion_or_geometry() {
    let config = Config {
        objects: 128,
        seed: 0x5E45_0F5E,
        scenario: Scenario::Clustered,
        ..Config::default()
    };
    let motion = MotionConfig {
        dynamic_fraction: 0.55,
        speed: 7.5,
    };

    let no_sensors = Simulation::new(
        config,
        motion,
        InteractionConfig {
            sensor_fraction: 0.0,
        },
    );
    let all_sensors = Simulation::new(
        config,
        motion,
        InteractionConfig {
            sensor_fraction: 1.0,
        },
    );

    assert_eq!(no_sensors.entities().len(), all_sensors.entities().len());
    for (solid, sensor) in no_sensors.entities().iter().zip(all_sensors.entities()) {
        assert_eq!(solid.body, sensor.body);
        assert_eq!(solid.motion, sensor.motion);
        assert_eq!(solid.layer, sensor.layer);
        assert_eq!(solid.velocity, sensor.velocity);
        assert_ne!(solid.interaction, sensor.interaction);
    }
}

#[test]
fn sensor_assignment_remains_stable_while_simulation_advances() {
    let config = Config {
        objects: 96,
        seed: 2026,
        scenario: Scenario::Uniform,
        ..Config::default()
    };
    let mut simulation = Simulation::new(
        config,
        MotionConfig::default(),
        InteractionConfig {
            sensor_fraction: 0.4,
        },
    );
    let interaction_kinds: Vec<_> = simulation
        .entities()
        .iter()
        .map(|entity| entity.interaction)
        .collect();

    for _ in 0..60 {
        simulation.step(1.0 / 30.0);
    }

    let after: Vec<_> = simulation
        .entities()
        .iter()
        .map(|entity| entity.interaction)
        .collect();
    assert_eq!(after, interaction_kinds);
}
