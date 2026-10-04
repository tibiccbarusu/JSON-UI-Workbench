'use strict';
// This deliberately uses old CommonJS syntax, so an old installed Node can
// report its incompatibility before the ESM launcher is parsed.
var parts = process.versions.node.split('.').map(Number);
var supported = parts[0] > 22 || (parts[0] === 22 && parts[1] >= 14);
process.exitCode = supported ? 0 : 42;
