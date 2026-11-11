import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const source = path.dirname(require.resolve("rhino3dm"));
const target = path.join(root, "public/vendor/rhino3dm");
fs.mkdirSync(target, { recursive: true });
fs.copyFileSync(path.join(source, "rhino3dm.wasm"), path.join(target, "rhino3dm.wasm"));
fs.copyFileSync(path.join(source, "rhino3dm.js"), path.join(target, "rhino3dm.js"));
fs.copyFileSync(path.join(root, "docs/licenses/rhino3dm-MIT.txt"), path.join(target, "LICENSE.txt"));
console.log("Prepared pinned Rhino JS, WASM, and license assets.");
