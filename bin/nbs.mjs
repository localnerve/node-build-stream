#!/usr/bin/env node
/**
 * node-build-stream CLI.
 * 
 * Loads a build module (default: ./build.mjs, then ./gulpfile.mjs for easy
 * migration), imports it so its task() registrations are recorded, then runs the
 * requested task (or the default / all tasks) and exits non-zero on failure.
 * --glob reports what patterns match without loading any build file.
 * 
 * Copyright (c) 2026 Alex Grant (@localnerve), LocalNerve LLC
 * Licensed under the MIT license.
 */
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import process from 'node:process';
import fs from 'node:fs';

const BUILD_FILE_CANDIDATES = ['build.mjs', 'build.js', 'gulpfile.mjs', 'gulpfile.js'];

/**
 * Parse CLI arguments.
 *
 * Task names are non-dash tokens until the first unknown flag: after the
 * build's own flags start (e.g. `--minify`), following tokens belong to those
 * flags and are left alone for the build module, per the pass-through contract.
 * Known nbs options and their values do not end task-name collection.
 *
 * @param {string[]} argv Process argument list (without node + script path).
 * @returns {{ task: string|null, tasks: string[], config: string|null, help: boolean, watch: boolean, list: boolean, series: boolean, globs: string[], json: boolean }} The parsed CLI options.
 */
function parseArgs(argv) {
  const args = { task: null, tasks: [], config: null, help: false, watch: false, list: false, series: false, globs: [], json: false };
  let seenUnknownFlag = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--config' || a === '-c') args.config = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--watch') args.watch = true;
    else if (a === '--list' || a === '-l') args.list = true;
    else if (a === '--glob') args.globs.push(argv[++i]);
    else if (a === '--json') args.json = true;
    else if (a === '--series') args.series = true;
    else if (a.startsWith('-')) seenUnknownFlag = true;
    else if (!seenUnknownFlag) {
      args.tasks.push(a);
      args.task ??= a;
    }
  }
  return args;
}

function printHelp() {
  console.log(`nbs — no-dependency streaming build runner

Usage:
  nbs [taskName ...] [--series] [--config <file>] [--watch] [--list]
  nbs --glob <pattern>... [--json]

Options:
  --config, -c   Path to the build module (default: ./build.mjs or ./gulpfile.mjs)
  --watch        Build, then re-run on asset changes (see the build file's default export for its globs)
  --series       Run named tasks one after another (default: run concurrently)
  --list, -l     Print the names of all registered tasks and exit (runs nothing)
  --glob         List the files a glob pattern would match, without building
                 (repeatable; needs no build file). Matches print relative to the
                 pattern's base directory.
  --json         Machine-readable output: a JSON task inventory for --list
                 ({ name, description } per task), one JSON object per pattern
                 for --glob
  --help, -h     Show this help

The build module exports nothing special; it calls task()/series()/parallel() from
'node-build-stream' at import time. The CLI runs multiple named tasks concurrently
by default; --series runs them one after another in command-line order. Without task
names, the default task runs if one was registered with seriesDefault(), otherwise
all tasks run in parallel.

With --watch, the build file's default export may be an object { globs: [...] }
or a function; the listed patterns are watched recursively and the selected
task re-runs (debounced) when the matches change.`);
}

async function findBuildFile(explicit) {
  const cwd = process.cwd();
  if (explicit) {
    const p = path.resolve(cwd, explicit);
    if (!fs.existsSync(p)) throw new Error(`Config file not found: ${p}`);
    return p;
  }
  for (const name of BUILD_FILE_CANDIDATES) {
    const p = path.join(cwd, name);
    if (fs.existsSync(p)) return p;
  }
  throw new Error(
    `No build file found. Looked for: ${BUILD_FILE_CANDIDATES.join(', ')}. ` +
      'Use --config to specify one.'
  );
}

/**
 * Run in watch mode: arm the watcher from the build file's default export globs,
 * then stay alive until SIGINT/SIGTERM.
 *
 * @param {{ task: string|null }} args Parsed CLI options.
 * @param {any} mod The imported build module (its default export may carry globs).
 */
/**
 * Print what each glob pattern matches — a pure dev tool that needs no build
 * file. Text mode mirrors the per-pattern layout (pattern / base / one match
 * per line relative to base); --json emits one object per pattern:
 * { pattern, base, matches }. No matches is not an error: exit 0 with a
 * "(no matches)" note in text mode, an empty array in JSON mode.
 *
 * @param {{ globs: string[], json: boolean }} args Parsed CLI options.
 */
