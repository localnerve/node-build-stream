/**
 * node-build-stream — streaming core.
 * 
 * src() yields File objects matching glob patterns; dest() writes them to disk;
 * through(fn) provides an object-mode Transform for native build steps. The
 * runner stays free of vinyl, using whatever file class resolves for the project.
 * 
 * Copyright (c) 2026 Alex Grant (@localnerve), LocalNerve LLC
 * Licensed under the MIT license.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Readable, Writable, Transform } from 'node:stream';
import { globFiles, deriveBase } from './glob.js';
import { expandBraces } from './glob-patterns.js';
import { resolveFileClassSync } from './vinyl.js';
import { toFileError } from './file-error.js';

/**
 * Options for {@link src}.
 *
 * @typedef {Object} SrcOptions
 * @property {string} [cwd] Directory patterns resolve against (default process.cwd()).
 * @property {string} [base] Override the derived gulp-style base directory.
 * @property {BufferEncoding} [encoding] If set, contents are read as strings of this encoding; otherwise Buffers.
 * @property {string} [from] Path used to resolve the project's file class (default cwd).
 */

/**
 * Build a File instance using the project's resolved file class.
 *
 * @param {string} fromPath A path inside the consuming project.
 * @returns {import('./file.js').File} An empty File of the resolved class.
 */
function makeFile(fromPath) {
  const { Vinyl } = resolveFileClassSync(fromPath);
  // Vinyl is a class (constructible); cast since the typedef models it callably.
  return /** @type {any} */ (new (/** @type {any} */ (Vinyl))());
}

/**
 * Async generator yielding a File per matched glob result, reading contents
 * from disk. Warns when positive patterns match nothing.
 *
 * @param {string[]} patterns Pattern list; may include brace expansion and negation.
 * @param {SrcOptions} opts Options as passed to src().
 * @param {string} cwd Resolved base directory.
 */
async function* fileGenerator(patterns, opts, cwd) {
  const positivePatterns = patterns
    .filter((pattern) => !String(pattern).startsWith('!'))
    .flatMap((pattern) => expandBraces(String(pattern)));
  const matchesByPattern = await Promise.all(positivePatterns.map(async (pattern) => ({
    pattern,
    files: await globFiles(pattern, { cwd }),
  })));
  const includedFiles = new Set(await globFiles(patterns, { cwd }));
  /** @type {Map<string, string>} */
  const filePatterns = new Map();
  for (const { pattern, files: matchedFiles } of matchesByPattern) {
    for (const file of matchedFiles) {
      if (includedFiles.has(file) && !filePatterns.has(file)) filePatterns.set(file, pattern);
    }
  }
  const files = [...filePatterns.keys()].sort();
  // Surface a likely typo early: a positive pattern that matches nothing would
  // otherwise produce a "successful" no-op stream that is hard to debug.
  const hasPositivePattern = positivePatterns.length > 0;
  if (!files.length && hasPositivePattern) {
    console.warn(`node-build-stream: src() matched no files for pattern(s): ${patterns.join(', ')}`);
  }

  for (const file of files) {
    let contents;
    try {
      contents = opts.encoding
        ? await fs.promises.readFile(file, opts.encoding)
        : await fs.promises.readFile(file);
    } catch (cause) {
      const err = /** @type {Error} */ (cause);
      throw new Error(`node-build-stream: failed to read ${file}: ${err.message}`, { cause });
    }
    const f = makeFile(opts.from ?? cwd);
    f.path = file;
    const pattern = filePatterns.get(file);
    if (pattern === undefined) throw new Error(`node-build-stream: no source pattern found for matched file: ${file}`);
    f.base = opts.base ? path.resolve(cwd, opts.base) : deriveBase(pattern, cwd);
    f.contents = contents;
    yield f;
  }
}

