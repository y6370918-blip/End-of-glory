"use strict"

/* global structuredClone */

const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const { Window } = require("happy-dom")

const root = path.resolve(__dirname, "..")

function payload() {
	const spaces = [
		{ id: "a", name: "A", nation: "fr", faction: "ap", control: "ap", terrain: "clear", supply: false, port: false, ui: { x: 100, y: 100, w: 80, h: 80 } },
		{ id: "b", name: "B", nation: "ge", faction: "cp", control: "cp", terrain: "clear", supply: false, port: false, ui: { x: 400, y: 100, w: 80, h: 80 } }
	]
	const edges = [{ a: "a", b: "b", type: "land", modes: ["move", "attack"], factions: ["ap", "cp"] }]
	const regions = [
		{ id: "01_northwest", name: "一区" },
		{ id: "03_northeast", name: "三区" }
	]
	const mapAudit = {
		schema: 2,
		revision: 0,
		regions,
		region_reviews: {
			"01_northwest": { status: "pending", revision: null },
			"03_northeast": { status: "pending", revision: null }
		},
		spaces: {
			a: { region: "01_northwest", status: "pending", decision: "review" },
			b: { region: "03_northeast", status: "pending", decision: "review" }
		},
		edges: {
			"a|b": { regions: ["01_northwest", "03_northeast"], confirmed_regions: [], status: "pending", decision: "review" }
		}
	}
	return {
		spaces: structuredClone(spaces), edges: structuredClone(edges), ui: { tracks: {} },
		formal: { spaces, edges, ui: { tracks: {} } }, mapAudit,
		mapAuditReport: { counts: { pending_regions: 2, pending_spaces: 2, pending_edges: 1 } },
		baseRevision: "revision-1", editorProtocol: 5, modes: ["move", "attack", "supply", "sr", "retreat", "advance"],
		edgeTypes: ["land"], edgeFlags: ["alpine", "requires_land_attack_support"]
	}
}

test("map editor supports region focus, resize handles, edge hits, zoom, and layers", async () => {
	const window = new Window({ url: "http://127.0.0.1:8766/" })
	window.document.write(fs.readFileSync(path.join(root, "tools", "map-editor", "index.html"), "utf8"))
	window.EogMapEditorDiff = require("../tools/map-editor/diff.js")
	window.fetch = async () => ({ json: async () => payload() })
	window.confirm = () => true
	Object.defineProperty(window.document.getElementById("viewport"), "clientWidth", { value: 1200 })
	Object.defineProperty(window.document.getElementById("viewport"), "clientHeight", { value: 800 })
	window.eval(fs.readFileSync(path.join(root, "tools", "map-editor", "editor.js"), "utf8"))
	window.document.dispatchEvent(new window.Event("DOMContentLoaded"))
	await window.happyDOM.whenAsyncComplete()

	const region = window.document.getElementById("region-filter")
	region.value = "01_northwest"
	region.dispatchEvent(new window.Event("change"))
	assert.equal(window.document.getElementById("save").disabled, true)
	const space = window.document.querySelector('.space-object')
	space.click()
	assert.match(window.document.getElementById("selection").textContent, /ID：a/)
	assert.match(window.document.getElementById("selection").textContent, /VP地区/)
	assert.equal(window.document.querySelectorAll(".resize-handle").length, 8)
	const vpToggle = [...window.document.querySelectorAll('#selection input[type="checkbox"]')]
		.find((input) => input.parentElement.textContent.includes("VP地区"))
	assert.ok(vpToggle)
	vpToggle.checked = true
	vpToggle.dispatchEvent(new window.Event("change"))
	assert.ok([...window.document.querySelectorAll(".space-vp")].some((badge) => badge.textContent === "VP"))
	const centerX = window.document.querySelector('#selection input[type="number"]')
	centerX.value = "120"
	centerX.dispatchEvent(new window.Event("change"))
	assert.equal(window.document.getElementById("save").disabled, false)

	window.document.querySelector('[data-mode="edges"]').click()
	const hit = window.document.querySelector(".edge-hit")
	assert.ok(hit)
	hit.dispatchEvent(new window.Event("click", { bubbles: true }))
	assert.match(window.document.getElementById("selection").textContent, /a ↔ b/)
	assert.match(window.document.getElementById("selection").textContent, /跨河/)
	const edgeType = window.document.querySelector("#selection select")
	assert.deepEqual([...edgeType.options].map((option) => option.value), ["land"])

	const zoom = window.document.getElementById("zoom")
	zoom.value = "100"
	zoom.dispatchEvent(new window.Event("input"))
	assert.equal(window.document.getElementById("board").style.transform, "scale(1)")
	const names = window.document.getElementById("layer-names")
	names.checked = false
	names.dispatchEvent(new window.Event("change"))
	assert.equal(window.document.getElementById("board").classList.contains("hide-names"), true)
	window.close()
})

test("map editor creates a complete add proposal by clicking the map", async () => {
	const window = new Window({ url: "http://127.0.0.1:8766/" })
	const clientErrors = []
	window.addEventListener("error", (event) => clientErrors.push(event.error?.message || event.message))
	window.document.write(fs.readFileSync(path.join(root, "tools", "map-editor", "index.html"), "utf8"))
	window.EogMapEditorDiff = require("../tools/map-editor/diff.js")
	window.fetch = async () => ({ json: async () => payload() })
	Object.defineProperty(window.document.getElementById("viewport"), "clientWidth", { value: 1200 })
	Object.defineProperty(window.document.getElementById("viewport"), "clientHeight", { value: 800 })
	window.eval(fs.readFileSync(path.join(root, "tools", "map-editor", "editor.js"), "utf8"))
	window.document.dispatchEvent(new window.Event("DOMContentLoaded"))
	await window.happyDOM.whenAsyncComplete()
	const region = window.document.getElementById("region-filter")
	region.value = "01_northwest"
	region.dispatchEvent(new window.Event("change"))
	window.document.getElementById("create-space").click()
	const form = window.document.getElementById("space-form")
	form.elements.id.value = "new_space"
	form.elements.name.value = "New Space"
	form.elements.nation.value = "fr"
	form.elements.faction.value = "ap"
	form.elements.control.value = "ap"
	form.elements.terrain.value = "forest"
	form.elements.vp.checked = true
	form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }))
	assert.match(window.document.getElementById("audit-status").textContent, /在地图上点击/)
	assert.equal(window.document.getElementById("space-dialog").open, false)
	assert.equal(window.document.getElementById("placement-layer").hidden, false)
	const placementClick = new window.Event("click", { bubbles: true })
	Object.defineProperties(placementClick, { clientX: { value: 300 }, clientY: { value: 250 } })
	window.document.getElementById("placement-layer").dispatchEvent(placementClick)
	assert.deepEqual(clientErrors, [])
	assert.match(window.document.getElementById("audit-status").textContent, /已创建地块草稿/)
	const created = [...window.document.querySelectorAll(".space-object")].find((element) => element.textContent.includes("new_space"))
	assert.ok(created)
	assert.ok(created.querySelector(".space-vp"))
	assert.match(window.document.getElementById("selection").textContent, /审计：pending \/ add/)
	assert.match(window.document.getElementById("diff").textContent, /new_space/)
	window.close()
})
