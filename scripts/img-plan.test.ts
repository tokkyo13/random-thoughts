// npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { areaOf, collectRefs, planCovers, planGc, planStrays, planSync, variantWidths, writeNames } from './img-plan.ts';

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
  const p = planSync([file('work/1789139901', 'thumb.png'), file('home', 'figure.jpg')], { images: {} }, new Map());
  assert.deepEqual(p.uploads.map((u) => `${u.dir}/${u.stem}`), ['home/cover-a1b2c3d4', 'work/1789139901/cover-a1b2c3d4']);
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
    [`${J}/figure-a1b2c3d4`, `${J}/figure-ffff0000`, 'journal/1789000000/cover-a1b2c3d4', 'home/cover-a1b2c3d4', 'work/1789139901/cover-a1b2c3d4']
      .map((k) => [k, entry]),
  );
  const items = {
    journal: new Map([['1789139909', '<Fig src="figure-a1b2c3d4" />']]),
    work: new Map([['1789139901', JSON.stringify({ id: 1789139901, cover: 'cover-a1b2c3d4' })]]),
  };
  const refs = collectRefs(items, ["image('home/cover-a1b2c3d4')"]);
  assert.deepEqual(planGc({ images }, refs, items), [
    { key: 'journal/1789000000/cover-a1b2c3d4', reason: 'item missing' },
    { key: `${J}/figure-ffff0000`, reason: 'unreferenced' },
  ]);
});

test('gc also takes the objects no image claims, and leaves the ones they do', () => {
  const manifest = { images: { [`${J}/figure-a1b2c3d4`]: entry } };
  const remote = new Map([
    ...synced,
    [`${J}/figure-a1b2c3d4.896w.avif`, 7], // a width the list no longer has
    ['journal/1789000000/cover-a1b2c3d4.share.jpg', 3], // an image that is gone from the manifest
  ]);
  assert.deepEqual(planStrays(manifest, remote), [
    'journal/1789000000/cover-a1b2c3d4.share.jpg',
    `${J}/figure-a1b2c3d4.896w.avif`,
  ]);
  assert.deepEqual(planStrays(manifest, synced), []);
});

test('variant widths never exceed the original', () => {
  assert.deepEqual(variantWidths(J, 'figure', 1000), [448, 896]);
  assert.deepEqual(variantWidths(J, 'figure', 300), [300]);
});

test('a picture item without a cover has its first image copied to one', () => {
  const P = 'picture/1789139909';
  const local = [file(P, '02.png', OTHER), file(P, '01.png'), file(P, 'notes.txt')];
  const plan = planSync(local, { images: {} }, new Map());
  // Names are listed in file-name order, so 01.png leads and gives the cover its bytes
  assert.deepEqual(plan.order.get(P), ['art-a1b2c3d4', 'art-ffff0000']);
  assert.deepEqual(planCovers(local, plan, { images: {} }), [
    { dir: P, from: '01.png', to: 'cover-a1b2c3d4.png' },
  ]);
});

test('a cover already on disk or in the manifest is not copied again, and only picture gets one', () => {
  const P = 'picture/1789139909';
  const named = [file(P, 'cover.png'), file(P, '01.png', OTHER)];
  assert.deepEqual(planCovers(named, planSync(named, { images: {} }, new Map()), { images: {} }), []);

  const plain = [file(P, '01.png')];
  const manifest = { images: { [`${P}/cover-ffff0000`]: { ...entry, md5: OTHER } } };
  assert.deepEqual(planCovers(plain, planSync(plain, manifest, new Map()), manifest), []);

  const other = [file(J, 'figure.jpg'), file('work/1789139901', 'thumb.png')];
  assert.deepEqual(planCovers(other, planSync(other, { images: {} }, new Map()), { images: {} }), []);
});

const entryText = (body: string) => ['---', "title: 'x'", 'pubDate: 2026-09-20', body, '---', '', 'text'].join('\n');

test('names are written into the frontmatter, in order, and only once', () => {
  const empty = entryText(["cover: ''", 'images: []'].join('\n'));
  const first = writeNames(empty, ['cover-a1b2c3d4', 'art-a1b2c3d4', 'art-ffff0000']);
  assert.equal(first.problem, undefined);
  assert.deepEqual(first.added, ['cover-a1b2c3d4', 'art-a1b2c3d4', 'art-ffff0000']);
  assert.equal(
    first.text,
    entryText(["cover: 'cover-a1b2c3d4'", 'images:', '  - art-a1b2c3d4', '  - art-ffff0000'].join('\n')),
  );

  // Running again changes nothing, and a later image joins the end of the list as it stands
  assert.deepEqual(writeNames(first.text, ['cover-a1b2c3d4', 'art-a1b2c3d4', 'art-ffff0000']).added, []);
  const more = writeNames(first.text, ['cover-a1b2c3d4', 'art-a1b2c3d4', 'art-0f0f0f0f']);
  assert.deepEqual(more.added, ['art-0f0f0f0f']);
  assert.match(more.text, /- art-ffff0000\n  - art-0f0f0f0f/);
});

test('an order set by hand is kept, and a filled cover is left alone', () => {
  const edited = entryText(["cover: 'cover-ffff0000'", 'images:', '  - art-ffff0000', '  - art-a1b2c3d4'].join('\n'));
  const p = writeNames(edited, ['cover-a1b2c3d4', 'art-a1b2c3d4', 'art-ffff0000']);
  assert.deepEqual(p.added, []);
  assert.equal(p.text, edited);
});

test('a list this tool cannot extend is reported, never rewritten', () => {
  const flow = entryText(["cover: ''", "images: ['art-ffff0000']"].join('\n'));
  const p = writeNames(flow, ['art-a1b2c3d4']);
  assert.match(p.problem!, /images:/);
  assert.equal(p.text, flow);
  assert.equal(writeNames('no frontmatter here', ['art-a1b2c3d4']).problem, 'has no frontmatter');
});

test('CRLF stays CRLF', () => {
  const crlf = entryText(["cover: ''", 'images: []'].join('\n')).split('\n').join('\r\n');
  const p = writeNames(crlf, ['art-a1b2c3d4']);
  assert.equal(p.text.includes('\r\n  - art-a1b2c3d4\r\n'), true);
  assert.equal(p.text.includes('\n\n'), false);
});
