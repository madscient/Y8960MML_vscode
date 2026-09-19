// The TextMate grammar belongs to the compiler's repository, where a test keeps
// it in step with the parser. This copies it in at build time instead of keeping
// a second copy under version control. It is taken from the compiler release
// named by config.compilerTag in package.json, so a build does not pick up
// whatever the compiler's working tree holds at the moment.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tag = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).config.compilerTag;
const compilerRepo = process.env.Y8960MML_COMPILER_DIR ?? join(root, "..", "Y8960MMLCompiler");
const src = "syntaxes/y8960mml.tmLanguage.json";
const dst = join(root, "syntaxes", "y8960mml.tmLanguage.json");

if (!existsSync(compilerRepo)) {
  console.error(`copy-grammar: ${compilerRepo} がありません。`);
  console.error("Y8960MMLCompiler を隣に置くか、Y8960MML_COMPILER_DIR にその場所を入れてください。");
  process.exit(1);
}
let grammar;
try {
  grammar = execFileSync("git", ["-C", compilerRepo, "show", `${tag}:${src}`]);
} catch {
  console.error(`copy-grammar: ${compilerRepo} に ${tag} の ${src} がありません。git fetch --tags で取ってください。`);
  process.exit(1);
}
mkdirSync(dirname(dst), { recursive: true });
writeFileSync(dst, grammar);
console.log(`copy-grammar: ${tag}:${src} -> ${dst}`);
