/**
 * node-build-stream — file-context error.
 *
 * A FileError is a regular Error that additionally names the file a pipeline
 * step failed on and the stage (build step) that failed, with the original
 * error preserved as `.cause`. It turns "the build threw" into one readable,
 * machine-parseable line: which file, which step, why.
 *
 * Copyright (c) 2026 Alex Grant (@localnerve), LocalNerve LLC
 * Licensed under the MIT license.
 */
/**
 * An error that names the file and pipeline stage a build step failed on.
 *
 * Carries the original error as `.cause` (never lost), plus `file` (the
 * offending file's path) and `stage` (a label for the failing step, e.g.
 * `'minify'`). The message is a single parseable line:
 *
 *   `<stage> failed on <file>: <original error message>`
 *
 * Instances are produced automatically by `through()` when its transform
 * function throws; you can also construct one yourself for custom steps.
 */
export declare class FileError extends Error {
    /** @type {'FileError'} */
    name: 'FileError';
    /** Path of the file the failing step was processing. @type {string} */
    file: string;
    /** Label for the failing step. @type {string} */
    stage: string;
    /**
     * @param {string} file Path of the file the failing step was processing.
     * @param {string} stage Label for the failing step (e.g. `'minify'`, `'through()'`).
     * @param {unknown} cause The original error that was wrapped.
     */
    constructor(file: string, stage: string, cause: unknown);
}
/**
 * Wrap an unknown thrown value in a FileError naming `file` and `stage`.
 * Already-wrapped values (FileError instances) pass through unchanged, so
 * wrapping is idempotent and never double-nests. Non-Error values are coerced
 * to an Error first so `.cause` is always an Error.
 *
 * @param {unknown} cause The original thrown value.
 * @param {string} file Path of the file being processed when it threw.
 * @param {string} stage Label for the failing step.
 * @returns {FileError} A FileError wrapping `cause` (or `cause` itself).
 */
export declare function toFileError(cause: unknown, file: string, stage: string): FileError;
