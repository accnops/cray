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
  await $`bun build packages/cli/src/index.ts --compile --outfile dist/ccray`;

  console.log("\nBuild complete! Binary at: dist/ccray");
}

build().catch(console.error);
