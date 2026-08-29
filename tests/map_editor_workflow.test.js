"use strict"

/* global structuredClone */

const assert = require("node:assert/strict")
const test = require("node:test")

async function fixture() {
	const manifestApi = await import("../tools/map_audit_manifest.mjs")
	const workflow = await import("../tools/map_editor_workflow.mjs")
	const spaces = [
		{ id: "a", name: "A", ui: { x: 100, y: 100, w: 40, h: 40 } },
		{ id: "b", name: "B", ui: { x: 3200, y: 100, w: 40, h: 40 } },
		{ id: "c", name: "C", ui: { x: 200, y: 100, w: 40, h: 40 } }
	]
	const edges = [{ a: "a", b: "b", type: "land", modes: ["move"], factions: ["ap", "cp"] }]
	const ui = { tracks: {} }
	const manifest = manifestApi.createAuditManifest({ spaces, edges, mapSha256: "abcd" })
	return { manifestApi, workflow, formal: { spaces, edges, ui }, manifest }
}

test("schema two preserves proposals outside formal map data", async () => {
	const { workflow, formal, manifest } = await fixture()
	manifest.spaces.a.decision = "update"
	manifest.spaces.a.proposal = { ui: { x: 150 } }
	const working = workflow.workingMap(formal, manifest)
	assert.equal(formal.spaces[0].ui.x, 100)
	assert.equal(working.spaces.find((space) => space.id === "a").ui.x, 150)
	assert.equal(workflow.commitConfirmedProposals(formal, manifest).spaces[0].ui.x, 100)
	manifest.spaces.a.status = "confirmed"
	assert.equal(workflow.commitConfirmedProposals(formal, manifest).spaces[0].ui.x, 150)
})

test("existing spaces can add and remove the formal VP attribute", async () => {
	const { workflow, formal, manifest } = await fixture()
	const draft = structuredClone(formal)
	draft.spaces[0].vp = true
	const reconciled = workflow.reconcileDraftManifest(formal, manifest, structuredClone(manifest), draft)
	assert.deepEqual(reconciled.errors, [])
	assert.deepEqual(reconciled.manifest.spaces.a.proposal, { vp: true })
	assert.deepEqual(workflow.auditMultiRegionScopeErrors(manifest, reconciled.manifest, ["01_northwest"]), [])
	const prepared = workflow.prepareMultiRegionSave(reconciled.manifest, ["01_northwest"], formal)
	const committed = workflow.commitConfirmedProposals(formal, prepared)
	assert.equal(committed.spaces.find((space) => space.id === "a").vp, true)

	const nextManifest = structuredClone(manifest)
	nextManifest.spaces.a.status = "confirmed"
	nextManifest.spaces.a.decision = "update"
	nextManifest.spaces.a.proposal = { vp: false }
	const formalWithVp = { ...formal, spaces: formal.spaces.map((space) => space.id === "a" ? { ...space, vp: true } : space) }
	assert.equal(workflow.commitConfirmedProposals(formalWithVp, nextManifest).spaces.find((space) => space.id === "a").vp, undefined)
})

test("directional river proposals survive draft and confirmed commits", async () => {
	const { workflow, formal, manifest } = await fixture()
	const record = manifest.edges["a|b"]
	record.decision = "update"
	record.proposal = { ...formal.edges[0], river_from: "a" }
	assert.equal(workflow.workingMap(formal, manifest).edges[0].river_from, "a")
	assert.equal(workflow.commitConfirmedProposals(formal, manifest).edges[0].river_from, undefined)
	record.status = "confirmed"
	record.confirmed_regions = [...record.regions]
	assert.equal(workflow.commitConfirmedProposals(formal, manifest).edges[0].river_from, "a")
})

test("cross-region edge proposals require confirmation from both regions", async () => {
	const { workflow, formal, manifest } = await fixture()
	const record = manifest.edges["a|b"]
	record.decision = "remove"
	record.proposal = null
	record.confirmed_regions = ["01_northwest"]
	record.status = "pending"
	assert.equal(workflow.workingMap(formal, manifest).edges.length, 0)
	assert.equal(workflow.commitConfirmedProposals(formal, manifest).edges.length, 1)
	record.confirmed_regions.push("03_northeast")
	record.status = "confirmed"
	assert.equal(workflow.commitConfirmedProposals(formal, manifest).edges.length, 0)
})

