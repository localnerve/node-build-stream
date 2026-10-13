import { Readable, Writable, Transform } from 'node:stream';
export type SrcOptions = {
    /**
     * Directory patterns resolve against (default process.cwd()).
     */
    cwd?: string;
    /**
     * Override the derived gulp-style base directory.
     */
    base?: string;
    /**
     * If set, contents are read as strings of this encoding; otherwise Buffers.
     */
    encoding?: BufferEncoding;
    /**
     * Path used to resolve the project's file class (default cwd).
     */
    from?: string;
};
/**
 * Create a readable stream of File objects for the given glob pattern(s).
 *
 * Backed by Readable.from(asyncGenerator) so backpressure is respected and each
 * file is read exactly once.
 *
 * @param {string|string[]} patterns Glob pattern(s), negation via `!`.
 * @param {SrcOptions} [opts] See {@link SrcOptions}.
 * @returns {Readable} Object-mode readable of File objects.
 */
export declare function src(patterns: string | string[], opts?: SrcOptions): Readable;
/**
 * Create a writable stream that writes File objects to disk under `destDir`.
 * Each file is written to `path.join(destDir, file.relative)`, creating parent
 * directories as needed. Buffer and string contents are supported; streamed
 * contents are piped through.
 *
 * @param {string} destDir Destination directory (absolute or cwd-relative).
 * @param {{ cwd?: string }} [opts]
 * @returns {Writable} Object-mode writable of File objects.
 */
export declare function dest(destDir: string, opts?: {
    cwd?: string;
}): Writable;
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
 * @param {(file: import('./file.js').File) => any} fn Per-file transform function.
 * @returns {Transform} Object-mode transform.
 */
export declare function through(fn: (file: import('./file.js').File) => any): Transform;
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
export declare function merge(...streams: (Readable | null | undefined)[]): Readable;
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
export declare function prefixDest(prefix: string): Transform;
/**
 * Wrap raw buffer/string chunks into file-like objects ({ path, contents }) so
 * an object-mode gulp plugin can consume a plain byte stream.
 *
 * @param {string} filePath Label path to attach to each wrapped object.
 * @returns {Transform} readableObjectMode transform.
 */
export declare function wrapFile(filePath: string): Transform;
/**
 * Unwrap file-like objects back to their raw `contents` (Buffer/string) so the
 * output of an object-mode gulp plugin can be written as a plain byte stream.
 *
 * @returns {Transform} writableObjectMode transform.
 */
export declare function unwrapFile(): Transform;