/**
 * Create a readable stream of File objects for the given glob pattern(s).
 * Each file's base is derived from the first concrete positive pattern that
 * matches it, unless `opts.base` overrides the base for every file.
 *
 * Backed by Readable.from(asyncGenerator) so backpressure is respected and each
 * file is read exactly once.
 *
 * @param {string|string[]} patterns Glob pattern(s), negation via `!`.
 * @param {SrcOptions} [opts] See {@link SrcOptions}.
 * @returns {Readable} Object-mode readable of File objects.
 */
export function src(patterns, opts = {}) {
  const cwd = path.resolve(opts.cwd ?? process.cwd());
  const patternList = Array.isArray(patterns) ? patterns : [patterns];
  return Readable.from(fileGenerator(patternList, opts, cwd), { objectMode: true });
}

/**
 * Create a writable stream that writes File objects to disk under `destDir`.
 * Each file is written under `destDir` using `file.relative` (or its basename),
 * creating parent directories as needed. Paths resolving outside `destDir` are
 * rejected. Buffer and string contents are supported; streamed contents are
 * piped through.
 *
 * @param {string} destDir Destination directory (absolute or cwd-relative).
 * @param {{ cwd?: string }} [opts]
 * @returns {Writable} Object-mode writable of File objects.
 */
export function dest(destDir, opts = {}) {
  const cwd = path.resolve(opts.cwd ?? process.cwd());
  const outDir = path.resolve(cwd, destDir);

  // Async writes are tracked in a queue so that end() (and therefore the
  // 'finish' event and stream/promises pipeline()) cannot complete while a
  // write is still in flight — Writable only honors backpressure via the
  // synchronous part of write().
  let queued = Promise.resolve();

  return new Writable({
    objectMode: true,
    write(file, _enc, callback) {
      const op = queued.then(async () => {
        const relative = file.relative || path.basename(file.path);
        const target = path.resolve(outDir, relative);
        const relativeTarget = path.relative(outDir, target);
        if (
          !relativeTarget ||
          relativeTarget === '..' ||
          relativeTarget.startsWith(`..${path.sep}`) ||
          path.isAbsolute(relativeTarget)
        ) {
          throw new Error(`node-build-stream: dest() refused to write outside destination directory: ${target}`);
        }
        await fs.promises.mkdir(path.dirname(target), { recursive: true });
        if (file.isStream()) {
          // Pipe streamed contents to disk.
          const ws = fs.createWriteStream(target);
          try {
            await new Promise((resolve, reject) => {
              ws.on('error', reject);
              ws.on('finish', () => resolve(true));
              file.contents.pipe(ws);
            });
          } finally {
            ws.close();
          }
        } else {
          await fs.promises.writeFile(target, file.contents ?? Buffer.alloc(0));
        }
        // Reflect the final location back on mutable File objects.
        if ('path' in file && typeof file.path === 'string') file.path = target;
      }).then(() => callback(), (cause) => callback(/** @type {Error} */ (cause)));
      queued = op.catch(() => {}); // keep the chain alive across errors
    },
    /** @param {(err?: Error | null) => void} cb Completes once every write has settled. */
    final(cb) {
      queued.then(() => cb(), (err) => cb(/** @type {Error} */ (err)));
    },
  });
}

/**
 * Validate that a through() transform emitted something downstream can consume:
 * a File-like object (string `path`), or return it unchanged. Anything else is
 * almost certainly a bug, so fail fast with an actionable message instead of
 * surfacing later as an obscure error at dest().
 *
 * @param {any} value The pushed value.
 * @param {string} context Label for the error message (e.g. 'through()').
 * @returns {any} The validated value, unchanged.
 * @throws {TypeError} When the value is not File-like.
 */
function assertFileLike(value, context) {
  if (value != null && typeof value === 'object' && typeof value.path === 'string') return value;
  throw new TypeError(
    `${context} expected a File (an object with a string ".path"), an array of Files, ` +
    `or null/undefined to drop the file. Got: ${describeValue(value)}.`,
  );
}

/** Compact human-readable description of a value for error messages. @param {any} value @returns {string} */
function describeValue(value) {
  if (value == null) return String(value);
  if (Array.isArray(value)) return `array(${value.length})`;
  const t = typeof value;
  if (t === 'object') return `${t} { ${Object.keys(value).slice(0, 5).join(', ')} }`;
  return t;
}

