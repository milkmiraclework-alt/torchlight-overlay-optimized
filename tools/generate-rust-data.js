#!/usr/bin/env node
/* Keep measured strategy data shared with the reference/UI implementation. */
'use strict';
const fs = require('node:fs'), path = require('node:path');
const S = require('../js/solver.js'), combos = require('../js/tool-combos.js').single;
const file = path.resolve(__dirname, '../native/tartarus/data/policy.json');
const bytes = JSON.stringify({ defaults: S.DEFAULTS, profiles: S.PROFILES, combos }) + '\n';
if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') !== bytes) fs.writeFileSync(file, bytes);
console.log('Rust strategy data matches the reference weights and measured instrument sets.');
