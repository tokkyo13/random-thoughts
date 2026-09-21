// Creates a draft article, a picture entry or a work entry with its image directory. See README.md.
import fs from 'node:fs';

const kind = process.argv[2];
const id = Math.floor(Date.now() / 1000);

if (kind === 'journal' || kind === 'picture') {
  const d = new Date();
  const today = [d.getFullYear(), d.getMonth() + 1, d.getDate()]
    .map((n) => String(n).padStart(2, '0'))
    .join('-');
  const file = `src/content/${kind}/${id}.mdx`;
  // An article starts hidden; a picture names its images instead, and "npm run img apply"
  // fills both lines in.
  const extra = kind === 'journal' ? ['draft: true'] : ["cover: ''", 'images: []'];
  const frontmatter = ['---', "title: ''", `pubDate: ${today}`, ...extra, '---', '', ''].join('\n');
  // "wx" fails instead of overwriting if two runs land on the same second.
  fs.writeFileSync(file, frontmatter, { flag: 'wx' });
  console.log(`created ${file}`);
  if (kind === 'picture') {
    console.log('put the images in the directory below and run "npm run img apply": it names');
    console.log('them, copies the first one to a cover, and writes both lines of the frontmatter.');
    console.log('the order of "images" is the order they are shown in; the body is the description');
  }
} else if (kind === 'work') {
  const file = 'src/content/work/work.json';
  const entries: { id: number }[] = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (entries.some((e) => e.id === id)) throw new Error(`id ${id} already exists in ${file}`);
  // Placeholders that pass the schema in src/content.config.ts; fill them in.
  const entry = { id, title: '', description: '', url: 'https://example.com/', cover: '' };
  fs.writeFileSync(file, JSON.stringify([...entries, entry], null, 2) + '\n');
  console.log(`added entry ${id} to ${file}`);
  console.log(`fill in title, description and url. cover takes the image name that`);
  console.log(`"npm run img apply" assigns; while it is empty the list shows a frame`);
} else {
  console.error('usage: npm run new journal | picture | work');
  process.exit(1);
}

fs.mkdirSync(`r2-clone/${kind}/${id}`, { recursive: true });
console.log(`created r2-clone/${kind}/${id}/`);
