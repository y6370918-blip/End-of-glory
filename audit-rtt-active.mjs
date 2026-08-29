#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const allowed = path.normalize("modules/core/active-role.js");
const files = [path.join(root, "rules.js")];

function collect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(target);
    else if (entry.isFile() && entry.name.endsWith(".js")) files.push(target);
  }
}

collect(path.join(root, "modules"));

const violations = [];
for (const file of files) {
  const relative = path.relative(root, file);
  if (path.normalize(relative) === allowed) continue;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (let index = 0; index < lines.length; ++index) {
    if (/\bstate\.active\s*=(?!=)/.test(lines[index]))
      violations.push(`${relative}:${index + 1}: ${lines[index].trim()}`);
  }
}

if (violations.length) {
  console.error("Direct state.active assignments are forbidden; use setActiveFaction().");
  for (const violation of violations) console.error(`  ${violation}`);
  process.exitCode = 1;
} else {
  console.log("RTT active-role audit passed.");
}
