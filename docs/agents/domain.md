# Domain Docs: Multi-Context Layout

This is a **monorepo** with shared concerns across multiple packages. Domain knowledge is split:

- **Root `CONTEXT.md`**: Shared architecture, dev setup, monorepo workspace layout
- **Per-package `CONTEXT.md`**: Package-specific context, dependencies, internal design

## Reading `CONTEXT.md` Files

**Agent behavior**:
- When an agent is asked about or needs to modify code in `client/`, `server/`, or `shared/`, it reads the corresponding package's `CONTEXT.md`
- When the agent asks cross-cutting questions, it reads the root `CONTEXT.md`
- An agent always reads the file that best matches its current scope; it never reads all of them in parallel

**Consumer** (agent or human reading a `CONTEXT.md`):
- Each file is **standalone**: write it so a reader can understand the package without reading others
- Link between contexts with `[[CONTEXT.md]]` and `[[../CONTEXT.md]]` where useful
- Avoid forward-references; assume readers have no context outside this file

## File Structure

```
.
├── CONTEXT.md                 # Root: shared architecture, dev setup, workspace
├── docs/
│   └── agents/
│       ├── issue-tracker.md
│       ├── triage-labels.md
│       └── domain.md          # (this file)
├── client/
│   └── CONTEXT.md             # Client-specific: PixiJS, rendering, UI
├── server/
│   └── CONTEXT.md             # Server-specific: Colyseus, game logic, networking
└── shared/
    └── CONTEXT.md             # Shared: physics, types, utilities
```

## Next Steps

1. **Root `CONTEXT.md`**: Write shared architecture, monorepo setup, and dev workflow
2. **Package `CONTEXT.md` files**: Write package-specific context
3. **Architecture Decision Records (ADRs)**: Store in `docs/adr/` and link from CONTEXT.md files

See the templates in the `mattpocock-skills` documentation for CONTEXT.md structure and ADR format.
