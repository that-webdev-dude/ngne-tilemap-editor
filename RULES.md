# Rules

Binding for every implementer (human or agent). Docs index: [docs/README.md](docs/README.md).

## Code

4. Layer boundaries: `src/core` imports no DOM global, React or `@ngne/core`; only
   `src/engine` imports `@ngne/core`; `src/ui` changes documents only through registered
   commands.
5. Dependencies are exactly those of [docs/SUITE.md](docs/SUITE.md) §5, pinned exactly.
   Anything else needs an owner decision.
6. A feature registers through its registry (commands/keymap/menu, dock, overlay, tools,
   context bar) without editing shared files.
7. Done = every acceptance item backed by a named test or a recorded measurement, and
   `npm run check` plus the E2E specs of the touched area pass. Never weaken, skip or delete a
   test to get there.
8. Performance numbers that decide anything come from reference hardware
   ([docs/ENGINE.md](docs/ENGINE.md) §6). SwiftShader/CI numbers are report-only.
