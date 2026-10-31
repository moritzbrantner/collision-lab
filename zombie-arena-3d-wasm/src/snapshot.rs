use std::io::Write;

use crate::flow_field::FlowField;
use crate::navigation::{Cell, cell_to_world};
use crate::{
    BULLET_RADIUS, FIXED_DT, NAV_CELL, PLAYER_HALF, PLAYER_ID, PLAYER_MAX_HEALTH, WORLD_HALF,
    ZOMBIE_HALF, ZOMBIE_MAX_HEALTH, ZombieArena3dWorld,
};

/// Appends JSON directly, because the snapshot is serialized on every frame.
///
/// Output matches `serde_json::Value` serialization byte for byte: object keys
/// are written in sorted order and `f32` values are widened to `f64`. The
/// `snapshot_json_keeps_sorted_keys_and_valid_structure` test guards the key order.
struct JsonWriter {
    out: Vec<u8>,
}

impl JsonWriter {
    fn raw(&mut self, text: &str) {
        self.out.extend_from_slice(text.as_bytes());
    }

    fn int(&mut self, value: impl std::fmt::Display) {
        write!(self.out, "{value}").expect("writing to a Vec cannot fail");
    }

    fn float(&mut self, value: f32) {
        serde_json::to_writer(&mut self.out, &f64::from(value))
            .expect("writing a number to a Vec cannot fail");
    }

    fn boolean(&mut self, value: bool) {
        self.raw(if value { "true" } else { "false" });
    }

    fn vec3(&mut self, value: [f32; 3]) {
        self.raw("[");
        self.float(value[0]);
        self.raw(",");
        self.float(value[1]);
        self.raw(",");
        self.float(value[2]);
        self.raw("]");
    }

    fn list<T>(&mut self, items: impl IntoIterator<Item = T>, mut item: impl FnMut(&mut Self, T)) {
        self.raw("[");
        for (index, value) in items.into_iter().enumerate() {
            if index > 0 {
                self.raw(",");
            }
            item(self, value);
        }
        self.raw("]");
    }
}

impl ZombieArena3dWorld {
    pub(crate) fn snapshot(&self) -> Result<String, serde_json::Error> {
        let mut json = JsonWriter {
            out: Vec::with_capacity(self.snapshot_capacity_hint()),
        };

        json.raw("{\"algorithm\":\"");
        json.raw(self.algorithm.as_str());
        json.raw("\",\"bullets\":");
        json.list(&self.bullets, |json, bullet| {
            json.raw("{\"id\":");
            json.int(bullet.id);
            json.raw(",\"position\":");
            json.vec3(bullet.position);
            json.raw(",\"previousPosition\":");
            json.vec3(bullet.previous_position);
            json.raw(",\"radius\":");
            json.float(BULLET_RADIUS);
            json.raw("}");
        });

        json.raw(",\"debug\":{\"navigation\":{\"blocked\":");
        json.list(&self.blocked_navigation, write_cell);
        json.raw(",\"flowFieldReachable\":");
        json.int(
            self.flow_field
                .as_ref()
                .map_or(0, FlowField::reachable_cells),
        );
        json.raw(",\"paths\":");
        json.list(&self.zombies, |json, zombie| {
            let remaining = zombie.path_cursor.min(zombie.path.len());
            json.raw("{\"waypoints\":");
            json.list(&zombie.path[remaining..], |json, cell| {
                json.vec3(cell_to_world(*cell));
            });
            json.raw(",\"zombieId\":");
            json.int(zombie.id);
            json.raw("}");
        });
        json.raw("},\"overlapPairs\":");
        json.list(&self.metrics.overlap_pairs, |json, pair| {
            json.raw("[");
            json.int(pair.a);
            json.raw(",");
            json.int(pair.b);
            json.raw("]");
        });
        json.raw(",\"sweeps\":");
        json.list(&self.sweeps, |json, sweep| {
            json.raw("{\"from\":");
            json.vec3(sweep.from);
            json.raw(",\"hit\":");
            match sweep.hit {
                Some(hit) => json.vec3(hit),
                None => json.raw("null"),
            }
            json.raw(",\"hitKind\":");
            match sweep.hit_kind {
                Some(kind) => {
                    json.raw("\"");
                    json.raw(kind);
                    json.raw("\"");
                }
                None => json.raw("null"),
            }
            json.raw(",\"to\":");
            json.vec3(sweep.to);
            json.raw("}");
        });

        json.raw("},\"fixedDt\":");
        json.float(FIXED_DT);
        json.raw(",\"frame\":");
        json.int(self.frame);
        json.raw(",\"gameOver\":");
        json.boolean(self.game_over);
        json.raw(",\"navCell\":");
        json.float(NAV_CELL);
        json.raw(",\"navigationMode\":\"");
        json.raw(self.navigation_mode.as_str());

        json.raw("\",\"player\":{\"aim\":");
        json.vec3(self.player.aim);
        json.raw(",\"grounded\":");
        json.boolean(self.player.grounded);
        json.raw(",\"half\":");
        json.vec3(PLAYER_HALF);
        json.raw(",\"health\":");
        json.float(self.player.health);
        json.raw(",\"id\":");
        json.int(PLAYER_ID);
        json.raw(",\"maxHealth\":");
        json.float(PLAYER_MAX_HEALTH);
        json.raw(",\"position\":");
        json.vec3(self.player.position);
        json.raw(",\"velocity\":");
        json.vec3(self.player.velocity);

        json.raw("},\"stats\":{");
        let stats = self.sorted_stats();
        for (index, (name, value)) in stats.into_iter().enumerate() {
            if index > 0 {
                json.raw(",");
            }
            json.raw("\"");
            json.raw(name);
            json.raw("\":");
            json.int(value);
        }

        json.raw("},\"walls\":");
        json.list(&self.walls, |json, wall| {
            json.raw("{\"destructible\":");
            json.boolean(wall.destructible);
            json.raw(",\"half\":");
            json.vec3(wall.half);
            json.raw(",\"health\":");
            json.float(wall.health);
            json.raw(",\"id\":");
            json.int(wall.id);
            json.raw(",\"low\":");
            json.boolean(wall.low);
            json.raw(",\"maxHealth\":");
            json.float(wall.max_health);
            json.raw(",\"position\":");
            json.vec3(wall.position);
            json.raw("}");
        });
        json.raw(",\"worldHalf\":");
        json.float(WORLD_HALF);
        json.raw(",\"zombies\":");
        json.list(&self.zombies, |json, zombie| {
            json.raw("{\"half\":");
            json.vec3(ZOMBIE_HALF);
            json.raw(",\"health\":");
            json.float(zombie.health);
            json.raw(",\"id\":");
            json.int(zombie.id);
            json.raw(",\"maxHealth\":");
            json.float(ZOMBIE_MAX_HEALTH);
            json.raw(",\"position\":");
            json.vec3(zombie.position);
            json.raw("}");
        });
        json.raw("}");

        Ok(String::from_utf8(json.out).expect("the writer only emits ASCII"))
    }

