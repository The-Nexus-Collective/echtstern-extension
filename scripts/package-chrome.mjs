import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(rootDir, "dist");
const artifactsDir = join(rootDir, "artifacts");
const version = process.env.npm_package_version;

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: "inherit",
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}`);
  }
};

if (!version) {
  throw new Error("Missing npm_package_version. Run this script through pnpm.");
}

run("pnpm", ["run", "build:chrome"]);

if (!existsSync(distDir)) {
  throw new Error("Missing dist directory after Chrome build.");
}

await mkdir(artifactsDir, { recursive: true });

const outputPath = join(artifactsDir, `echtstern-chrome-v${version}.zip`);
await rm(outputPath, { force: true });

run("zip", ["-r", outputPath, ".", "-x", "*.DS_Store"], {
  cwd: distDir,
});
