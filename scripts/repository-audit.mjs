import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");
const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];
const RUNTIME_DIRS = ["components", "lib"];
const IGNORE_FILE_PATTERNS = [
  /(?:^|\/)__tests__(?:\/|$)/,
  /(?:^|\/)tests?(?:\/|$)/,
  /\.test\.[cm]?[jt]sx?$/,
  /\.spec\.[cm]?[jt]sx?$/,
];

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function isCodeFile(file) {
  return EXTENSIONS.includes(path.extname(file));
}

function relative(file) {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

function isIgnored(file) {
  const rel = relative(file);
  return IGNORE_FILE_PATTERNS.some((pattern) => pattern.test(rel));
}

const allCodeFiles = walk(SRC).filter(isCodeFile);
const fileSet = new Set(allCodeFiles.map((file) => path.normalize(file)));

function resolveCandidate(base) {
  const candidates = [
    base,
    ...EXTENSIONS.map((ext) => `${base}${ext}`),
    ...EXTENSIONS.map((ext) => path.join(base, `index${ext}`)),
  ];
  return candidates.find((candidate) => fileSet.has(path.normalize(candidate))) ?? null;
}

function resolveImport(fromFile, specifier) {
  if (specifier.startsWith("@/")) {
    return resolveCandidate(path.join(SRC, specifier.slice(2)));
  }
  if (specifier.startsWith(".")) {
    return resolveCandidate(path.resolve(path.dirname(fromFile), specifier));
  }
  return null;
}

function importsFrom(file) {
  const source = fs.readFileSync(file, "utf8");
  const specifiers = new Set();
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      specifiers.add(match[1]);
    }
  }
  return [...specifiers]
    .map((specifier) => resolveImport(file, specifier))
    .filter(Boolean);
}

const appEntries = allCodeFiles.filter((file) => {
  const rel = relative(file);
  return (
    rel.startsWith("src/app/") ||
    rel === "src/middleware.ts" ||
    rel === "src/middleware.tsx"
  );
});

const reachable = new Set();
const queue = [...appEntries];
while (queue.length > 0) {
  const file = path.normalize(queue.shift());
  if (reachable.has(file) || !fileSet.has(file)) continue;
  reachable.add(file);
  for (const dependency of importsFrom(file)) {
    if (!reachable.has(path.normalize(dependency))) queue.push(dependency);
  }
}

const runtimeCandidates = RUNTIME_DIRS.flatMap((dir) => walk(path.join(SRC, dir)))
  .filter(isCodeFile)
  .filter((file) => !isIgnored(file));
const unreachable = runtimeCandidates
  .filter((file) => !reachable.has(path.normalize(file)))
  .map(relative)
  .sort();

console.log("PARCELGRID repository audit");
console.log(`- source files: ${allCodeFiles.length}`);
console.log(`- app entry files: ${appEntries.length}`);
console.log(`- reachable runtime files: ${reachable.size}`);
console.log(`- unreachable runtime candidates: ${unreachable.length}`);

if (unreachable.length > 0) {
  console.log("\nCandidates requiring manual review (not automatically deleted):");
  for (const file of unreachable) console.log(`  - ${file}`);
}

if (process.argv.includes("--fail-on-unreachable") && unreachable.length > 0) {
  process.exitCode = 1;
}
