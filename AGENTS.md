# AGENTS.md — node-build-stream

Guidance for coding agents working in this repository. The single-load reference for
the public API surface is [docs/api.md](./docs/api.md); the AI-oriented index is
[llms.txt](./llms.txt). Read those before touching `src/`.

## Verification (run all, in order, at repo root)

```sh
npm test          # node --test + coverage; target >= 95% line coverage per file
npm run lint      # eslint .
npm run typecheck # strict checkJs over src/
npm run build:types   # regenerate types/*.d.ts from the JSDoc source of truth
```

Do not consider a change complete until all four are green.

## Hard rules (do not re-litigate)

- **Zero runtime dependencies** in the main package — everything is `node:` built-ins.
  The only optional run-time reach is the consumer project's own `vinyl` package.
- **Types are JSDoc + generated.** NEVER hand-edit `types/*.d.ts`; edit the JSDoc in
  `src/`, then run `npm run build:types`. Watch strict-checkJs failures (implicit-any on
  helper params, missing `@this {Transform}` on standalone transform callbacks).
- **Tests:** small per-module files under `test/` (`node --test`). No monolith test files.
- **Docs stay current in the same pass as code.** Any public-surface change must also
  update: named exports AND the default `nodeBuild` object in `src/index.js`,
  `docs/api.md` (entry table + section), the relevant `docs/*.md` guide, the README
  quick map/guide table, `llms.txt`, and regenerated types.
- **Do not touch `bench/`** or its CI gate unless a change affects the webapp pipeline
  being benched.

## Gotchas (learned the hard way)

- Glob `base` semantics: a wildcard-FREE pattern like `src/css/b.css` derives base as
  the file's own directory and lands FLAT in dest (gulp/vinyl-fs behavior). Only
  wildcarded patterns keep subfolder structure. See `deriveBase()` in `src/glob.js`
  and `docs/glob.md`. Don't "fix" tests to expect nesting for static patterns.
- `readable.pipe(dest)` auto-calls `dest.end()` when the source ends — this is why
  gulp's `.pipe(merge(srcB))` idiom cannot work on Node. `merge(...streams)` here is
  direct-call only: `pipeline(merge(srcA, srcB), dest('dist'))`. Locked design; see
  `docs/streams.md`.
- Writables don't track deferred callbacks — `dest()` serializes writes through a
  promise chain and defers `final()` until all settle. Don't "simplify" that away or
  `await pipeline(src(...), dest(...))` will resolve while writes are in flight.
- Shells outside the repo (e.g. `/tmp`) may default to an older Node via nvm; this
  package requires Node >= 24. Use `nvm use 24` before manual smoke tests elsewhere.
- eslint enforces single quotes in test files — build throwaway build-file sources with
  escaped single quotes, not double-quoted strings.

## Conventions

- JSDoc + typedef style "all the way down" everywhere TS tooling is involved.
- Commit messages: `@<version> - <summary>`.
- Long multi-session work keeps a resume packet in `tmp/`; refresh it at each staging point.
