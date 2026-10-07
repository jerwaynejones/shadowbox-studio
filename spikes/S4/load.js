// spikes/S4/load.js — load real js/util.js + js/hash.js, the S4 CRC shim and the SBPng prototype into Node's global.
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
globalThis.crypto ??= require("crypto").webcrypto;
const root = path.join(__dirname, "..", "..");
for (const f of ["js/util.js", "js/hash.js", "spikes/S4/util_crc32.js", "spikes/S4/png.js"])
  vm.runInThisContext(fs.readFileSync(path.join(root, f), "utf8"), { filename: f });
module.exports = { root };
