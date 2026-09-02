use collision_lab::{Config, InteractionConfig, MotionConfig, Scenario};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ScenePreset {
    BaselineUniform,
    Clustered,
    Sparse,
    BadGrid,
    EverythingOverlaps,
}

impl ScenePreset {
    pub const ALL: [Self; 5] = [
        Self::BaselineUniform,
        Self::Clustered,
        Self::Sparse,
        Self::BadGrid,
        Self::EverythingOverlaps,
    ];

    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "baseline-uniform" => Ok(Self::BaselineUniform),
            "clustered" => Ok(Self::Clustered),
            "sparse" => Ok(Self::Sparse),
            "bad-grid" => Ok(Self::BadGrid),
            "everything-overlaps" => Ok(Self::EverythingOverlaps),
            other => Err(format!("unknown scene preset `{other}`")),
        }
    }

    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::BaselineUniform => "baseline-uniform",
            Self::Clustered => "clustered",
            Self::Sparse => "sparse",
            Self::BadGrid => "bad-grid",
            Self::EverythingOverlaps => "everything-overlaps",
        }
    }

    #[must_use]
    pub const fn title(self) -> &'static str {
        match self {
            Self::BaselineUniform => "Baseline uniform",
            Self::Clustered => "Clustered neighborhoods",
            Self::Sparse => "Very sparse world",
            Self::BadGrid => "Oversized grid cells",
            Self::EverythingOverlaps => "Everything overlaps",
        }
    }

    #[must_use]
    pub const fn description(self) -> &'static str {
        match self {
            Self::BaselineUniform => {
                "A roughly constant-density uniform world. This is the neutral reference workload."
            }
            Self::Clustered => {
                "Bodies concentrate into eight neighborhoods, increasing local candidate density without changing the basic object scale."
            }
            Self::Sparse => {
                "The same object scale is spread through a much larger world, rewarding algorithms that cheaply reject distant objects."
            }
            Self::BadGrid => {
                "The world is ordinary, but the uniform-grid cell size is deliberately far too large, collapsing many bodies into the same few buckets."
            }
            Self::EverythingOverlaps => {
                "Every generated AABB is identical. There is no spatial structure to exploit, so every unique object pair is genuinely relevant."
            }
        }
    }

    #[must_use]
    pub fn config(self, objects: usize) -> PresetConfig {
        let objects = objects.max(1);
        let density_scale = ((objects as f32) / 50.0).cbrt();
        let baseline_extent = 12.0 * density_scale;

        let scene = match self {
            Self::BaselineUniform => Config {
                objects,
                cell_size: 4.0,
                fat_margin: 1.5,
                seed: 42,
                world_extent: baseline_extent,
                half_extent: 0.6,
                scenario: Scenario::Uniform,
            },
            Self::Clustered => Config {
                objects,
                cell_size: 4.0,
                fat_margin: 1.5,
                seed: 43,
                world_extent: baseline_extent,
                half_extent: 0.6,
                scenario: Scenario::Clustered,
            },
            Self::Sparse => Config {
                objects,
                cell_size: 4.0,
                fat_margin: 1.5,
                seed: 44,
                world_extent: 36.0 * density_scale,
                half_extent: 0.6,
                scenario: Scenario::Uniform,
            },
            Self::BadGrid => Config {
                objects,
                cell_size: baseline_extent * 8.0,
                fat_margin: 1.5,
                seed: 45,
                world_extent: baseline_extent,
                half_extent: 0.6,
                scenario: Scenario::Uniform,
            },
            Self::EverythingOverlaps => Config {
                objects,
                cell_size: 4.0,
                fat_margin: 1.5,
                seed: 46,
                world_extent: 1.0,
                half_extent: 1.0,
                scenario: Scenario::Uniform,
            },
        }
        .validate()
        .expect("named preset must always create a valid scene configuration");

        PresetConfig {
            scene,
            motion: MotionConfig {
                dynamic_fraction: 0.0,
                speed: 0.0,
            },
            interaction: InteractionConfig {
                sensor_fraction: 0.0,
            },
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct PresetConfig {
    pub scene: Config,
    pub motion: MotionConfig,
    pub interaction: InteractionConfig,
}

#[cfg(test)]
mod tests {
    use super::ScenePreset;
    use collision_lab::{Algorithm, generate_scene, run_algorithm};

    #[test]
    fn every_named_preset_is_deterministic_and_pair_exact() {
        for preset in ScenePreset::ALL {
            let config = preset.config(96).scene;
            let left = generate_scene(config);
            let right = generate_scene(config);
            assert_eq!(left, right, "preset {}", preset.as_str());

            let expected = run_algorithm(Algorithm::Naive, config, &left).pairs;
            for algorithm in Algorithm::ALL.into_iter().skip(1) {
                assert_eq!(
                    run_algorithm(algorithm, config, &left).pairs,
                    expected,
                    "preset {} algorithm {algorithm:?}",
                    preset.as_str(),
                );
            }
        }
    }

    #[test]
    fn everything_overlaps_reaches_the_true_quadratic_case() {
        let config = ScenePreset::EverythingOverlaps.config(32).scene;
        let bodies = generate_scene(config);
        let result = run_algorithm(Algorithm::Naive, config, &bodies);
        assert_eq!(result.pairs.len(), 32 * 31 / 2);
        assert_eq!(result.stats.aabb_tests as usize, result.pairs.len());
    }

    #[test]
    fn bad_grid_uses_a_deliberately_oversized_cell() {
        let config = ScenePreset::BadGrid.config(100).scene;
        assert!(config.cell_size > config.world_extent * 2.0);
    }

    #[test]
    fn sparse_world_is_much_larger_than_baseline_at_same_count() {
        let baseline = ScenePreset::BaselineUniform.config(100).scene;
        let sparse = ScenePreset::Sparse.config(100).scene;
        assert!(sparse.world_extent >= baseline.world_extent * 2.9);
        assert_eq!(sparse.half_extent, baseline.half_extent);
    }
}
