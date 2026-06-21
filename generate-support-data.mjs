/**
 * Builds static support-data.js from Call for support/*.md.
 * Manual step only — deploy.ps1 does NOT run this script.
 *
 * Usage: node generate-support-data.mjs
 * Then commit support-data.js and deploy when ready.
 * The page is static — support-data.js is loaded as a plain <script>; the .md sources are never uploaded.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { escapeHtml } from "./md-utils.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const sourceDir = path.join(root, "Call for support");
const outputPath = path.join(root, "support-data.js");

function strip(text) {
  return String(text || "")
    .replace(/\*\*/g, "")
    .replace(/\\\./g, ".")
    .replace(/\\\)/g, ")")
    .replace(/\\"/g, '"')
    .trim();
}

function formatInline(text) {
  let out = escapeHtml(
    String(text || "")
      .replace(/\\\./g, ".")
      .replace(/\\\)/g, ")")
      .replace(/\\"/g, '"')
  );
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\*([^*]+)\*/g, "<strong>$1</strong>");
  out = out.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  );
  return out.trim();
}

function parseLinkLine(line) {
  const trimmed = line.trim();
  let match = trimmed.match(/^\*\*\[([^\]]+)\]\((.+)\)\*\*$/);
  if (match) {
    return { label: strip(match[1]), url: match[2].trim() };
  }
  match = trimmed.match(/^\[([^\]]+)\]\((.+)\)$/);
  if (match) {
    return { label: strip(match[1]), url: match[2].trim() };
  }
  return null;
}

function parseMarkdownFile(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const lines = text.split(/\r?\n/);
  let title = "";
  const blocks = [];
  let buffer = [];
  let listItems = [];

  function flushParagraph() {
    if (!buffer.length) return;
    const paragraph = buffer.join(" ").replace(/\s+/g, " ").trim();
    if (paragraph) {
      blocks.push({ type: "paragraph", html: formatInline(paragraph) });
    }
    buffer = [];
  }

  function flushList() {
    if (!listItems.length) return;
    blocks.push({ type: "list", items: listItems.map(formatInline) });
    listItems = [];
  }

  function pushLink(link) {
    const last = blocks[blocks.length - 1];
    if (last && last.type === "links") {
      last.links.push(link);
    } else {
      blocks.push({ type: "links", links: [link] });
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }
    if (/^#\s+/.test(line) && !title) {
      flushParagraph();
      flushList();
      title = strip(line.replace(/^#\s+/, ""));
      continue;
    }
    if (/^##\s+/.test(line)) {
      flushParagraph();
      flushList();
      blocks.push({ type: "h2", html: formatInline(line.replace(/^##\s+/, "")) });
      continue;
    }
    if (/^###\s+/.test(line)) {
      flushParagraph();
      flushList();
      blocks.push({ type: "h3", html: formatInline(line.replace(/^###\s+/, "")) });
      continue;
    }
    if (/^>\s*/.test(line)) {
      flushParagraph();
      flushList();
      blocks.push({ type: "blockquote", html: formatInline(line.replace(/^>\s*/, "")) });
      continue;
    }
    if (/^[*-]\s+/.test(line)) {
      flushParagraph();
      listItems.push(line.replace(/^[*-]\s+/, "").trim());
      continue;
    }
    const link = parseLinkLine(line);
    if (link) {
      flushParagraph();
      flushList();
      pushLink(link);
      continue;
    }
    buffer.push(line);
  }

  flushParagraph();
  flushList();

  return { title, blocks };
}

function findSectionLogo(mdFileName) {
  const base = mdFileName.replace(/\.md$/i, "");
  for (const ext of [".png", ".svg", ".jpg", ".jpeg", ".webp"]) {
    if (fs.existsSync(path.join(sourceDir, `${base}_logo${ext}`))) {
      return `Call for support/${base}_logo${ext}`;
    }
  }
  return null;
}

const mdFiles = fs
  .readdirSync(sourceDir)
  .filter((name) => name.toLowerCase().endsWith(".md"))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));

if (!mdFiles.length) {
  console.error("No markdown files found in Call for support/");
  process.exit(2);
}

const sections = mdFiles.map((name) => {
  const parsed = parseMarkdownFile(path.join(sourceDir, name));
  const logo = findSectionLogo(name);
  if (logo) parsed.logo = logo;
  return parsed;
});
const introSection = sections[0] || { title: "", blocks: [] };
const pageTitle = introSection.title || "Call for support";

const result = {
  pageTitle,
  introBlocks: introSection.blocks,
  sections: sections.slice(1),
};

const output =
  `/** Static Call for support page content (committed + deployed as-is).
 * Source: Call for support/*.md — not uploaded to the server.
 * Regenerate manually: node generate-support-data.mjs
 */
window.PORTFOLIO_SUPPORT_CONTENT = ${JSON.stringify(result, null, 2)};
`;

fs.writeFileSync(outputPath, output, "utf8");

console.log(`Generated ${outputPath}`);
console.log(`Page title: ${pageTitle}`);
console.log(`Intro blocks: ${introSection.blocks.length}`);
console.log(`Sections: ${result.sections.length}`);
