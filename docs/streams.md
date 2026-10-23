# Streams: src, dest & through

This is the heart of node-build-stream (and of Gulp). A build is a **pipeline**: files
flow in from disk, pass through one or more transforms, and flow out to disk.
The core functions:

```js
src(patterns)  ──▶  through(fn)  ──▶  dest(dir)
 (read files)      (transform each)   (write files)
```

You connect them with the standard Node `.pipe()` method, exactly like Gulp.
When several file sets must flow into one pipeline, `merge()` combines them.

## `src(patterns, opts?)` — read files in

`src()` globs your project and returns a **readable stream of File objects** —
one object per matched file, each carrying its contents (see
[The File object](./file.md) for the anatomy).

```js
import { src } from 'node-build-stream';

const stream = src('src/**/*.css');   // matches every css under src/
for await (const file of stream) {
  console.log(file.relative, file.contents.length);  // "css/app.css 1234"
}
```

Options (`opts`):

| Option          | Meaning                                                                 |
| --------------- | ----------------------------------------------------------------------- |
| `cwd`           | Directory patterns resolve against (default: current working directory). |
| `base`          | Override the derived "base" folder used to compute `file.relative`.     |
| `encoding`      | If set, contents arrive as **strings** of that encoding; otherwise as **Buffers** (the default, matching Gulp). |

Patterns accept everything described in [Globbing](./glob.md): `*`, `**`, `?`,
braces `{a,b}`, and negation with a leading `!`. Pass an array for multiple
patterns.

> **Empty-match warning.** If a *positive* pattern matches no files, `src()`
> prints a one-line warning to the console (e.g. `node-build-stream: src() matched no
> files for pattern(s): src/**/*.html`) so a typo'd path is visible instead of
> silently producing an empty build. The readable is empty and completes
> normally; a downstream `dest()` may not create its directory because no
> writes occur. A negation-only pattern list does not warn.

### Why "base" matters

Gulp plugins compute output paths from `file.relative` (the path *inside* the
matched folder). node-build-stream derives each file's base from the static
part of the concrete pattern that matched it: `src/**/*.css` → base is `src/`,
so a file's relative path is `app.css`. Different patterns in the same `src()`
call can produce files with different bases. If you need exact control, pass
`{ base: 'some/dir' }` to override all of them.

### Reading from and writing back to the same directory

`src()` resolves and sorts its matching paths before it starts yielding files.
Writing new paths into that directory during the same pipeline does not add
those paths to the already-resolved source list. File contents, however, are
read as each file is emitted, not all eagerly at match time. Avoid overwriting
a source path that has not yet been read: a prior destination write could
change the bytes the later source item reads. When a transform renames or
fingerprints files in place, ensure it does not overwrite pending inputs, or
write to a separate destination and clean up after the source has been consumed.

## `dest(dir, opts?)` — write files out

`dest()` returns a **writable stream**. For each File it writes to
`path.join(dir, file.relative)`, creating parent directories as needed. It
handles Buffer contents, string contents, and even files whose contents are
themselves streams (it pipes them through).

```js
import { src, dest } from 'node-build-stream';

src('src/**/*.{html,css}').pipe(dest('dist'));
// dist/ now mirrors the folder layout under your matched base.
```

After writing, node-build-stream updates `file.path` to the final on-disk location, so
downstream transforms can see where a file landed.

## `merge(...streams)` — combine several streams into one

When two or more independent file sets must share a downstream pipeline (one
common transform, one output directory), `merge()` combines them into a single
stream — the fan-in shape Gulp builds use constantly. Pass **every** source to
the call:

```js
import { src, through, dest, merge, pipeline } from 'node-build-stream';

await pipeline(
  merge(src('src/legacy/**/*.css'), src('src/css/**/*.css')),
  through(minify),               // one transform for both file sets
  dest('dist'),                  // one output tree
);
```

> **Translating gulp's `.pipe(merge(...))` idiom.** Gulp lets you write
> `srcA.pipe(merge(srcB)).pipe(dest)`. Node's `.pipe()` cannot express that —
> it ends its destination as soon as the source finishes, so a mid-chain merge
> would truncate the pipeline. The node-build-stream form is
> `pipeline(merge(srcA, srcB), dest)`; the result is a plain readable, so you
> can also start a classic chain from it: `merge(a, b).pipe(dest('dist'))`.

Files are consumed **in the order the streams were given** — each source is
fully drained before the next starts, and order within a source is preserved.
Backpressure is respected end to end, so a slow downstream transform cannot
cause unbounded buffering.