    /// Generous size estimate that avoids repeated growth while writing.
    fn snapshot_capacity_hint(&self) -> usize {
        let waypoints: usize = self.zombies.iter().map(|zombie| zombie.path.len()).sum();
        2_048
            + self.bullets.len() * 192
            + self.blocked_navigation.len() * 10
            + self.zombies.len() * 256
            + waypoints * 64
            + self.metrics.overlap_pairs.len() * 16
            + self.sweeps.len() * 256
            + self.walls.len() * 192
    }

    /// Stats in key order. `usize` counts widen losslessly to `u64`.
    fn sorted_stats(&self) -> [(&'static str, u64); 26] {
        let metrics = &self.metrics;
        let built_barricades = self.walls.iter().filter(|wall| wall.destructible).count();
        [
            ("aabbTests", metrics.aabb_tests),
            ("builtBarricades", built_barricades as u64),
            ("bullets", self.bullets.len() as u64),
            ("ccdHits", metrics.ccd_hits),
            ("ccdTests", metrics.ccd_tests),
            ("destroyedBarricades", metrics.destroyed_barricades),
            ("destroyedBarricadesTotal", self.destroyed_barricades_total),
            ("flowFieldBuilds", metrics.flow_field_builds),
            ("flowFieldBuildsTotal", self.flow_field_builds_total),
            ("flowFieldExpanded", metrics.flow_field_expanded),
            ("flowFieldFollowers", metrics.flow_field_followers),
            ("jumps", u64::from(self.jumps)),
            ("kills", u64::from(self.kills)),
            (
                "navigationCacheRebuildsTotal",
                self.navigation_cache_rebuilds_total,
            ),
            ("occupiedCells", metrics.occupied_cells as u64),
            ("overlaps", metrics.overlaps as u64),
            ("pathExpanded", metrics.path_expanded),
            ("pathExpandedTotal", self.path_expanded_total),
            ("pathFound", metrics.path_found),
            ("pathReplans", metrics.path_replans),
            ("pathReplansTotal", self.path_replans_total),
            ("possiblePairs", metrics.possible_pairs),
            ("shots", u64::from(self.shots)),
            ("steeringAdjustments", metrics.steering_adjustments),
            ("walls", self.walls.len() as u64),
            ("zombies", self.zombies.len() as u64),
        ]
    }
}

fn write_cell(json: &mut JsonWriter, cell: &Cell) {
    json.raw("[");
    json.int(cell.x);
    json.raw(",");
    json.int(cell.z);
    json.raw("]");
}
