/**
 * Expand `{a,b}` brace sets into concrete patterns (no other fancy syntax).
 *
 * @param {string} pattern A glob pattern that may contain one level of braces per segment.
 * @returns {string[]} The expanded patterns; `[pattern]` when no braces are present.
 */
export declare function expandBraces(pattern: string): string[];