`merge()` accepts any object-mode readable of File objects — `src()` results,
other merges, or hand-built `Readable`s — and returns a new readable. An error
on any source ends the merged stream with that error (rejecting a wrapping
`pipeline()`), and passing anything that is not a readable (or no streams at
all) throws a clear `TypeError` immediately, before any I/O.

## `prefixDest(prefix)` — nest files under a subfolder of dest

When several file sets share one output directory (`merge()` + one `dest()`),
files from different matched bases land flat under the dest root and can
collide. `prefixDest()` is the built-in "two globs into one dest, keep the
subfolders" idiom: it rewrites each file's path so it lands at
`dest/<prefix>/<original relative>`.

```js
import { src, dest, merge, prefixDest, pipeline } from 'node-build-stream';

await pipeline(
  merge(
    src('src/styles/**/*.css').pipe(prefixDest('css')),
    src('src/imgs/**/*.{png,svg}').pipe(prefixDest('img')),
  ),
  dest('dist'),
);
// dist/css/… and dist/img/… — no hand-mutated through() needed.
```

- The prefix is applied **relative to `file.base`**: it sits between the
  matched base and the file's relative layout, so subfolder structure under
  the base is preserved. Multi-segment prefixes like `'nested/deep'` work too.
- Files are mutated in place (the same object flows downstream with its new
  `path`); contents — including streamed contents — pass through untouched,
  so it composes cleanly with `dest()` and any other transform.
- A prefix that normalizes to nothing (`''`, `'.'`) is a no-op pass-through;
  leading/trailing slashes are ignored.
- **throws** `TypeError` immediately when the argument is not a string.

## `clean(patterns, opts?)` — delete files and directories

`clean()` is node-build-stream's dependency-free `gulp-clean`. It resolves your patterns
and removes the matches from disk. Use it to wipe an output directory at the start
of a build:

```js
import { clean } from 'node-build-stream';

await clean('dist');            // remove the whole dist/ folder (recursive)
await clean(['dist/**', '!dist/keep.txt']);   // globs + negation, same syntax as src()
```

Two kinds of input are accepted and can be mixed:

- **glob patterns** — match individual *files* (same syntax as `src()`, including
  `!` negation);
- **literal paths** — a plain directory or file name with no glob characters is
  removed directly. This is the common `clean('dist')` case, since a bare
  directory name matches no files on its own.

Directories are removed recursively. Non-existent targets are ignored, so
`clean()` is safe to call unconditionally (idempotent). It resolves to an array of
the absolute paths actually removed (empty when nothing matched).

```js
import { task, clean } from 'node-build-stream';
task('clean', async () => { await clean('dist'); });   // run as a normal task
```

<a id="watch"></a>
## `watch(globs, taskName?, opts?)` — re-run on file changes

`watch()` is node-build-stream's dependency-free `gulp-watch`. It runs your task once,
then keeps watching the given globs and re-runs the task (debounced) whenever a
matching file is added, removed, or edited.

```js
import { watch } from 'node-build-stream';

const handle = await watch('src/**', 'build', { debounceMs: 100 });
// … later, when you're done (e.g. in a CLI signal handler):
await handle.close();
```

- **`globs`** — pattern(s) that trigger the re-run; negation supported, same syntax as `src()`.
- **`taskName`** — the registered task to run. Omit it to run your default (the
  `seriesDefault()` task, else all tasks in parallel).
- **`opts`**
  - `cwd` — directory patterns resolve against and the root of the recursive watcher (default `process.cwd()`).
  - `debounceMs` — quiet window before a re-run (default `100`). Bursts coalesce into one run.
  - `onRun(reason)` — called before each run; `reason` is `'start'` for the initial build, `'event'` after.
  - `onError(err)` — called when a re-run rejects; watching continues.

The returned **handle** has `close()` (stop and release the watcher) and a live
`running` flag. Runs are serialized: an event that arrives mid-run coalesces into
a single follow-up run, so you never get overlapping builds. The initial run's
failures go through `onError` like any other, so a broken build still arms the
watcher.

