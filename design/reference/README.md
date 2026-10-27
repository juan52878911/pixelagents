# Reference code

Files from the original [pixelagents](https://github.com/YehudaLevi/pixelagents) (MIT) that are worth porting:

- `hooks-config.ts` — merge/unmerge hook entries into a Claude Code `settings.json` with a marker and a backup.
- `tail.ts` — follow a file across appends, truncation and rotation.
- `emit.js` — the original hook emitter (privacy rules, ≤120-char details, always exit 0).
