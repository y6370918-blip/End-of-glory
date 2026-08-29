"use strict"

/* global structuredClone */

const test = require("node:test")
const assert = require("node:assert/strict")
const { execFileSync, spawnSync } = require("node:child_process")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

test("map editor accepts the authoritative map source and rejects unsafe edits", async () => {
	const { auditMapSource, auditSpaceDefinition } = await import("../tools/map_editor_audit.mjs")
	const source = path.join(__dirname, "..", "data", "source")
	const spaces = JSON.parse(fs.readFileSync(path.join(source, "spaces.json"), "utf8"))
	const edges = JSON.parse(fs.readFileSync(path.join(source, "edges.json"), "utf8"))
	const ui = JSON.parse(fs.readFileSync(path.join(source, "ui.json"), "utf8"))
	assert.equal(auditMapSource(spaces, edges, ui).ok, true)
	const invalid = structuredClone(edges)
	invalid[0].modes.push("range")
	assert.equal(auditMapSource(spaces, invalid, ui).ok, false)
	const outside = structuredClone(spaces)
	outside[0].ui.x = 6083
	assert.equal(auditMapSource(outside, edges, ui).ok, false)
	const newSpace = { id: "new_space", name: "New Space", nation: "fr", faction: "ap", control: "ap", terrain: "clear", supply: false, port: false, ui: { x: 100, y: 100, w: 184, h: 184 } }
	assert.deepEqual(auditSpaceDefinition(newSpace), [])
	assert.deepEqual(auditSpaceDefinition({ ...newSpace, vp: true }), [])
	assert.match(auditSpaceDefinition({ ...newSpace, vp: "yes" }).join("\n"), /vp必须为布尔值/)
	assert.ok(auditSpaceDefinition({ ...newSpace, id: "Bad ID", terrain: "ocean" }).length >= 2)
	const badSea = { edges: [{ a: "calais", b: "london", type: "sea", modes: ["move"], factions: ["ap"] }], mapAudit: { edges: { "calais|london": { proposal: { a: "calais", b: "london", type: "sea", modes: ["move"], factions: ["ap"] } } } } }
	assert.match(auditMapSource(spaces, badSea.edges, ui).errors.join("\n"), /类型无效/)
	assert.equal(badSea.edges[0].type, "sea")
	assert.equal(badSea.mapAudit.edges["calais|london"].proposal.type, "sea")
	const river = structuredClone(edges)
	const cleanRiverIndex = river.findIndex((edge) => edge.river == null && edge.river_from == null)
	assert.ok(cleanRiverIndex >= 0)
	river[cleanRiverIndex].river = true
	assert.equal(auditMapSource(spaces, river, ui).ok, true)
	river[cleanRiverIndex].river = "yes"
	assert.match(auditMapSource(spaces, river, ui).errors.join("\n"), /river.*布尔值/)
	delete river[cleanRiverIndex].river
	river[cleanRiverIndex].river_from = river[cleanRiverIndex].a
	assert.equal(auditMapSource(spaces, river, ui).ok, true)
	river[cleanRiverIndex].river_from = "not_an_endpoint"
	assert.match(auditMapSource(spaces, river, ui).errors.join("\n"), /跨河起点必须是连接端点/)
})

test("map editor reports field-level differences and supports source filters", () => {
	const { fieldDiff } = require("../tools/map-editor/diff.js")
	const before = { spaces: [{ id: "a", ui: { x: 1 } }], edges: [], ui: { tracks: {} } }
	const after = structuredClone(before)
	after.spaces[0].ui.x = 2
	after.ui.tracks.turn = { slots: [[1, 2]] }
	assert.deepEqual(fieldDiff(before, after, "spaces").map((entry) => entry.path), ["spaces.0.ui.x"])
	assert.deepEqual(fieldDiff(before, after, "ui").map((entry) => entry.path), ["ui.tracks.turn"])
})

test("map data can be built entirely from a staged source without touching live data", () => {
	const root = path.join(__dirname, "..")
	const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "eog-map-build-test-"))
	try {
		const stagedSource = path.join(temporary, "source")
		const stagedOutput = path.join(temporary, "data.js")
		fs.mkdirSync(stagedSource)
		for (const name of fs.readdirSync(path.join(root, "data", "source"))) {
			const source = path.join(root, "data", "source", name)
			if (fs.statSync(source).isFile()) fs.copyFileSync(source, path.join(stagedSource, name))
		}
		const stagedSpaces = JSON.parse(fs.readFileSync(path.join(stagedSource, "spaces.json"), "utf8"))
		stagedSpaces.push({ id: "test_brighton", name: "Test Brighton", nation: "br", faction: "ap", terrain: "clear", supply: false, port: true, ui: { x: 500, y: 500, w: 184, h: 184 }, control: "ap" })
		fs.writeFileSync(path.join(stagedSource, "spaces.json"), `${JSON.stringify(stagedSpaces, null, 2)}\n`)
		const stagedEdges = JSON.parse(fs.readFileSync(path.join(stagedSource, "edges.json"), "utf8"))
		for (const destination of ["london", "dieppe"])
			stagedEdges.push({ a: "test_brighton", b: destination, type: "land", modes: ["move", "attack", "supply", "sr", "retreat", "advance"], factions: ["ap", "cp"] })
		fs.writeFileSync(path.join(stagedSource, "edges.json"), `${JSON.stringify(stagedEdges, null, 2)}\n`)
		const liveBefore = fs.readFileSync(path.join(root, "data.js"), "utf8")
		execFileSync(process.execPath, [path.join(root, "tools", "build_data.mjs")], {
			cwd: root,
			env: { ...process.env, EOG_DATA_SOURCE_DIR: stagedSource, EOG_DATA_OUTPUT: stagedOutput },
			stdio: "pipe"
		})
		assert.equal(fs.existsSync(stagedOutput), true)
		assert.match(fs.readFileSync(stagedOutput, "utf8"), /"test_brighton"/)
		assert.equal(fs.readFileSync(path.join(root, "data.js"), "utf8"), liveBefore)
	} finally {
		fs.rmSync(temporary, { recursive: true, force: true })
	}
})

test("map editor refuses to start in production", () => {
	const root = path.join(__dirname, "..")
	const result = spawnSync(process.execPath, [path.join(root, "tools", "map_editor_server.mjs"), "0"], {
		cwd: root,
		env: { ...process.env, NODE_ENV: "production" },
		encoding: "utf8",
		windowsHide: true
	})
	assert.notEqual(result.status, 0)
	assert.match(`${result.stdout}${result.stderr}`, /disabled in production/)
})