Under the hood it uses one recursive `fs.watch`, so any number of globs costs a
single native watcher. See [the CLI's Watching section](./cli.md#watching) for how
this maps to `node-build-stream --watch` and how it differs from Node's own `--watch`.

## `through(fn, stage?)` — transform files in memory

`through()` is how you write **your own** build step without any plugin and
without subclassing anything. It returns a transform stream that calls `fn(file)`
for each File. What you do with the result decides what happens:

| `fn` returns…      | Effect                                          |
| ------------------ | ----------------------------------------------- |
| the (mutated) file | The same file continues downstream, modified.   |
| a **new** File     | The new file is pushed downstream instead.      |
| `null`/`undefined` | The file is **dropped** from the pipeline.      |
| an **array** of Files | Each one is pushed (one input → many outputs). |

> **Output validation.** Every value you push (directly or in an array) must be a
> File-like object — i.e. it has a string `path`. If your function returns anything
> else, `through()` throws a clear error (`through() expected a File …`) instead of
> failing later and more obscurely at `dest()`. Returning `null`/`undefined` to drop
> a file is always allowed.

When porting a revision pipeline, remember that asset references may be
embedded inside JavaScript or CSS bundles (for example, dynamic-import chunk
names), not just in HTML. A rewrite stage may need to update emitted bundle
contents after fingerprinting. Verify output contents as well as filenames
against a known-good build; use whole-name boundaries so a manifest key does
not corrupt a longer filename that contains the same text.

Async functions are supported, so you can `await` real work per file:

```js
import { src, dest, through } from 'node-build-stream';

src('src/**/*.html')
  .pipe(through(async (file) => {
    // Rewrite a marker in each HTML file.
    const html = file.contents.toString('utf8');
    file.contents = Buffer.from(html.replace(/TODO:/g, 'NOTE:'));
    return file;                     // mutate-in-place style
  }))
  .pipe(dest('dist'));
```

Dropping files (e.g. only keep HTML):

```js
src('src/**/*.{html,css}')
  .pipe(through((file) => file.relative.endsWith('.html') ? file : null))
  .pipe(dest('dist'));
```

Fan-out (one source → many outputs):

```js
src('src/template.txt')
  .pipe(through((file) => [
    file.clone({ path: 'out/a.txt', base: 'out' }),   // relative: a.txt
    file.clone({ path: 'out/b.txt', base: 'out' }),   // relative: b.txt
  ]))
  .pipe(dest('dist'));                       // writes dist/a.txt and dist/b.txt
```

### The `stage` label (optional second argument)

The second argument is an optional string that names this step in error messages — give each transform a real name so failures point at the right stage:

```js
src('src/**/*.css')
  .pipe(through(minify, 'minify'))
  .pipe(through(injectHashes, 'csp-hashes'))
  .pipe(dest('dist'));
```

When omitted, the label defaults to `'through()'`. A non-string label throws a `TypeError` immediately.

### File context on errors: `FileError`

When your transform function **throws**, the error is automatically wrapped in a
**`FileError`** — an `Error` subclass that names *which file* and *which step*
failed, so a mid-stream failure points at the exact file instead of just making
the build red:

- `err.file` — the path of the file being processed when it threw;
- `err.stage` — your stage label (or `'through()'`);
- `err.cause` — your original error, intact, with its own stack.

The message is one parseable line: `<stage> failed on <file>: <original message>`:

```
minify failed on /proj/src/css/site.css: Unexpected token } at 12:40
```

The CLI renders it as `✗ build failed — file <path> (stage <label>): <message>`
followed by the original stack. When driving builds in code, check
`err.name === 'FileError'`, or use `instanceof FileError` (`FileError` is
exported from `node-build-stream`). A `FileError` thrown by your own function
passes through unchanged — wrapping never double-nests.

## Connecting the pieces: `pipeline()`

node-build-stream re-exports `pipeline` from `node:stream/promises`. Use it whenever
you want to **await** a whole chain (which is what your task functions should
return) — it propagates errors and cleans up resources properly:

```js
import { src, dest, through, pipeline } from 'node-build-stream';

const build = () => pipeline(
  src('src/**/*.css', { cwd }),
  through((file) => { file.contents = Buffer.from(file.contents.toString() + '\n'); return file; }),
  dest('dist'),
);

await build();   // resolves when every file is written; rejects on any error
```

> Inside a `task()` you can simply `return src(...).pipe(transform).pipe(dest(...))`
> — node-build-stream detects the returned stream and awaits it for you. `pipeline()`
> is what you use outside tasks, or when you want explicit error handling.

## The full picture in one task

```js
import { task, src, dest, through } from 'node-build-stream';

task('html', () =>
  src('src/**/*.html')                       // 1. read matching files
    .pipe(through((file) => {                // 2. transform each file
      file.contents = file.contents.toString().replace(/TODO:/g, 'NOTE:');
      return file;
    }))
    .pipe(dest('dist')),                     // 3. write to dist/
);
```

That single line is a complete, memory-friendly build step: it streams files one
at a time (never loading the whole tree into memory), transforms each in place,
and writes the results while preserving your folder structure.

Next: [The File object](./file.md) — the thing flowing through all of this.
