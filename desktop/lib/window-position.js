'use strict';
// Put the entire correction window inside the display used by the game.
function centered(bounds, area) {
  const width = Math.max(1, Math.min(bounds.width, area.width - Math.min(32, area.width - 1)));
  const height = Math.max(1, Math.min(bounds.height, area.height - Math.min(32, area.height - 1)));
  return { x: Math.round(area.x + (area.width - width) / 2), y: Math.round(area.y + (area.height - height) / 2), width, height };
}
module.exports = { centered };
