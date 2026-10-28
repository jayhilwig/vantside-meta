import { rmSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = join(root, ".next");
if (relative(root, output) !== ".next") throw new Error("Unexpected Next.js output path.");
rmSync(output, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
