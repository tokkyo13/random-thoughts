// The licensing REUSE.toml states: every file has a license, and nothing that is particular to
// the author or to this site sits in a file under MIT. See "License" in README.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import site from '../content/site/site.json' with { type: 'json' };
import link from '../content/link/link.json' with { type: 'json' };

// uv runs the REUSE tool in a Python of its own. The extra is the encoding detector it needs
// on Windows, where there is no libmagic.
const REUSE = 'reuse[charset-normalizer]==6.2.0';

type Report = {
  files: { path: string; spdx_expressions: { value: string }[] }[];
  summary: { compliant: boolean };
};

// lint exits non-zero when the project is not compliant; the report comes all the same.
const run = spawnSync('uvx', ['--from', REUSE, 'reuse', 'lint', '--json'], { encoding: 'utf8' });
if (!run.stdout) throw new Error(`uvx could not run the REUSE tool. Is uv installed?\n${run.stderr ?? run.error}`);
const report: Report = JSON.parse(run.stdout);

// The about entry is MDX; only these two plain lines of its frontmatter are read.
const about = fs.readFileSync('content/about/about.mdx', 'utf8');
const field = (key: string) => about.match(new RegExp(`^${key}:\\s*['"]?(.*?)['"]?\\s*$`, 'm'))?.[1] ?? '';

// What a fork replaces with its own. A host is checked, not the URL, so a bare domain is found too.
const identity = [
  site.title,
  site.description,
  new URL(site.url).host,
  new URL(site.imageOrigin).host,
  field('name'),
  field('latin'),
  ...Object.values(link).map((l) => l.url).filter((url) => !url.startsWith('/')),
].filter((v) => v !== '');

test('every file has a license and a copyright notice', () => {
  assert.equal(report.summary.compliant, true, 'run "uvx --from "' + REUSE + '" reuse lint" for the details');
});

test('no MIT file holds what is particular to the author or the site', () => {
  const found = report.files
    .filter((f) => f.spdx_expressions.map((e) => e.value).join() === 'MIT')
    .flatMap((f) => {
      const text = fs.readFileSync(f.path, 'utf8').toLowerCase();
      return identity.filter((v) => text.includes(v.toLowerCase())).map((v) => `${f.path}: ${v}`);
    });
  assert.deepEqual(found, [], 'move these into content/, or into a file REUSE.toml does not license as MIT');
});