/**
 * Create an object-mode Transform from a user function, for native build steps.
 *
 * The function receives each File and may:
 *   - return a new File to push downstream, or
 *   - mutate the incoming File in place and return nothing (it is re-pushed), or
 *   - return null/undefined to drop the file, or
 *   - return an array of Files to emit multiple outputs.
 * Async functions are supported. Pushed values must be File-like (string `path`)
 * or through() throws a clear error.
 *
 * When the transform function throws, the error is wrapped in a FileError
 * naming the file being processed and the stage label, with the original
 * error preserved as `.cause` — so a mid-stream failure points at the exact
 * file (see docs/streams.md, "File context on errors").
 *
 * @param {(file: import('./file.js').File) => any} fn Per-file transform function.
 * @param {string} [stage] Optional label for this step (e.g. `'minify'`), used
 *   in FileError messages when `fn` throws. Defaults to `'through()'`.
 * @returns {Transform} Object-mode transform.
 * @throws {TypeError} When `stage` is provided but is not a string.
 */
export function through(fn, stage) {
  if (stage !== undefined && typeof stage !== 'string') {
    throw new TypeError(`through() stage label must be a string. Got: ${describeValue(stage)}.`);
  }
  const stageLabel = stage ?? 'through()';
  return new Transform({
    objectMode: true,
    async transform(file, _enc, callback) {
      try {
        const result = await fn(file);
        if (result == null) return callback(); // drop the file
        if (Array.isArray(result)) {
          for (const f of result) this.push(assertFileLike(f, 'through()'));
        } else {
          this.push(assertFileLike(result, 'through()'));
        }
        callback();
      } catch (cause) {
        const filePath = file && typeof file.path === 'string' ? file.path : '(unknown file)';
        callback(toFileError(cause, filePath, stageLabel));
      }
    },
  });
}

/**
 * @param {any} value Candidate stream.
 * @returns {boolean} True when the value is an async-iterable readable (e.g. src()).
 */
function isReadableStream(value) {
  return !!value && typeof value === 'object' && typeof value[Symbol.asyncIterator] === 'function';
}

/**
 * Merge multiple object-mode File streams into a single stream.
 *
 * Pass every source to the call — this is the fan-in shape Gulp builds use,
 * adapted from gulp's `.pipe(merge(srcB))` idiom (which Node's `.pipe()` cannot
 * express, since it ends its destination when the source finishes):
 *
 *   // Gulp:      srcA.pipe(merge(srcB)).pipe(dest('dist'))
 *   // nbs:       pipeline(merge(srcA, srcB), dest('dist'))
 *
 * Backed by Readable.from(asyncGenerator), so backpressure is respected and
 * each source is fully drained before the next one starts (sources are
 * consumed in the order given; file order within each source is preserved).
 * An error on any source rejects/ends the merged stream with that error.
 *
 * @param {...(Readable|null|undefined)} streams Object-mode readables of File
 *   objects (e.g. src() results); `null`/`undefined` are ignored.
 * @returns {Readable} Object-mode readable yielding every source file, in order.
 * @throws {TypeError} When an argument is not a readable stream, or when no
 *   streams are given.
 */
export function merge(...streams) {
  const sources = streams.filter((s) => s != null);
  for (const s of sources) {
    if (!isReadableStream(s)) {
      throw new TypeError(
        `merge() expects object-mode readable streams (e.g. src() results). Got: ${describeValue(s)}.`,
      );
    }
  }
  if (!sources.length) {
    throw new TypeError('merge() requires at least one stream.');
  }

  /** @yields {any} Every file from every source, in order. */
  async function* merged() {
    for (const stream of sources) {
      for await (const file of stream) yield file;
    }
  }

  return Readable.from(merged(), { objectMode: true });
}

