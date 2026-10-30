# NGNE Tilemap Editor — Docs

A browser tile map builder for NGNE games, the second tool of the NGNE editor suite after
ngne-sprite-editor.

| Doc | Role | Read when |
| --- | --- | --- |
| [BRIEF.md](BRIEF.md) | Product: scope, v1 features, project/tileset/export model, generated runtime, TMJ import, decisions | First, always |
| [SUITE.md](SUITE.md) | Identity, design system, layout, stack (exact versions), architecture, packaging, repo conventions | Scaffolding, any UI or config work |
| [ENGINE.md](ENGINE.md) | NGNE 0.3.0 APIs and rules, viewport architecture, game preview, budgets, spikes, engine gaps | Any `src/engine/` or performance work |
| [SPEC.md](SPEC.md) | Behaviour and architecture: model, undo, tools, terrain, tilesets, layers, markers, properties, persistence, export, runtime API, preview, TMJ import, quality | Any feature work |
| [DESIGN.md](DESIGN.md) | Interface deltas from the sprite editor; components reused from it, file by file; menus, tools, panels, dialogs, shortcut table | Any UI work, scaffold |
| [FORMAT.md](FORMAT.md) | `.ngtilemap` project, `ngne-tilemap` v1, tileset atlases, export folder; cell flags and tile placement; the sprite-editor and Tiled inputs it reads | Any file, import, export, runtime or rendering work |
| [reference/tiled.md](reference/tiled.md) | Tiled 1.12.2 model, tools, terrain algorithm, TMJ format, from source | Tools, terrain, import |
| [tickets/README.md](tickets/README.md) | Milestones, ticket index, estimates, owner checks, measurements, parallel work; one file per ticket | Before and during any implementation |

To be written: `GUIDE.md` (TE-067). Spike measurements: [ENGINE.md](ENGINE.md) §6, raw data
in [evidence/](evidence/).

Working rules: [../RULES.md](../RULES.md); for agents on a ticket, [../AGENTS.md](../AGENTS.md).
If two docs disagree, BRIEF.md wins.

External references:

- ngne-sprite-editor 1.0.0: `..\ngne-sprite-editor` (design, code and packaging to copy).
- NGNE 0.3.0: `..\ngne` at tag `v0.3.0`;
  [contracts](https://github.com/that-webdev-dude/ngne/tree/v0.3.0/docs/contracts),
  [guide](https://github.com/that-webdev-dude/ngne/blob/v0.3.0/docs/guide.md).
- Tiled: [github.com/mapeditor/tiled](https://github.com/mapeditor/tiled),
  [doc.mapeditor.org](https://doc.mapeditor.org/en/stable/).