async function globReport(args) {
  const mod = await import(new URL('../src/index.js', import.meta.url).href);
  const cwd = process.cwd();
  const report = [];
  for (const pattern of args.globs) {
    const base = mod.deriveBase(pattern, cwd);
    const files = await mod.globFiles(pattern, { cwd });
    report.push({ pattern, base: path.relative(cwd, base) || '.', matches: files.map((f) => path.relative(base, f)) });
  }
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  for (const entry of report) {
    console.log(`pattern: ${entry.pattern}`);
    console.log(`base:    ${entry.base}`);
    console.log('---');
    if (entry.matches.length === 0) console.log('(no matches)');
    else for (const m of entry.matches) console.log(m);
  }
}

async function watchMode(args, mod) {
  const { watch } = await import(new URL('../src/index.js', import.meta.url).href);

  // Build files declare what to watch via their default export:
  //   export default { globs: ['src/**'] }
  // A function export may carry the same property (functions are objects):
  //   defaultFn.globs = ['src/**']
  const d = mod.default;
  const hasGlobs = d != null && typeof d !== 'string' && Array.isArray(d.globs);
  const globs = hasGlobs ? /** @type {string[]} */ (d.globs) : null;
  if (!globs) {
    throw new Error(
      '--watch: the build file must export { globs: [pattern, ...] } as its default export so node-build-stream knows what to watch.'
    );
  }

  const handle = await watch(globs, args.task ?? undefined, {
    onRun: (reason) => console.log(`\n${reason === 'start' ? 'build' : 'change detected'} — running…`),
    onError: (err) => console.error(`\n✗ task failed (${err.message})`),
  });
  console.log(`watching ${globs.join(', ')} in ${process.cwd()} — press Ctrl+C to stop`);

  await new Promise((resolve) => {
    const stop = () => { resolve(); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  await handle.close();
  console.log('\nwatcher stopped');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  // --glob is a pure dev tool: it runs before build-file discovery, so it
  // works in any directory — even one with no build file at all.
  if (args.globs.length > 0) {
    await globReport(args);
    return;
  }

  const buildFile = await findBuildFile(args.config);

  // Import the build module so its task registrations run.
  const mod = await import(pathToFileURL(buildFile).href);

  if (args.list) {
    const { listTasks, describeTasks } = await import(new URL('../src/index.js', import.meta.url).href);
    if (args.json) {
      // Typed inventory for agents: [{ name, description }] — description is
      // null when the task was registered without one.
      console.log(JSON.stringify(describeTasks(), null, 2));
      return;
    }
    const names = listTasks();
    if (names.length === 0) {
      console.log('No tasks registered.');
    } else {
      for (const name of names) console.log(name);
    }
    return;
  }

  if (args.watch && args.tasks.length > 1) {
    throw new Error('--watch supports one task at a time; select a single task.');
  }

  if (args.watch) {
    await watchMode(args, mod);
    return;
  }

  // The build file may export a function to invoke, or rely on registered tasks.
  if (typeof mod.default === 'function') {
    if (args.tasks.length > 0) {
      if (args.series) {
        for (const taskName of args.tasks) await mod.default(taskName);
      } else {
        const { parallel } = await import(new URL('../src/index.js', import.meta.url).href);
        await parallel(...args.tasks.map((taskName) => () => mod.default(taskName)));
      }
    } else {
      await mod.default(args.task);
    }
  } else if (args.tasks.length > 0) {
    if (args.series) {
      const { run } = await import(new URL('../src/index.js', import.meta.url).href);
      for (const taskName of args.tasks) await run(taskName);
    } else {
      const { parallel } = await import(new URL('../src/index.js', import.meta.url).href);
      await parallel(...args.tasks);
    }
  } else {
    const { runDefault } = await import(new URL('../src/index.js', import.meta.url).href);
    await runDefault();
  }

  console.log(`\n✓ build complete (${path.basename(buildFile)})`);
}

/**
 * Print a build failure. A FileError (thrown by through() steps) gets a
 * single parseable line — `✗ build failed — file <path> (stage <label>):
 * <message>` — followed by the original error's stack, so an agent or human
 * can jump straight to the offending file and step. Anything else prints the
 * usual full stack.
 *
 * @param {unknown} err The rejection value from main().
 */
function printFailure(err) {
  if (err instanceof Error && err.name === 'FileError') {
    const fe = /** @type {any} */ (err);
    console.error(`\n✗ build failed — file ${fe.file} (stage ${fe.stage}): ${fe.cause?.message ?? fe.message}`);
    if (fe.cause instanceof Error && fe.cause.stack) console.error(fe.cause.stack);
  } else {
    console.error('\n✗ build failed:');
    console.error(err && err.stack ? err.stack : err);
  }
}

main().catch((err) => {
  printFailure(err);
  process.exit(1);
});
