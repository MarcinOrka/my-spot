/**
 * Builds static tribute-data.js from Tribute/tribute.md.
 * Manual step only — deploy.ps1 does NOT run this script.
 *
 * Usage: node generate-tribute-data.mjs
 * Then commit tribute-data.js and deploy when ready.
 * The page is static — tribute-data.js is loaded as a plain <script>; tribute.md is never uploaded.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { escapeHtml } from "./md-utils.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(root, "Tribute", "tribute.md");
const outputPath = path.join(root, "tribute-data.js");

function strip(text) {
  return String(text || "")
    .replace(/\*\*/g, "")
    .replace(/\\\./g, ".")
    .replace(/\\\)/g, ")")
    .trim();
}

function formatParagraph(text) {
  let out = escapeHtml(
    String(text || "")
      .replace(/\\\./g, ".")
      .replace(/\\\)/g, ")")
  );
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\*([^*]+)\*/g, "<strong>$1</strong>");
  return out.trim();
}

function parseProfileLink(line) {
  const trimmed = line.trim();
  let match = trimmed.match(/^Profile Link:\s*\[([^\]]+)\]\((.+)\)\s*$/i);
  if (match) {
    return { label: strip(match[1]), url: match[2].trim() };
  }
  match = trimmed.match(/^\[([^\]]+)\]\((.+)\)\s*$/);
  if (match) {
    return { label: strip(match[1]), url: match[2].trim() };
  }
  return null;
}

const text = fs.readFileSync(sourcePath, "utf8");
const lines = text.split(/\r?\n/);
const result = { title: "", sections: [] };

let currentSection = null;
let currentEntry = null;
let buffer = [];

function flushParagraph() {
  if (!currentEntry || !buffer.length) return;
  const paragraph = buffer.join(" ").replace(/\s+/g, " ").trim();
  if (paragraph) {
    currentEntry.paragraphs.push(formatParagraph(paragraph));
  }
  buffer = [];
}

function flushEntry() {
  flushParagraph();
  if (!currentEntry || !currentSection) return;
  if (currentEntry.profileLinks.length) {
    currentSection.entries.push({
      name: currentEntry.name,
      paragraphs: currentEntry.paragraphs,
      profileLinks: currentEntry.profileLinks,
    });
  }
  currentEntry = null;
}

for (const rawLine of lines) {
  const line = rawLine.trim();
  if (!line) {
    flushParagraph();
    continue;
  }
  if (/^#\s+/.test(line)) {
    flushEntry();
    result.title = strip(line.replace(/^#\s+/, ""));
    continue;
  }
  if (/^##\s+/.test(line)) {
    flushEntry();
    currentSection = { title: strip(line.replace(/^##\s+/, "")), entries: [] };
    result.sections.push(currentSection);
    continue;
  }
  if (/^\*\s+/.test(line)) {
    flushEntry();
    currentEntry = {
      name: strip(line.replace(/^\*\s+/, "")),
      paragraphs: [],
      profileLinks: [],
    };
    continue;
  }
  const profile = parseProfileLink(line);
  if (profile && currentEntry) {
    flushParagraph();
    currentEntry.profileLinks.push({
      label: profile.label,
      url: profile.url,
    });
    continue;
  }
  if (currentEntry) {
    buffer.push(line);
  }
}

flushEntry();

const output =
  "/** Static Tribute page content. Regenerate: node generate-tribute-data.mjs */\n" +
  "window.PORTFOLIO_TRIBUTE_CONTENT = " +
  JSON.stringify(result, null, 2) +
  ";\n";

fs.writeFileSync(outputPath, output, "utf8");

const entryCount = result.sections.reduce((count, section) => count + section.entries.length, 0);
console.log(`Generated ${outputPath}`);
console.log(`Title: ${result.title}`);
console.log(`Sections: ${result.sections.length}, entries: ${entryCount}`);
