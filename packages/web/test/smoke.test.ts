import { describe, expect, it } from 'vitest';
import { defineClientPlugin } from '../src/plugin-api.js';
describe('web', () => { it('exposes the plugin api', () => { expect(defineClientPlugin({ name: 'x' }).name).toBe('x'); }); });
