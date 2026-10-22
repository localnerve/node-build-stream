/**
 * node-build-stream — glob tests (src/glob.js).
 *
 * Copyright (c) 2026 Alex Grant (@localnerve), LocalNerve LLC
 * Licensed under the MIT license.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import path from 'node:path';
import { globFiles, deriveBase } from '../src/index.js';
import { setupFixture, cleanupFixture } from './helpers/fixture.js';

let tmp;

test.before(async () => { tmp = await setupFixture(); });
test.after(cleanupFixture);

test('deriveBase computes the static leading portion (gulp-style)', () => {
  assert.equal(deriveBase('src/**/*.css', '/x'), path.resolve('/x', 'src'));
  assert.equal(deriveBase('**/*.txt', '/x'), path.resolve('/x'));
  assert.equal(deriveBase('a/b/c.js', '/x'), path.resolve('/x', 'a', 'b'));
});

test('deriveBase handles absolute patterns and plain filenames', () => {
  assert.equal(deriveBase('/abs/dir/*.txt', '/x'), path.join('/', 'abs', 'dir'));
  assert.equal(deriveBase('plain.txt', '/x'), path.resolve('/x'));
});

test('globFiles matches braces, recursion, and negation', async () => {
  const res = await globFiles(['src/**/*.{txt,css,js}', '!**/js/**'], { cwd: tmp });
  assert.deepEqual(
    res.map((p) => path.relative(tmp, p)),
    [path.join('src', 'a.txt'), path.join('src', 'css', 'b.css')],
  );
});

test('globFiles normalizes supported fs.glob entry shapes and filters non-files', async () => {
  const realGlob = fsSync.glob;
  fsSync.glob = (_patterns, _options, callback) => callback(null, [
    'src/a.txt',
    'src/missing.txt',
    'src/css',
    { isFile: () => true, path: 'src/css/b.css' },
    { isFile: () => true, path: path.join(tmp, 'src', 'js', 'c.js') },
    { isFile: () => true, name: 'me.txt', parentPath: path.join(tmp, 'skip') },
    { isFile: () => true },
    { isFile: () => true, path: path.join(tmp, '..', 'outside.txt') },
    { isFile: () => false, path: 'src/a.txt' },
  ]);
  try {
    const files = await globFiles('**/*', { cwd: tmp });
    assert.deepEqual(files, [
      path.join(tmp, 'skip', 'me.txt'),
      path.join(tmp, 'src', 'a.txt'),
      path.join(tmp, 'src', 'css', 'b.css'),
      path.join(tmp, 'src', 'js', 'c.js'),
    ]);
  } finally {
    fsSync.glob = realGlob;
  }
});

test('globFiles falls back to the built-in matcher when fs.glob throws', async () => {
  // The source accesses fs.glob via property lookup at call time, so patching
  // the shared fs object is enough to force the fallback path.
  const realGlob = fsSync.glob;
  fsSync.glob = () => { throw new Error('boom'); };
  try {
    const res = await globFiles(['src/**/*.{txt,css}', '!**/css/**'], { cwd: tmp });
    assert.deepEqual(
      res.map((p) => path.relative(tmp, p)),
      [path.join('src', 'a.txt')],
    );
    // Missing cwd in fallback mode resolves to [] instead of throwing.
    const missing = await globFiles(['**/*.txt'], { cwd: path.join(tmp, 'no-such-dir') });
    assert.deepEqual(missing, []);
  } finally {
    fsSync.glob = realGlob;
  }
});
