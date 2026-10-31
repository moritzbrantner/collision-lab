use serde_json::json;

use crate::flow_field::FlowField;
use crate::navigation::cell_to_world;
use crate::{
    BULLET_RADIUS, FIXED_DT, NAV_CELL, PLAYER_HALF, PLAYER_ID, PLAYER_MAX_HEALTH, WORLD_HALF,
    ZOMBIE_HALF, ZOMBIE_MAX_HEALTH, ZombieArena3dWorld,
};

impl ZombieArena3dWorld {
    pub(crate) fn snapshot(&self) -> Result<String, serde_json::Error> {
        let paths = self
            .zombies
            .iter()
            .map(|zombie| {
                let waypoints = zombie
                    .path
                    .iter()
                    .skip(zombie.path_cursor.min(zombie.path.len()))
                    .copied()
                    .map(cell_to_world)
                    .collect::<Vec<_>>();
                json!({
                    "zombieId": zombie.id,
                    "waypoints": waypoints,
                })
            })
            .collect::<Vec<_>>();

        let value = json!({
            "frame": self.frame,
            "algorithm": self.algorithm.as_str(),
            "navigationMode": self.navigation_mode.as_str(),
            "worldHalf": WORLD_HALF,
            "fixedDt": FIXED_DT,
            "navCell": NAV_CELL,
            "player": {
                "id": PLAYER_ID,
                "position": self.player.position,
                "velocity": self.player.velocity,
                "half": PLAYER_HALF,
                "aim": self.player.aim,
                "health": self.player.health,
                "maxHealth": PLAYER_MAX_HEALTH,
                "grounded": self.player.grounded,
            },
            "zombies": self.zombies.iter().map(|zombie| json!({
                "id": zombie.id,
                "position": zombie.position,
                "half": ZOMBIE_HALF,
                "health": zombie.health,
                "maxHealth": ZOMBIE_MAX_HEALTH,
            })).collect::<Vec<_>>(),
            "walls": self.walls.iter().map(|wall| json!({
                "id": wall.id,
                "position": wall.position,
                "half": wall.half,
                "low": wall.low,
                "health": wall.health,
                "maxHealth": wall.max_health,
                "destructible": wall.destructible,
            })).collect::<Vec<_>>(),
            "bullets": self.bullets.iter().map(|bullet| json!({
                "id": bullet.id,
                "position": bullet.position,
                "previousPosition": bullet.previous_position,
                "radius": BULLET_RADIUS,
            })).collect::<Vec<_>>(),
            "debug": {
                "overlapPairs": self.metrics.overlap_pairs.iter().map(|pair| [pair.a, pair.b]).collect::<Vec<_>>(),
                "sweeps": self.sweeps.iter().map(|sweep| json!({
                    "from": sweep.from,
                    "to": sweep.to,
                    "hit": sweep.hit,
                    "hitKind": sweep.hit_kind,
                })).collect::<Vec<_>>(),
                "navigation": {
                    "blocked": self.blocked_navigation.iter().map(|cell| [cell.x, cell.z]).collect::<Vec<_>>(),
                    "paths": paths,
                    "flowFieldReachable": self.flow_field.as_ref().map_or(0, FlowField::reachable_cells),
                },
            },
            "stats": {
                "zombies": self.zombies.len(),
                "walls": self.walls.len(),
                "builtBarricades": self.walls.iter().filter(|wall| wall.destructible).count(),
                "bullets": self.bullets.len(),
                "kills": self.kills,
                "shots": self.shots,
                "jumps": self.jumps,
                "possiblePairs": self.metrics.possible_pairs,
                "aabbTests": self.metrics.aabb_tests,
                "occupiedCells": self.metrics.occupied_cells,
                "overlaps": self.metrics.overlaps,
                "ccdTests": self.metrics.ccd_tests,
                "ccdHits": self.metrics.ccd_hits,
                "pathReplans": self.metrics.path_replans,
                "pathFound": self.metrics.path_found,
                "pathExpanded": self.metrics.path_expanded,
                "pathReplansTotal": self.path_replans_total,
                "pathExpandedTotal": self.path_expanded_total,
                "destroyedBarricades": self.metrics.destroyed_barricades,
                "destroyedBarricadesTotal": self.destroyed_barricades_total,
                "steeringAdjustments": self.metrics.steering_adjustments,
                "flowFieldBuilds": self.metrics.flow_field_builds,
                "flowFieldExpanded": self.metrics.flow_field_expanded,
                "flowFieldFollowers": self.metrics.flow_field_followers,
                "flowFieldBuildsTotal": self.flow_field_builds_total,
                "navigationCacheRebuildsTotal": self.navigation_cache_rebuilds_total,
            },
            "gameOver": self.game_over,
        });
        serde_json::to_string(&value)
    }
}
