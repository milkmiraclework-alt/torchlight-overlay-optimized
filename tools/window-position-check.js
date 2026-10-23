'use strict';
const assert = require('node:assert/strict'), { centered } = require('../desktop/lib/window-position.js');
for (const area of [{ x: 0, y: 0, width: 2560, height: 1392 }, { x: -1920, y: 0, width: 1920, height: 1032 }, { x: 0, y: 0, width: 800, height: 560 }]) {
  const result = centered({ x: -1308, y: -500, width: 1287, height: 907 }, area);
  assert.ok(result.x >= area.x && result.y >= area.y);
  assert.ok(result.x + result.width <= area.x + area.width && result.y + result.height <= area.y + area.height);
  assert.ok(Math.abs(result.x + result.width / 2 - area.x - area.width / 2) <= 0.5);
  assert.ok(Math.abs(result.y + result.height / 2 - area.y - area.height / 2) <= 0.5);
}
console.log('PASS: instrument windows recover from stale/negative bounds, fit small displays and center on either game monitor.');
