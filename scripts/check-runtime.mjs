const [major] = process.versions.node.split(".").map(Number);

if (major !== 24) {
  console.error(
    `PARCELGRID requires Node.js 24.x. Current runtime: ${process.version}.`,
  );
  console.error("Activate the version in .nvmrc before running this command.");
  process.exit(1);
}

console.log(`Node.js runtime OK: ${process.version}`);
