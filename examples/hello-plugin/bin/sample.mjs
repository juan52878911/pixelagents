#!/usr/bin/env node
// Example data source for the hello plugin: prints the state of a few fake jobs as ONE JSON array.
// A `poll` input runs it every few seconds and hands the whole output to the `hello` adapter.
const t = Math.floor(Date.now() / 1000);
const jobs = [
  { name: 'build', host: 'ci-1', progress: (t * 7) % 101 },
  { name: 'deploy', host: 'ci-1', progress: (t * 3) % 101 },
  { name: 'backup', host: 'nas', progress: (t * 5) % 101 },
];
for (const j of jobs) j.state = j.progress >= 100 ? 'done' : j.progress === 0 ? 'queued' : 'running';
console.log(JSON.stringify(jobs));