test("region confirmation rejects undecided, disputed, and locally unconfirmed records", async () => {
	const { workflow, manifest } = await fixture()
	assert.ok(workflow.regionReviewErrors(manifest, "01_northwest").some((error) => error.includes("尚未决定")))
	for (const record of Object.values(manifest.spaces).filter((value) => value.region === "01_northwest")) {
		record.decision = "keep"
		record.status = "confirmed"
	}
	for (const record of Object.values(manifest.edges).filter((value) => value.regions.includes("01_northwest"))) {
		record.decision = "keep"
		record.confirmed_regions.push("01_northwest")
	}
	manifest.region_reviews["01_northwest"].status = "confirmed"
	assert.deepEqual(workflow.regionReviewErrors(manifest, "01_northwest"), [])
})

test("region saves reject stale revisions and changes outside the selected region", async () => {
	const { workflow, manifest } = await fixture()
	const incoming = structuredClone(manifest)
	incoming.spaces.b.note = "outside"
	assert.ok(workflow.auditScopeErrors(manifest, incoming, "01_northwest").some((error) => error.includes("超出当前区域")))
	incoming.spaces.b = structuredClone(manifest.spaces.b)
	incoming.revision += 1
	assert.ok(workflow.auditScopeErrors(manifest, incoming, "01_northwest").some((error) => error.includes("过期")))
})

test("one atomic save accepts and commits changes from multiple regions", async () => {
	const { workflow, formal, manifest } = await fixture()
	const incoming = structuredClone(manifest)
	incoming.spaces.a.decision = "update"
	incoming.spaces.a.status = "pending"
	incoming.spaces.a.proposal = { ui: { x: 140 } }
	incoming.spaces.b.decision = "update"
	incoming.spaces.b.status = "pending"
	incoming.spaces.b.proposal = { ui: { x: 3300 } }
	const regions = workflow.changedRegions(incoming, formal)
	assert.deepEqual(regions, ["01_northwest", "03_northeast"])
	assert.deepEqual(workflow.auditMultiRegionScopeErrors(manifest, incoming, regions), [])
	const prepared = workflow.prepareMultiRegionSave(incoming, regions, formal)
	const committed = workflow.commitConfirmedProposals(formal, prepared)
	assert.equal(committed.spaces.find((space) => space.id === "a").ui.x, 140)
	assert.equal(committed.spaces.find((space) => space.id === "b").ui.x, 3300)
})

test("stale audit proposals are rebuilt from the visible multi-region draft", async () => {
	const { workflow, formal, manifest } = await fixture()
	const draft = structuredClone(formal)
	draft.spaces.find((space) => space.id === "a").ui.x = 155
	draft.edges.push({ a: "b", b: "c", type: "land", modes: ["move"], factions: ["ap", "cp"] })
	const stale = structuredClone(manifest)
	stale.spaces.a.status = "pending"
	stale.spaces.a.decision = "keep"
	const result = workflow.reconcileDraftManifest(formal, manifest, stale, draft)
	assert.deepEqual(result.errors, [])
	assert.equal(result.manifest.spaces.a.decision, "update")
	assert.deepEqual(result.manifest.spaces.a.proposal, { ui: draft.spaces.find((space) => space.id === "a").ui })
	assert.equal(result.manifest.edges["b|c"].decision, "add")
	assert.deepEqual(result.manifest.edges["b|c"].regions, ["01_northwest", "03_northeast"])
	const regions = workflow.changedRegions(result.manifest, formal)
	const prepared = workflow.prepareMultiRegionSave(result.manifest, regions, formal)
	const committed = workflow.commitConfirmedProposals(formal, prepared)
	assert.equal(committed.spaces.find((space) => space.id === "a").ui.x, 155)
	assert.ok(committed.edges.some((edge) => [edge.a, edge.b].sort().join("|") === "b|c"))
})

test("draft reconciliation still rejects protected space-rule changes", async () => {
	const { workflow, formal, manifest } = await fixture()
	const draft = structuredClone(formal)
	draft.spaces[0].terrain = "mountain"
	const result = workflow.reconcileDraftManifest(formal, manifest, structuredClone(manifest), draft)
	assert.ok(result.errors.some((error) => error.includes("只能修改点击框")))
})

test("draft reconciliation preserves historical removed-edge audit records", async () => {
	const { workflow, formal, manifest } = await fixture()
	manifest.edges["old|removed"] = {
		regions: ["01_northwest"], confirmed_regions: ["01_northwest"],
		status: "confirmed", decision: "remove", proposal: null
	}
	const result = workflow.reconcileDraftManifest(formal, manifest, structuredClone(manifest), structuredClone(formal))
	assert.deepEqual(result.errors, [])
	assert.equal(result.manifest.edges["old|removed"].decision, "remove")
})

