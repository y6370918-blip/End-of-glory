"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const root = join(__dirname, "..");

function historicalSetupText() {
  const source = readFileSync(join(root, "rules.js"), "utf8");
  const start = source.indexOf("function set_up_historical_scenario()");
  assert.notEqual(start, -1, "Historical setup function must remain in rules.js");
  const brace = source.indexOf("{", start);
  let depth = 0;
  for (let index = brace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}" && --depth === 0)
      return source.slice(start, index + 1);
  }
  throw new Error("Historical setup function is incomplete");
}

test("data builds preserve the hand-maintained Historical setup byte for byte", () => {
  const before = historicalSetupText();
  execFileSync(process.execPath, [join(root, "tools", "build_data.mjs")], {
    cwd: root,
    stdio: "pipe",
  });
  assert.equal(historicalSetupText(), before);
});

