// 単一 HTML への束ね。
// GitHub Pages にはモジュール版をそのまま置けばよく、ビルドは要らない。
// これは「1ファイルで配れる版」を作るためだけのもの。AirDrop でも動く。
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ORDER = ["grid.js", "traffic.js", "economy.js", "ui.js", "storage.js", "main.js"];

const strip = (src) => src
  .replace(/^\s*import[\s\S]*?from\s+["'][^"']+["'];\s*$/gm, "")
  .replace(/^export\s+(?=(const|let|var|function|class)\b)/gm, "");

const js = ORDER.map((f) => {
  const body = strip(readFileSync(join(root, "js", f), "utf8")).trim();
  return `// ==== ${f} ====\n${body}`;
}).join("\n\n");

const css = readFileSync(join(root, "style.css"), "utf8");
const src = readFileSync(join(root, "index.html"), "utf8");

const inlined = src
  .replace(/<link rel="stylesheet" href="style\.css">/, `<style>\n${css}\n</style>`)
  .replace(/<link rel="manifest"[^>]*>\s*/, "")
  .replace(/<script type="module" src="js\/main\.js"><\/script>/,
           `<script type="module">\n${js}\n</script>`);

mkdirSync(join(root, "dist"), { recursive: true });
writeFileSync(join(root, "dist", "index.html"), inlined);

// ホスティング側が <html><head><body> を被せる場合に渡す断片。
// title / フォント / style / 本体 / script だけを、その順で出す。
const pick = (re) => (inlined.match(re) || [""])[0];
const fragment = [
  pick(/<title>[\s\S]*?<\/title>/),
  ...(inlined.match(/<link rel="preconnect"[^>]*>/g) || []),
  pick(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis[^>]*>/),
  pick(/<style>[\s\S]*?<\/style>/),
  pick(/<div id="app">[\s\S]*?<\/div>\s*(?=<script)/).trim(),
  pick(/<script type="module">[\s\S]*?<\/script>/),
].filter(Boolean).join("\n");
writeFileSync(join(root, "dist", "artifact.html"), fragment);

console.log(`dist/index.html    ${(inlined.length / 1024).toFixed(1)} KB`);
console.log(`dist/artifact.html ${(fragment.length / 1024).toFixed(1)} KB`);
