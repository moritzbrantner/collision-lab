#[path = "../wasm/src/presets.rs"]
mod presets;

use presets::ScenePreset;

#[test]
fn preset_metadata_and_motion_contract_are_complete() {
    for preset in ScenePreset::ALL {
        assert_eq!(ScenePreset::parse(preset.as_str()), Ok(preset));
        assert!(!preset.title().is_empty());
        assert!(!preset.description().is_empty());

        let config = preset.config(64);
        assert_eq!(config.scene.objects, 64);
        assert_eq!(config.motion.dynamic_fraction, 0.0);
        assert_eq!(config.motion.speed, 0.0);
        assert_eq!(config.interaction.sensor_fraction, 0.0);
    }
}
