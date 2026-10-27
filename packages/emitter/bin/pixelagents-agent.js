#!/usr/bin/env node
// `pixelagents-agent ...` is `pixelagents agent ...`
process.argv.splice(2, 0, 'agent');
require('./pixelagents.js');
