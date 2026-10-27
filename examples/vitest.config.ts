// Tests of the examples. The root vitest config does not include `examples/` (see docs/plugins.md).
// Run: npx vitest run --config examples/vitest.config.ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  root: new URL('..', import.meta.url).pathname,
  test: { include: ['examples/*/test/**/*.test.ts'], environment: 'node' },
});
