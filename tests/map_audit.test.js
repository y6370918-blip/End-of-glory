"use strict"

const assert = require("node:assert/strict")
const crypto = require("node:crypto")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")

const root = path.resolve(__dirname, "..")
const source = path.join(root, "data", "source")
const spaces = JSON.parse(fs.readFileSync(path.join(source, "spaces.json"), "utf8"))
const edges = JSON.parse(fs.readFileSync(path.join(source, "edges.json"), "utf8"))
const manifest = JSON.parse(fs.readFileSync(path.join(source, "map_audit.json"), "utf8"))

test("map audit manifest is bound to the authoritative 6082 by 6000 map", () => {
	const map = fs.readFileSync(path.join(root, "assets", "map.png"))
	assert.equal(crypto.createHash("sha256").update(map).digest("hex"), manifest.map.sha256)
	assert.deepEqual([manifest.map.width, manifest.map.height], [6082, 6000])
	assert.equal(manifest.map.path, "assets/map.png")
	assert.equal(manifest.schema, 2)
	assert.equal(Number.isInteger(manifest.revision) && manifest.revision >= 0, true)
	assert.deepEqual(Object.keys(manifest.region_reviews).sort(), manifest.regions.map((region) => region.id).sort())
})

test("every formal space and connection has exactly one audit record", () => {
	assert.deepEqual(Object.keys(manifest.spaces).sort(), spaces.map((space) => space.id).sort())
	const keys = edges.map((edge) => [edge.a, edge.b].sort().join("|")).sort()
	const recorded = Object.entries(manifest.edges)
		.filter(([, record]) => record.decision !== "remove")
		.map(([key]) => key)
		.sort()
	assert.deepEqual(recorded, keys)
	for (const edge of edges) {
		const key = [edge.a, edge.b].sort().join("|")
		const regions = [...new Set([manifest.spaces[edge.a].region, manifest.spaces[edge.b].region])].sort()
		assert.deepEqual(manifest.edges[key].regions, regions, key)
		assert.notEqual(manifest.edges[key].decision, "remove", key)
	}
})

test("space proposals stay separate while pending and match formal data after save", () => {
	const proposed = Object.entries(manifest.spaces).filter(([, record]) => ["add", "update"].includes(record.decision))
	assert.ok(proposed.length > 0)
	for (const [id, record] of proposed) {
		const formal = spaces.find((space) => space.id === id)
		if (record.status === "pending") {
			for (const [key, value] of Object.entries(record.proposal || {}))
				assert.notDeepEqual(formal?.[key], value, `${id} proposal was written before approval`)
		} else {
			assert.ok(formal, id)
			for (const [key, value] of Object.entries(record.proposal || {}))
				assert.deepEqual(formal[key], value, `${id} saved proposal differs from formal data`)
		}
	}
})

test("map audit tools cannot batch-apply inferred coordinates or TTS setup", () => {
	const apply = fs.readFileSync(path.join(root, "tools", "apply_map_coordinate_audit.mjs"), "utf8")
	const seed = fs.readFileSync(path.join(root, "tools", "seed_source_data.mjs"), "utf8")
	const renderer = fs.readFileSync(path.join(root, "tools", "render_space_audit.py"), "utf8")
	assert.doesNotMatch(apply, /writeFile/)
	assert.match(apply, /read-only/)
	assert.match(seed, /Preserved manually audited/)
	assert.match(seed, /Historical setup is authoritative in rules\.js/)
	assert.doesNotMatch(renderer, /resize\(\(3041, 3000\)/)
	assert.match(renderer, /for mode in \("formal", "proposed", "confirmed"\)/)
	assert.match(renderer, /f"\{region_id\}-\{mode\}\.png"/)
	assert.match(renderer, /proposal if isinstance\(proposal, dict\) else \{\}/)
})

test("map editor exposes regional audit, adjacency, deletion, and semantic edge styles", () => {
	const html = fs.readFileSync(path.join(root, "tools", "map-editor", "index.html"), "utf8")
	const client = fs.readFileSync(path.join(root, "tools", "map-editor", "editor.js"), "utf8")
	const css = fs.readFileSync(path.join(root, "tools", "map-editor", "editor.css"), "utf8")
	const server = fs.readFileSync(path.join(root, "tools", "map_editor_server.mjs"), "utf8")
	assert.match(html, /id="region-filter"/)
	assert.match(html, /id="zoom"/)
	assert.match(html, /id="layer-proposed"/)
	assert.match(html, /id="create-space"/)
	assert.match(html, /id="space-form"/)
	assert.match(html, /保存全部修改/)
	assert.match(client, /当前邻接/)
	assert.match(client, /placeNewSpace/)
	assert.match(client, /decision: "add"/)
	assert.match(client, /删除这条连接/)
	assert.match(client, /record\.proposal = clone\(current \|\| formalEdge\(key\)\)/)
	assert.match(client, /edge-hit/)
	assert.match(client, /confirmed_regions/)
	assert.match(client, /baseRevision/)
	assert.match(css, /#edges \.edge-hit/)
	assert.match(css, /\.old-space-object/)
	assert.match(server, /Historical setup fingerprint changed/)
	assert.match(server, /baseRevision/)
	assert.match(server, /backupRoot/)
	assert.match(server, /renderMapAudit/)
	assert.match(client, /tmp\/map-audit 已更新/)
	assert.match(html, /连接图例/)
	assert.match(client, /跨河方向/)
	assert.match(client, /river_from/)
	for (const name of ["edge-difficult", "edge-alpine", "edge-river", "edge-ap-only", "edge-cp-only", "edge-no-attack", "edge-channel"])
		assert.match(css, new RegExp(name))
})
