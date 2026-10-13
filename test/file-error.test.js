/**
 * node-build-stream — FileError tests (src/file-error.js + through() wrapping).
 *
 * Covers the FileError class itself, the toFileError() helper (idempotence and
 * non-Error coercion), and that through() wraps thrown errors in a FileError
 * naming the offending file and stage label while preserving `.cause`.
 *
 * Copyright (c) 2026 Alex Grant (@localnerve), LocalNerve LLC
 * Licensed under the MIT license.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import nodeBuild, { src, through, FileError as IndexFileError } from '../src/index.js';
import { FileError, toFileError } from '../src/file-error.js';
import { setupFixture, cleanupFixture } from './helpers/fixture.js';

let tmp;

before(async () => { tmp = await setupFixture(); });
after(cleanupFixture);

/** A fresh object-mode sink that discards everything (each call gets a new one). */
function discardSink() {
  return new Writable({ objectMode: true, write(_chunk, _enc, cb) { cb(); } });
}

test('FileError carries file, stage, message, and the original cause', () => {
  const original = new Error('boom');
  const err = new FileError('/proj/src/a.txt', 'minify', original);
  assert.ok(err instanceof Error);
  assert.equal(err.name, 'FileError');
  assert.equal(err.file, '/proj/src/a.txt');
  assert.equal(err.stage, 'minify');
  assert.equal(err.cause, original);
  assert.match(err.message, /^minify failed on \/proj\/src\/a\.txt: boom$/);
});

test('toFileError passes FileErrors through unchanged and coerces non-Errors', () => {
  const fe = new FileError('/x.css', 'stage', new Error('inner'));
  assert.equal(toFileError(fe, '/other.css', 'other'), fe, 'must not double-wrap');
  const wrapped = toFileError('plain string failure', '/x.css', 'stage');
  assert.ok(wrapped instanceof FileError);
  assert.ok(wrapped.cause instanceof Error);
  assert.equal(wrapped.cause.message, 'plain string failure');
});

test('the main entry re-exports the same FileError class (named + default)', () => {
  assert.equal(IndexFileError, FileError);
  assert.equal(nodeBuild.FileError, FileError);
});

test('through() wraps a thrown error in a FileError naming the file and stage', async () => {
  const original = new Error('boom');
  const filePath = path.join(tmp, 'src', 'a.txt');
  await assert.rejects(
    pipeline(src('src/a.txt', { cwd: tmp }), through(() => { throw original; }, 'minify'), discardSink()),
    (err) => {
      assert.ok(err instanceof FileError, `expected FileError, got ${err?.name}: ${err}`);
      assert.equal(err.file, filePath);
      assert.equal(err.stage, 'minify');
      assert.equal(err.cause, original, 'original error must be preserved as .cause');
      assert.match(err.message, /minify failed on .*a\.txt: boom/);
      return true;
    },
  );
});

test('through() uses the default stage label "through()" when none is given', async () => {
  await assert.rejects(
    pipeline(src('src/a.txt', { cwd: tmp }), through(() => { throw new Error('nope'); }), discardSink()),
    (err) => {
      assert.equal(err.name, 'FileError');
      assert.equal(err.stage, 'through()');
      assert.match(err.message, /through\(\) failed on/);
      return true;
    },
  );
});

test('through() does not double-wrap a FileError thrown by the transform', async () => {
  const fe = new FileError('/proj/src/a.txt', 'inner-stage', new Error('deep'));
  await assert.rejects(
    pipeline(src('src/a.txt', { cwd: tmp }), through(() => { throw fe; }, 'outer'), discardSink()),
    (err) => err === fe,
  );
});

test('through() rejects a non-string stage label with TypeError', () => {
  assert.throws(() => through(() => null, 42), TypeError);
  assert.doesNotThrow(() => through(() => null));
  assert.doesNotThrow(() => through(() => null, 'minify'));
});
