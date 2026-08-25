import { rm } from "node:fs/promises";
import { resolve } from "node:path";

// TypeScript reads generated Next route types. Removing this exact generated
// directory before CI avoids stale duplicate declarations after interrupted
// dev/build processes; no source or user data is touched.
const nextDirectory = resolve(process.cwd(), ".next");
if (!nextDirectory.endsWith("/.next")) throw new Error("Refusing to clean an unexpected path.");
await rm(nextDirectory, { recursive: true, force: true });
