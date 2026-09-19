// The TextMate grammar belongs to the compiler's repository, where a test keeps
// it in step with the parser. This copies it in at build time instead of keeping
// a second copy under version control.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const compilerRepo = process.env.Y8960MML_COMPILER_DIR ?? join(root, "..", "Y8960MMLCompiler");
const src = join(compilerRepo, "syntaxes", "y8960mml.tmLanguage.json");
const dst = join(root, "syntaxes", "y8960mml.tmLanguage.json");

if (!existsSync(src)) {
  console.error(`copy-grammar: ${src} がありません。`);
  console.error("Y8960MMLCompiler を隣に置くか、Y8960MML_COMPILER_DIR にその場所を入れてください。");
  process.exit(1);
}
mkdirSync(dirname(dst), { recursive: true });
copyFileSync(src, dst);
console.log(`copy-grammar: ${src} -> ${dst}`);
