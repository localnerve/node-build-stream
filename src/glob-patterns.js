/**
 * Expand `{a,b}` brace sets into concrete patterns (no other fancy syntax).
 *
 * @param {string} pattern A glob pattern that may contain one level of braces per segment.
 * @returns {string[]} The expanded patterns; `[pattern]` when no braces are present.
 */
export function expandBraces(pattern) {
  const m = pattern.match(/^(.*)\{([^{}]+)\}(.*)$/);
  if (!m) return [pattern];
  const [, pre, group, post] = m;
  const out = [];
  for (const opt of group.split(',')) {
    for (const suffix of expandBraces(post)) {
      out.push(pre + opt + suffix);
    }
  }
  return out.length ? out : [pattern];
}
