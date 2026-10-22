# Tasks, series & parallel

You have already met Gulp (or you are about to): a build is just a set of named
steps that you can run in an order. In node-build-stream those steps are **tasks**,
and the ordering tools are `series()` and `parallel()`. This page explains how
to define tasks, what kinds of functions they may be, and how to compose them.

## Registering a task with `task(name, fn, description?)`

```js
import { task } from 'node-build-stream';

task('clean', async () => {
  console.log('removing dist/');
});
```

- `name` must be a **non-empty string** — it is what you use later to run the
  task from the CLI or by name.
- `fn` must be a **function**. It may be:
  - **synchronous** — returns nothing or a plain value;
  - **async** — returns a Promise (the usual case);
  - **stream-returning** — returns a Node.js stream such as
    `src(...).pipe(dest(...))` (see [Streams](./streams.md)). When this happens,
    the task is considered *done* only when that stream finishes writing.
- `task()` registers the function; it does not run it immediately. Pass the
  function itself, not the result of calling it:

  ```js
  task('build', build);       // registered; build runs when the task is invoked
  task('build', build());     // invalid: calls build now and passes its result
  ```
- `description` (optional) is a **one-line purpose** for the task — pure
  metadata for humans and AI agents, with no effect on how the task runs. It
  may be a non-empty string or an object `{ description }`. It powers
  [`describeTasks()`](#handy-extras) and the CLI's `--list --json`
  ([CLI](./cli.md)), so an agent driving your build can see what each task
  does before invoking it:

  ```js
  task('css', () => src('src/*.css').pipe(dest('dist')), 'Copy and process stylesheets');
  // or, with an options object:
  task('css', fn, { description: 'Copy and process stylesheets' });
  ```

  Re-registering a task without a description clears any previously stored one.

`task()` returns `fn` itself, so you can chain or reuse it:

```js
const copyCss = task('css', () => src('src/*.css').pipe(dest('dist')));
// later:
await series(copyCss);  // passing the function directly works too
```

## Running tasks

### `series(...items)` — one after another

Builds a schedule that runs each item in order and **stops at the first error**:

```js
import { series } from 'node-build-stream';

await series('clean', 'build', 'manifest');
// clean runs, then build, then manifest. If build throws, manifest never runs.
```

### `parallel(...items)` — all at once

Builds a schedule that runs every item **concurrently** and resolves when all
succeed; it rejects on the first error:

```js
import { parallel } from 'node-build-stream';

await parallel('copyHtml', 'copyCss');  // both start immediately
```

Use `parallel` for independent work (copying HTML and CSS are unrelated), and
`series` when one step depends on another (you cannot write a manifest before
the files exist).

### Schedules are lazy

`series()` and `parallel()` do not start anything when you call them — they
return a **schedule**, an awaitable object that starts its tasks the first
time it is awaited (or `.then`'d), and never re-runs if awaited again. This
matters for composition: because argument expressions are evaluated before
`series()` runs, a nested schedule is simply *passed along* — it only starts
when the outer schedule reaches it:

```js
// Safe as written: the parallel schedule starts AFTER clean finishes,
// not while series() arguments are being evaluated.
await series(cleanStage, parallel(styles, scripts, assets), revision);
```

Awaiting a schedule twice (or passing it to two places) never re-runs its
tasks — both awaits observe the single execution.

### What can you pass?

Both accept, in any mix:

- **task names** — strings of registered tasks;
- **functions** — plain task functions that were not registered;
- **nested arrays** — for readable composition: `series(['a', 'b'], 'c')`;
- **Promises** — awaited and their resolved value is collected;
- **streams** — drained to completion (rare; usually you return streams from a
  task function instead);
- **`null`/`undefined`** — ignored.

Anything else raises a `TypeError`. Both return an array of results in input
order.

A schedule returned by `series()` or `parallel()` is an awaitable object, not a
function. Await or return it; do not try to call it:

```js
const schedule = series('clean', 'build');
await schedule;        // runs both tasks
// schedule();         // TypeError: schedules are not callable
```

### Composing: the usual pattern

```js
import { task, series, parallel } from 'node-build-stream';

task('html', () => src('src/*.html').pipe(dest('dist')));
task('css',  () => src('src/*.css').pipe(dest('dist')));
task('manifest', async () => { /* write manifest.json */ });

// A "build" that copies things in parallel, then writes the manifest:
export default () => parallel('html', 'css').then(() => series('manifest'));
```

## Handy extras

| Export                | Purpose                                                                 |
| --------------------- | ----------------------------------------------------------------------- |
| `run(nameOrFn)`       | Run a single named task (or function) to completion.                    |
| `getTask(name)`       | Look up a registered task by name; throws if unknown.                   |
| `listTasks()`         | Return the names of all registered tasks, in registration order.        |
| `describeTasks()`     | Return each registered task as `{ name, description }`, in order — the data behind `--list --json`. |
| `seriesDefault(name)` | Mark one task as **the** default when nothing is specified on the CLI.  |
| `runDefault()`        | Run the `seriesDefault` task, or every registered task in parallel.     |

### Choosing a default task

If someone runs your CLI without naming a task (see [CLI](./cli.md)), node-build
runs whatever you marked with `seriesDefault`:

```js
import { seriesDefault } from 'node-build-stream';

seriesDefault('build');   // `node-build-stream` with no args now runs task "build"
```

Without a default, all registered tasks run in parallel.

## Full example: a multi-task build

```js
// build.mjs
import { task, series, parallel, seriesDefault, src, dest } from 'node-build-stream';

task('clean', async () => { /* delete dist/ */ });
task('html',  () => src('src/*.html').pipe(dest('dist')));
task('css',   () => src('src/*.css').pipe(dest('dist')));
task('manifest', async () => { /* write manifest.json */ });

const build = () => parallel('html', 'css').then(() => series('manifest'));

seriesDefault('build');        // `node-build-stream`  -> html+css, then manifest

export default (taskName) => taskName ? series(taskName) : build();
```

This is the shape of a real project: independent copies in parallel, dependent
steps in series, and a declared default.

## Common pitfalls

- **Forgetting to return your stream.** If a task function does
  `src(...).pipe(dest(...))` but does not `return` it, the task finishes
  immediately and files may not be written. Always return the stream (or make
  the function async and `await` it).
- **Returning a function from a task.** A task body must itself be a function,
  but the runner does not invoke a function that the body returns. Call that
  function inside the task, or return its Promise/schedule:

  ```js
  task('build', () => build());       // invoke and return the result
  task('build', () => build);         // returns a function; does not run it
  ```
- **Calling a schedule.** `series()` and `parallel()` return lazy, awaitable
  schedules, not callable functions. Use `await series(...)` or return the
  schedule from your task; do not write `series(...)()`.
- **Name typos.** `getTask`/the CLI throw `Unknown task: "x". Registered: ...`
  listing what actually exists — a good safety net while you learn names.
- **Mixing up series vs parallel for dependent steps.** A manifest written in
  `parallel` with the copies that feed it is a race condition; keep it in
  `series`.
- **Other self-starting expressions are NOT lazy.** Schedules (`series`/
  `parallel`) defer their work until awaited, but any *other* expression passed
  as an item runs the moment you evaluate the arguments — a direct
  `fetch(...)`, a `.then()` chain that already kicked off I/O, a plugin call
  doing work. Wrap those in a zero-arg function so they run only when the
  schedule reaches that slot:

  ```js
  // fetch() fires during argument evaluation — before clean() has run.
  await series(cleanStage, fetchRemoteConfig());

  // Correct — the thunk defers the call until series reaches step two.
  await series(cleanStage, () => fetchRemoteConfig(), revision);
  ```

Next: [Streams](./streams.md) — how files actually move through your build.
