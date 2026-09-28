import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

// Constant command: no project data, file names, or user input is interpolated into a shell.
const inventory = JSON.parse(execSync("pnpm licenses list --prod --json", { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }));
const entries = Object.values(inventory).flat().sort((a, b) => a.name.localeCompare(b.name));
const parts = ["PARCELGRID — Third-party notices\nGenerated from installed production dependencies. Each component retains its own license.\nThis notice does not license PARCELGRID itself or any external dataset."];
for (const entry of entries) {
  const texts = new Set();
  for (const root of entry.paths ?? []) {
    for (const name of fs.readdirSync(root)) {
      if (!/^(licen[cs]e|copying|notice)([.-]|$)/i.test(name)) continue;
      const file = path.join(root, name);
      if (fs.statSync(file).isFile()) texts.add(fs.readFileSync(file, "utf8").trim());
    }
  }
  if (entry.name === "rhino3dm") texts.add(fs.readFileSync("docs/licenses/rhino3dm-MIT.txt", "utf8").trim());
  const verification = entry.name === "suncalc" && entry.versions.every(version => version === "2.0.2")
    ? "\nVerified bundled LICENSE: BSD-2-Clause (package.json omits the license field)." : "";
  parts.push(`${entry.name} @ ${entry.versions.join(", ")}\nDeclared license: ${entry.license}${verification}\n${entry.homepage ?? ""}\n${entry.author ?? ""}\n\n${texts.size ? [...texts].join("\n\n") : "No license text shipped in package root; consult the component's distribution and upstream source."}`);
}
fs.mkdirSync("public", { recursive: true });
const output = parts.join("\n\n" + "=".repeat(72) + "\n\n").replace(/\r\n?/g, "\n").split("\n").map(line => line.trimEnd()).join("\n");
fs.writeFileSync("public/third-party-notices.txt", output + "\n");
console.log(`Wrote notices for ${entries.length} production packages.`);
