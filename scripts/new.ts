// Creates a draft article or a works entry with its image directory. See README.md.
import fs from 'node:fs';

const kind = process.argv[2];
const id = Math.floor(Date.now() / 1000);

if (kind === 'journal') {
  const d = new Date();
  const today = [d.getFullYear(), d.getMonth() + 1, d.getDate()]
    .map((n) => String(n).padStart(2, '0'))
    .join('-');
  const file = `src/content/journal/${id}.mdx`;
  const frontmatter = `---\ntitle: ''\npubDate: ${today}\ndraft: true\n---\n\n`;
  // "wx" fails instead of overwriting if two runs land on the same second.
  fs.writeFileSync(file, frontmatter, { flag: 'wx' });
  console.log(`created ${file}`);
} else if (kind === 'works') {
  const file = 'src/content/works/works.json';
  const works: { id: number }[] = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (works.some((w) => w.id === id)) throw new Error(`id ${id} already exists in ${file}`);
  // Placeholders that pass the schema in src/content.config.ts; fill them in.
  const entry = { id, title: '', description: '', url: 'https://example.com/', cover: '' };
  fs.writeFileSync(file, JSON.stringify([...works, entry], null, 2) + '\n');
  console.log(`added entry ${id} to ${file}`);
  console.log(`fill in title, description and url. cover takes the image name that`);
  console.log(`"npm run img apply" assigns; while it is empty the list shows a frame`);
} else {
  console.error('usage: npm run new journal | npm run new works');
  process.exit(1);
}

fs.mkdirSync(`r2-clone/${kind}/${id}`, { recursive: true });
console.log(`created r2-clone/${kind}/${id}/`);
