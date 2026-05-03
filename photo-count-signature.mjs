/**
 * Prints a stable signature: "GroupId:count|..." sorted by id.
 * Used by deploy.ps1 to bump PORTFOLIO_LAST_UPDATED only when any album size changes.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const galleryPath = path.resolve(process.argv[2] || path.join(root, "gallery-data.js"));
const window = {};
eval(fs.readFileSync(galleryPath, "utf8"));
const groups = window.PORTFOLIO_GROUPS;
if (!Array.isArray(groups)) {
  console.error("PORTFOLIO_GROUPS missing or invalid");
  process.exit(2);
}
const sig = [...groups]
  .map((g) => `${g.id}:${Array.isArray(g.photos) ? g.photos.length : 0}`)
  .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
  .join("|");
process.stdout.write(sig);
