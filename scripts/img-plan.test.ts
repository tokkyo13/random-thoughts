// npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { areaOf, collectRefs, planGc, planSync, variantWidths } from './img-plan.ts';

const J = 'journal/1789139909';
const MD5 = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'; // -> figure-a1b2c3d4, cover-a1b2c3d4
const OTHER = 'ffff0000ffff0000ffff0000ffff0000';
const entry = { ext: 'jpg', width: 1000, height: 800, size: 10, md5: MD5, variants: [448] };
const objects = (stem: string) => new Map([[`${J}/${stem}.jpg`, 10], [`${J}/${stem}.448w.avif`, 5]]);
const synced = objects('figure-a1b2c3d4');
const file = (dir: string, name: string, md5 = MD5) => ({ dir, name, md5, size: 10 });

test('image directories follow AREAS', () => {
  assert.equal(areaOf(J), 'journal');
  assert.equal(areaOf('home'), 'home');
  for (const bad of ['journal', 'journal/abc', 'home/1789139909', 'gallery/1789139909', `${J}/sub`, '']) {
    assert.equal(areaOf(bad), undefined, bad);
  }
});

test('a new file is named after its content; a name starting with a type picks that type', () => {
  const p = planSync([file(J, 'IMG_2.jpg', OTHER), file(J, 'IMG_1.JPEG'), file(J, 'Cover.png', OTHER)], { images: {} }, new Map());
  assert.deepEqual(
    p.uploads.map((u) => [u.from, u.stem, u.ext]),
    [['Cover.png', 'cover-ffff0000', 'png'], ['IMG_1.JPEG', 'figure-a1b2c3d4', 'jpg'], ['IMG_2.jpg', 'figure-ffff0000', 'jpg']],
  );
  assert.deepEqual(p.errors, []);
});

test('two files with the same content in one directory is an error, not two uploads', () => {
  const p = planSync([file(J, 'a.jpg'), file(J, 'copy of a.jpg')], { images: {} }, new Map());
  assert.deepEqual(p.uploads.map((u) => u.from), ['a.jpg']);
  assert.match(p.errors[0], /same content/);
});

test('an image in the manifest keeps its name, whatever the naming scheme was', () => {
  const p = planSync([file(J, 'figure-001.jpg')], { images: { [`${J}/figure-001`]: entry } }, objects('figure-001'));
  assert.deepEqual([p.uploads, p.downloads, p.repairs, p.errors], [[], [], [], []]);
});

test('editing a file in place makes a new image and leaves the old one', () => {
  const p = planSync([file(J, 'figure-a1b2c3d4.jpg', OTHER)], { images: { [`${J}/figure-a1b2c3d4`]: entry } }, synced);
  assert.deepEqual(p.uploads.map((u) => u.stem), ['figure-ffff0000']);
  assert.deepEqual(p.downloads.map((d) => d.key), [`${J}/figure-a1b2c3d4`]);
  assert.deepEqual(p.errors, []);
});

test('areas with one type give every file that type', () => {
  const p = planSync([file('works/1789139901', 'thumb.png'), file('home', 'figure.jpg')], { images: {} }, new Map());
  assert.deepEqual(p.uploads.map((u) => `${u.dir}/${u.stem}`), ['home/cover-a1b2c3d4', 'works/1789139901/cover-a1b2c3d4']);
});

test('a synced image needs nothing', () => {
  const p = planSync([file(J, 'figure-a1b2c3d4.jpg')], { images: { [`${J}/figure-a1b2c3d4`]: entry } }, synced);
  assert.deepEqual([p.uploads, p.downloads, p.repairs, p.warnings, p.errors], [[], [], [], [], []]);
});

test('missing locally downloads; missing on R2 repairs from a matching local copy, else errors', () => {
  const manifest = { images: { [`${J}/figure-a1b2c3d4`]: entry } };
  assert.equal(planSync([], manifest, synced).downloads.length, 1);
  const partial = new Map([[`${J}/figure-a1b2c3d4.jpg`, 10]]);
  assert.equal(planSync([file(J, 'figure-a1b2c3d4.jpg')], manifest, partial).repairs.length, 1);
  assert.match(planSync([], manifest, partial).errors[0], /missing on R2/);
});

test('a cover also owes a share JPEG on R2; other types do not', () => {
  const C = `${J}/cover-a1b2c3d4`;
  const manifest = { images: { [C]: entry } };
  const withoutShare = new Map([[`${C}.jpg`, 10], [`${C}.448w.avif`, 5]]);
  // The share JPEG is missing, so the matching local copy repairs it
  assert.equal(planSync([file(J, 'cover-a1b2c3d4.jpg')], manifest, withoutShare).repairs.length, 1);
  const withShare = new Map([...withoutShare, [`${C}.share.jpg`, 3]]);
  assert.deepEqual(planSync([file(J, 'cover-a1b2c3d4.jpg')], manifest, withShare).repairs, []);
  // A figure owes nothing beyond its original and variants, so the same two objects complete it
  const figure = { images: { [`${J}/figure-a1b2c3d4`]: entry } };
  assert.deepEqual(planSync([file(J, 'figure-a1b2c3d4.jpg')], figure, synced).repairs, []);
});

test('bad locations and formats are errors, never uploads', () => {
  const p = planSync([file('journal/abc', 'a.jpg'), file(J, 'IMG_1.HEIC')], { images: {} }, new Map());
  assert.equal(p.uploads.length, 0);
  assert.equal(p.errors.length, 2);
});

test('gc deletes only what nothing references, and says why', () => {
  const images = Object.fromEntries(
    [`${J}/figure-a1b2c3d4`, `${J}/figure-ffff0000`, 'journal/1789000000/cover-a1b2c3d4', 'home/cover-a1b2c3d4', 'works/1789139901/cover-a1b2c3d4']
      .map((k) => [k, entry]),
  );
  const items = {
    journal: new Map([['1789139909', '<Fig src="figure-a1b2c3d4" />']]),
    works: new Map([['1789139901', JSON.stringify({ id: 1789139901, cover: 'cover-a1b2c3d4' })]]),
  };
  const refs = collectRefs(items, ["image('home/cover-a1b2c3d4')"]);
  assert.deepEqual(planGc({ images }, refs, items), [
    { key: 'journal/1789000000/cover-a1b2c3d4', reason: 'item missing' },
    { key: `${J}/figure-ffff0000`, reason: 'unreferenced' },
  ]);
});

test('variant widths never exceed the original', () => {
  assert.deepEqual(variantWidths(J, 'figure', 1000), [448, 896]);
  assert.deepEqual(variantWidths(J, 'figure', 300), [300]);
});
