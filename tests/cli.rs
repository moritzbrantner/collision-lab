use std::process::Command;

const CUSTOM_RUN: &[&str] = &[
    "--objects",
    "64",
    "--cell-size",
    "3.25",
    "--seed",
    "123",
    "--world-extent",
    "17.5",
    "--half-extent",
    "0.75",
    "--scenario",
    "clustered",
];

fn run_custom_experiment() -> String {
    let output = Command::new(env!("CARGO_BIN_EXE_collision-lab"))
        .args(CUSTOM_RUN)
        .output()
        .expect("collision-lab binary should run");

    assert!(
        output.status.success(),
        "collision-lab failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).expect("collision-lab stdout should be UTF-8")
}

fn deterministic_header(output: &str) -> Vec<&str> {
    output.lines().take_while(|line| !line.is_empty()).collect()
}

#[test]
fn custom_run_reports_reproducible_scene_and_pair_parity() {
    let first = run_custom_experiment();
    let second = run_custom_experiment();

    assert_eq!(deterministic_header(&first), deterministic_header(&second));

    for expected in [
        "scenario:       clustered",
        "objects:        64",
        "cell size:      3.250",
        "world extent:   17.500",
        "half extent:    0.750",
        "seed:           123",
    ] {
        assert!(
            first.lines().any(|line| line == expected),
            "missing {expected}"
        );
    }

    assert!(first.contains("pair-set parity:       verified"));
    assert!(second.contains("pair-set parity:       verified"));
}