test("space proposals cannot alter terrain, names, or other rule data", async () => {
	const { workflow, manifest } = await fixture()
	const incoming = structuredClone(manifest)
	incoming.spaces.a.decision = "update"
	incoming.spaces.a.proposal = { terrain: "mountain", ui: { x: 120 } }
	assert.ok(workflow.auditScopeErrors(manifest, incoming, "01_northwest").some((error) => error.includes("只能修改点击框")))
})

test("a previously saved add record does not block later regional saves", async () => {
	const { workflow, manifest } = await fixture()
	manifest.spaces.b.decision = "add"
	manifest.spaces.b.status = "confirmed"
	manifest.spaces.b.proposal = {
		id: "b", name: "B", ui: { x: 3200, y: 100, w: 40, h: 40 }
	}
	const incoming = structuredClone(manifest)
	incoming.spaces.a.decision = "update"
	incoming.spaces.a.proposal = { ui: { x: 120 } }
	assert.equal(workflow.auditScopeErrors(manifest, incoming, "01_northwest").some((error) => error.includes("现有地块只能修改点击框：b")), false)
})

test("a confirmed add proposal creates a complete formal space", async () => {
	const { workflow, formal, manifest } = await fixture()
	const added = {
		id: "new_space", name: "New Space", nation: "fr", faction: "ap", control: "ap",
		terrain: "clear", supply: false, port: false, ui: { x: 240, y: 240, w: 184, h: 184 }
	}
	manifest.spaces.new_space = {
		region: "01_northwest", status: "confirmed", decision: "add", proposal: structuredClone(added)
	}
	assert.deepEqual(workflow.workingMap(formal, manifest).spaces.find((space) => space.id === "new_space"), added)
	assert.deepEqual(workflow.commitConfirmedProposals(formal, manifest).spaces.find((space) => space.id === "new_space"), added)
})

test("a new space must be an add proposal in the selected region", async () => {
	const { workflow, manifest } = await fixture()
	const incoming = structuredClone(manifest)
	incoming.spaces.new_space = {
		region: "03_northeast", status: "pending", decision: "add",
		proposal: { id: "new_space", name: "New Space", ui: { x: 200, y: 200, w: 80, h: 80 } }
	}
	assert.ok(workflow.auditScopeErrors(manifest, incoming, "01_northwest").some((error) => error.includes("本区add提议")))
})

test("saving a region automatically confirms only changed records", async () => {
	const { workflow, formal, manifest } = await fixture()
	manifest.spaces.a.decision = "update"
	manifest.spaces.a.proposal = { ui: { x: 140 } }
	manifest.edges["a|b"].decision = "remove"
	manifest.edges["a|b"].proposal = null
	assert.equal(workflow.regionHasChanges(manifest, "01_northwest"), true)
	const saved = workflow.prepareRegionSave(manifest, "01_northwest")
	assert.equal(saved.spaces.a.status, "confirmed")
	assert.equal(saved.spaces.c.status, "pending")
	assert.deepEqual(saved.edges["a|b"].confirmed_regions, ["01_northwest", "03_northeast"])
	assert.equal(saved.edges["a|b"].status, "confirmed")
	assert.equal(saved.region_reviews["01_northwest"].status, "pending")
	const committed = workflow.commitConfirmedProposals(formal, saved)
	assert.equal(workflow.regionHasChanges(saved, "01_northwest", committed), false)
})

test("editing a cross-region edge may invalidate the other region for re-review", async () => {
	const { workflow, manifest } = await fixture()
	const incoming = structuredClone(manifest)
	manifest.region_reviews["03_northeast"] = { status: "confirmed", revision: 1 }
	incoming.region_reviews["03_northeast"] = { status: "pending", revision: null }
	incoming.edges["a|b"].decision = "remove"
	incoming.edges["a|b"].proposal = null
	assert.equal(workflow.auditScopeErrors(manifest, incoming, "01_northwest").some((error) => error.includes("其他区域状态")), false)
})

test("source revisions include formal data and audit decisions", async () => {
	const { workflow, formal, manifest } = await fixture()
	const before = workflow.sourceRevision({ ...formal, manifest })
	manifest.spaces.a.note = "checked"
	const after = workflow.sourceRevision({ ...formal, manifest })
	assert.notEqual(after, before)
})
