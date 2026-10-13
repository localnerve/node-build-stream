export type TaskFn = () => any;
export type TaskItem = string | TaskFn | import('node:stream').Stream | Promise<any> | null | undefined;
/**
 * A task body. May be synchronous, async (returning a Promise), or
 * stream-returning (returning a Node.js stream such as `src().pipe(dest())`).
 *
 * @callback TaskFn
 * @returns {any} A value, a Promise, or a Node.js stream.
 */
/**
 * Something that can be passed to series()/parallel(): a registered task name,
 * a raw task function, a Node.js stream, a Promise, or null/undefined (ignored).
 *
 * @typedef {string|TaskFn|import('node:stream').Stream|Promise<any>|null|undefined} TaskItem
 */
/**
 * Register a named task in the registry. Returns the function unchanged so it can
 * be chained, reused, or passed directly to series()/parallel().
 *
 * The optional third argument is a one-line **description** of what the task
 * does — pure metadata for humans and agents (it powers `describeTasks()` and
 * the CLI's `--list --json`); it has no effect on how the task runs. It may be
 * a non-empty string or an object with a `description` property. Re-registering
 * a task without a description clears any previously stored one.
 *
 * @param {string} name A non-empty string used to run the task by name.
 * @param {TaskFn} fn The task body (sync, async, or stream-returning).
 * @param {string|{description: string}} [description] Optional one-line purpose of the task.
 * @returns {TaskFn} The same `fn`, for chaining or direct use.
 * @throws {TypeError} If `name` is not a non-empty string, `fn` is not a function,
 *   or `description` is neither a non-empty string nor `{ description: <non-empty string> }`.
 */
export declare function task(name: string, fn: TaskFn, description?: string | {
    description: string;
}): TaskFn;
/**
 * Mark a registered task as the one to run when no task is specified on the CLI
 * (or when `runDefault()` is called with no default set).
 *
 * @param {string} name The registered task name to treat as the default.
 * @returns {void}
 */
export declare function seriesDefault(name: string): void;
/**
 * Look up a registered task by name.
 *
 * @param {string} name The registered task name.
 * @returns {TaskFn} The registered task function.
 * @throws {Error} If no task with that name is registered (lists the known names).
 */
export declare function getTask(name: string): TaskFn;
/**
 * Return the names of all registered tasks, in registration order.
 *
 * @returns {string[]} The registered task names.
 */
export declare function listTasks(): string[];
export type TaskInfo = {
    /**
     * The registered task name.
     */
    name: string;
    /**
     * The one-line purpose passed to task(),
     * or null when the task was registered without a description.
     */
    description: string | null;
};
/**
 * A single entry of the task inventory returned by describeTasks().
 *
 * @typedef {object} TaskInfo
 * @property {string} name The registered task name.
 * @property {string|null} description The one-line purpose passed to task(),
 *   or null when the task was registered without a description.
 */
/**
 * Return a typed inventory of all registered tasks — each with its name and
 * optional one-line description — in registration order. This is the data
 * behind the CLI's `--list --json` output, for agents or tools that drive a
 * build and need to know what tasks exist and what they do.
 *
 * @returns {TaskInfo[]} One entry per registered task (empty array when none).
 */
export declare function describeTasks(): TaskInfo[];
export type LazySchedule<T> = {
    then: (onfulfilled?: (value: T) => any, onrejected?: (reason: any) => any) => Promise<any>;
};
/**
 * Build a schedule that runs the given tasks sequentially. Resolves with an
 * array of results in order, or rejects on the first error. Accepts task names,
 * functions, arrays, Promises (awaited), other schedules (started when reached),
 * and streams in any mix (nested arrays are flattened).
 *
 * The schedule is LAZY: nothing runs until it is awaited (or `.then`'d). Awaiting
 * the same schedule twice never re-runs its tasks.
 *
 * @param {...TaskItem} args The tasks to run, one after another.
 * @returns {LazySchedule<any[]>} The lazy schedule; await it to run.
 */
export declare function series(...args: TaskItem[]): LazySchedule<any[]>;
export type ParallelThunk = () => Promise<unknown>;
/**
 * Build a schedule that runs the given tasks concurrently. Resolves with an
 * array of results (in input order) when all succeed, or rejects on the first
 * error. Accepts task names, functions, arrays, Promises (awaited), other
 * schedules (started when reached), and streams in any mix (nested arrays
 * flattened).
 *
 * The schedule is LAZY: nothing runs until it is awaited (or `.then`'d). This
 * is what makes `series(clean, parallel(a, b, c), revision)` safe without any
 * extra wrapping — the parallel schedule only starts when series reaches it.
 * Awaiting the same schedule twice never re-runs its tasks.
 *
 * @param {...TaskItem} args The tasks to run at the same time.
 * @returns {LazySchedule<any[]>} The lazy schedule; await it to run.
 */
export declare function parallel(...args: TaskItem[]): LazySchedule<any[]>;
/**
 * Convenience: run a single named task or function to completion.
 *
 * @param {string|TaskFn} nameOrFn A registered task name or a raw task function.
 * @returns {Promise<any[]>} The result array from running that one task.
 * @throws {TypeError} If the argument is neither a string nor a function.
 */
export declare function run(nameOrFn: string | TaskFn): Promise<any[]>;
/**
 * Run the default task (set via `seriesDefault`), or every registered task in
 * parallel when no default is set.
 *
 * @returns {Promise<any[]>} The result array from the run.
 */
export declare function runDefault(): Promise<any[]>;
