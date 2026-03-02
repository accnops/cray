import { $ } from "bun";

async function build() {
  console.log("Building packages...");

  // Build all packages
  await $`pnpm -r build`;

  // Build web assets
  console.log("\nBuilding web UI...");
  await $`cd packages/web && pnpm build`;

  // Compile CLI to standalone binary
  console.log("\nCompiling standalone binary...");
  await $`bun build packages/cli/src/index.ts --compile --outfile dist/cray`;

  // Copy web assets alongside binary
  console.log("\nCopying web assets...");
  await $`rm -rf dist/web`;
  await $`cp -r packages/web/dist dist/web`;

  console.log("\nBuild complete!");
  console.log("  Binary: dist/cray");
  console.log("  Web UI: dist/web/");
}

build().catch(console.error);
