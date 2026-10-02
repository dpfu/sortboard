/* Build an inspectable, dependency-free single HTML file. Node standard library only. */
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
let html = read('CoLabSort.html');
const scripts = [...html.matchAll(/<script defer src="([^"]+)"><\/script>/g)].map(m => m[1]);
html = html.replace(/\s*<script defer src="[^"]+"><\/script>/g, '');
html = html.replace('<link rel="stylesheet" href="style.css">', '<style>\n' + read('style.css') + '\n</style>');
// Inline scripts must execute after the DOM (inline "defer" would not defer).
const code = scripts.map(name => `<script>\n/* ${name} */\n${read(name).replace(/<\/script/gi, '<\\/script')}\n</script>`).join('\n');
html = html.replace('</body>', `${code}\n</body>`);
const out = path.resolve(process.argv[2] || path.join(root, 'dist', 'CoLabSort.html'));
fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, html);
console.log(out);
