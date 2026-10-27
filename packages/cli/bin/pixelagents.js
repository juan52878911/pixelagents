#!/usr/bin/env node
// Entry point of the published `pixelagents` package: runs the bundle in dist/.
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

import(pathToFileURL(join(__dirname, '..', 'dist', 'cli.js')).href)
  .then((m) => m.main(process.argv.slice(2)))
  .then((code) => {
    if (typeof code === 'number') process.exitCode = code;
  })
  .catch((e) => {
    console.error(`pixelagents: ${e && e.message ? e.message : e}`);
    process.exitCode = 1;
  });