/**
 * Create an object-mode Transform that rewrites each file's path so it lands
 * under a subfolder of the eventual dest() directory:
 * `destDir/<prefix>/<original relative>` — the "two globs into one dest, keep
 * the subfolders" idiom without hand-mutated through()s (cf. gulp-vinyl-dest).
 *
 * The prefix is applied relative to `file.base`: it sits between the matched
 * base and the file's relative layout, so subfolder structure under the base
 * is preserved. Files are mutated in place (the same object flows downstream
 * with its new path); contents — including streamed contents — pass through
 * untouched, so it composes cleanly with dest() and any other transform.
 *
 * A prefix that normalizes to nothing (`''`, `'.'`) is a no-op pass-through;
 * leading/trailing slashes are ignored; multi-segment prefixes like
 * `'nested/deep'` are supported.
 *
 * @param {string} prefix Subfolder name(s) to insert under the dest root.
 * @returns {Transform} Object-mode transform (mutates file.path in place).
 * @throws {TypeError} When `prefix` is not a string.
 */
export function prefixDest(prefix) {
  if (typeof prefix !== 'string') {
    throw new TypeError(`prefixDest() expects a string subfolder name. Got: ${describeValue(prefix)}.`);
  }
  const parts = prefix.split(/[\\/]+/).filter(Boolean);

  /**
   * Push each file through unchanged (the empty/`.`-prefix no-op).
   *
   * @param {import('./file.js').File} file The incoming File.
   * @param {string} _enc Ignored encoding.
   * @param {(err?: Error | null) => void} callback Completes the transform step.
   * @this {Transform}
   */
  function passthrough(file, _enc, callback) {
    this.push(file);
    callback();
  }

  if (!parts.length) return new Transform({ objectMode: true, transform: passthrough });
  const sub = parts.join('/');

  /**
   * Rewrite the file's path to <base>/<prefix>/<relative> and push it on.
   *
   * @param {import('./file.js').File} file The incoming File.
   * @param {string} _enc Ignored encoding.
   * @param {(err?: Error | null) => void} callback Completes the transform step.
   * @this {Transform}
   */
  function rewrite(file, _enc, callback) {
    try {
      const p = file.path;
      if (typeof p !== 'string' || !p) {
        throw new TypeError('prefixDest() received a File without a string ".path".');
      }
      const base = typeof file.base === 'string' && file.base ? file.base : path.dirname(p);
      let rel = '';
      if (base && p.startsWith(base + path.sep)) rel = path.relative(base, p);
      if (!rel || path.isAbsolute(rel) || rel.split(path.sep).includes('..')) rel = path.basename(p);
      file.path = path.join(base, sub, rel);
      this.push(file);
      callback();
    } catch (cause) {
      callback(/** @type {Error} */ (cause));
    }
  }

  return new Transform({ objectMode: true, transform: rewrite });
}

/* -------------------------------------------------------------------------- */
/* Raw-buffer <-> file-object bridge helpers (the csp-hashes pattern).         */
/* These let plain Node.js byte streams feed gulp plugins without vinyl.       */
/* -------------------------------------------------------------------------- */

/**
 * Wrap raw buffer/string chunks into file-like objects ({ path, contents }) so
 * an object-mode gulp plugin can consume a plain byte stream.
 *
 * @param {string} filePath Label path to attach to each wrapped object.
 * @returns {Transform} readableObjectMode transform.
 */
export function wrapFile(filePath) {
  return new Transform({
    readableObjectMode: true,
    writableObjectMode: false,
    construct(callback) {
      callback();
    },
    transform(chunk, _enc, done) {
      this.push({ path: filePath, contents: chunk });
      done();
    },
  });
}

/**
 * Unwrap file-like objects back to their raw `contents` (Buffer/string) so the
 * output of an object-mode gulp plugin can be written as a plain byte stream.
 *
 * @returns {Transform} writableObjectMode transform.
 */
export function unwrapFile() {
  return new Transform({
    writableObjectMode: true,
    readableObjectMode: false,
    construct(callback) {
      callback();
    },
    /** @param {{ contents?: any }} fileObj A file-like object. */
    transform(fileObj, _enc, done) {
      this.push(fileObj.contents);
      done();
    },
  });
}
