"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

test("formal source, tools, tests and build configuration are not ignored", () => {
  const ignore = read(".gitignore");
  for (const forbidden of [
    /^data\/source\/?$/m,
    /^tools\/?$/m,
    /^tests\/?$/m,
    /^tsconfig\.json$/m,
    /^eslint\.config\.js$/m,
    /^playwright\.config\.js$/m,
    /^游戏地图和卡牌和表格\/?$/m,
    /^算子单位图标\/?$/m,
  ]) assert.doesNotMatch(ignore, forbidden);
  for (const transient of ["node_modules/", "test-results/", "dist/", "data/generated/"])
    assert.match(ignore, new RegExp(`^${transient.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
});

test("large formal PNG source directories use Git LFS", () => {
  const attributes = read(".gitattributes");
  for (const pattern of [
    "游戏地图和卡牌和表格/*.png",
    "算子单位图标/**/*.png",
    "国旗/**/*.png",
  ]) {
    assert.match(attributes, new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} filter=lfs diff=lfs merge=lfs -text$`, "m"));
  }
});

test("formal piece records never depend on ignored recovered artwork", () => {
  const pieces = JSON.parse(read("data/source/pieces.json"));
  for (const piece of pieces) {
    assert.doesNotMatch(String(piece.source || ""), /^assets\/source-recovered\//, piece.id);
    if (piece.source)
      assert.equal(fs.existsSync(path.join(root, piece.source)), true, `${piece.id}: ${piece.source}`);
  }
});

test("server package is an explicit runtime allowlist", () => {
  const packager = read("tools/package_server.mjs");
  assert.match(packager, /const runtimeEntries = \[/);
  assert.match(packager, /const runtimeAssetEntries = \[/);
  assert.match(packager, /"map\.webp"/);
  assert.match(packager, /"modules"/);
  assert.match(packager, /DEPLOYMENT\.json/);
  assert.doesNotMatch(packager, /"source-recovered"/);
  for (const excluded of ["tests", "tools", "data/source", "游戏地图和卡牌和表格", "算子单位图标"])
    assert.doesNotMatch(packager, new RegExp(`^[\\t ]*"${excluded.replace("/", "\\/")}"[,]?$`, "m"));
});

test("obsolete edge and Historical setup sidecars cannot return", () => {
  for (const file of [
    "data/source/edge_rules.json",
    "data/source/setup.json",
    "tools/freeze_setup_locations.mjs",
    "tools/render_setup_audit.py",
  ]) assert.equal(fs.existsSync(path.join(root, file)), false, file);
  const builder = read("tools/build_data.mjs");
  assert.match(builder, /\["edge_rules\.json", "setup\.json"\]/);
});
