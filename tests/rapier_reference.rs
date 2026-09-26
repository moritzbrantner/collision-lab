#[path = "../benches/support/rapier.rs"]
mod rapier_reference;

use collision_lab::{Algorithm, Config, Scenario, generate_scene, run_algorithm};

#[test]
fn rapier_matches_naive_for_collision_lab_scenarios() {
    for scenario in [Scenario::Uniform, Scenario::Clustered] {
        let config = Config {
            objects: 256,
            seed: 42,
            scenario,
            ..Config::default()
        };
        let bodies = generate_scene(config);
        let expected = run_algorithm(Algorithm::Naive, config, &bodies).pairs;
        let actual = rapier_reference::detect_pairs(rapier_reference::prepare_scene(&bodies));

        assert_eq!(
            actual,
            expected,
            "Rapier pair set diverged for scenario {}",
            scenario.as_str()
        );
    }
}
