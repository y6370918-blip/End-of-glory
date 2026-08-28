"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")

const data = require("../data.js")
const scene = require("../piece-scene.js")

const apArmy = data.pieces.find((piece) => piece.faction === "ap" && piece.type === "army")
const apCorps = data.pieces.find((piece) => piece.faction === "ap" && piece.type === "corps")
const apHq = data.pieces.find((piece) => piece.faction === "ap" && piece.type === "hq")

function unit(id, piece, location = "paris", reduced = false) {
	return {
		id,
		piece: piece.id,
		faction: "ap",
		nation: piece.nation,
		type: piece.type,
		location,
		reduced,
		supplied: true
	}
}

function view(units = []) {
	return {
		units,
		reserves: { ap: [], cp: [] },
		upgrade_pool: { ap: [], cp: [] },
		eliminated: { ap: [], cp: [] },
		activations: {},
		selection: null
	}
}

function targets(pieces = [], spaces = []) {
	return {
		pieces: new Map(pieces.map((id) => [id, [{ action: "select_attacker", arg: id }]])),
		spaces: new Map(spaces.map((id) => [id, [{ action: "move", arg: id }]]))
	}
}

test("moving one stable unit dirties only its origin and destination stacks", () => {
	const firstView = view([unit("mover", apArmy)])
	const secondView = view([unit("mover", apArmy, "verdun")])
	const first = scene.buildScene(firstView, targets(), data)
	const second = scene.buildScene(secondView, targets(), data)
	assert.deepEqual(
		new Set(scene.diffScenes(first, second)),
		new Set([scene.mapStackKey("paris"), scene.mapStackKey("verdun")])
	)
})

test("selection and legal-piece changes dirty only the containing stack", () => {
	const base = view([unit("first", apArmy), unit("second", apCorps)])
	const selected = globalThis.structuredClone(base)
	selected.selection = { selected: ["second"] }
	const before = scene.buildScene(base, targets(), data)
	const after = scene.buildScene(selected, targets(["second"]), data)
	assert.deepEqual(new Set(scene.diffScenes(before, after)), new Set([scene.mapStackKey("paris")]))
})

test("activation counters and focus changes dirty only their affected map stacks", () => {
	const base = view([unit("first", apArmy)])
	const activated = globalThis.structuredClone(base)
	activated.activations = { paris: "move" }
	const before = scene.buildScene(base, targets(), data)
	const after = scene.buildScene(activated, targets(), data)
	assert.deepEqual(new Set(scene.diffScenes(before, after)), new Set([scene.mapStackKey("paris")]))
	assert.deepEqual(
		new Set(scene.diffScenes(after, after, scene.mapStackKey("paris"), scene.mapStackKey("verdun"))),
		new Set([scene.mapStackKey("paris"), scene.mapStackKey("verdun")])
	)
})

test("reserve face changes dirty the old and new stable reserve stacks", () => {
	const full = view()
	full.reserves.ap = [unit("reserve", apCorps, null, false)]
	const reduced = view()
	reduced.reserves.ap = [unit("reserve", apCorps, null, true)]
	const group = scene.reserveGroupByPiece[apCorps.id] || apCorps.nation
	const before = scene.buildScene(full, targets(), data)
	const after = scene.buildScene(reduced, targets(), data)
	assert.deepEqual(
		new Set(scene.diffScenes(before, after)),
		new Set([
			scene.reserveStackKey("ap", group, "full"),
			scene.reserveStackKey("ap", group, "reduced")
		])
	)
})

test("printed veteran pools use stable upgrade stacks and piece actions", () => {
	const upgrade = view()
	upgrade.upgrade_pool.ap = [unit("upgrade-fr-army", data.pieces.find((piece) => piece.id === "component-105"), null)]
	const built = scene.buildScene(upgrade, targets(["upgrade-fr-army"]), data)
	const key = scene.upgradeStackKey("ap", "component-105")
	assert.deepEqual(built.stacks.get(key).unitIds, ["upgrade-fr-army"])
	assert.equal(built.units.get("upgrade-fr-army").zone, "upgrade")
	assert.equal(built.units.get("upgrade-fr-army").legal, true)
})

test("PUG stack order keeps reduced below full, LCU below SCU, and HQ on top", () => {
	const stacked = view([
		unit("full-corps", apCorps),
		unit("full-army", apArmy),
		unit("hq", apHq),
		unit("reduced-corps", apCorps, "paris", true),
		unit("reduced-army", apArmy, "paris", true)
	])
	stacked.activations = { paris: "construct" }
	const built = scene.buildScene(stacked, targets(), data)
	const stack = built.stacks.get(scene.mapStackKey("paris"))
	assert.deepEqual(stack.unitIds, ["reduced-army", "full-army", "reduced-corps", "full-corps", "hq"])
	assert.deepEqual(stack.counterKinds, ["construct"])
})

test("a move activation places only the printed move marker", () => {
	const stacked = view([unit("army", apArmy)])
	stacked.activations = { paris: "move" }
	const built = scene.buildScene(stacked, targets(), data)
	assert.deepEqual(built.stacks.get(scene.mapStackKey("paris")).counterKinds, ["move"])
})

test("retreat distance choices remain piece targets and selected retreaters use server selection", () => {
	const retreatView = view([unit("retreater", apCorps)])
	retreatView.selection = { selected: ["retreater"] }
	const targetIndex = {
		pieces: new Map([["retreater", [
			{ action: "select_retreat_one", arg: "retreater" },
			{ action: "select_retreat_two", arg: "retreater" }
		]]]),
		spaces: new Map()
	}
	const built = scene.buildScene(retreatView, targetIndex, data)
	const frame = built.units.get("retreater")
	assert.equal(frame.selected, true)
	assert.deepEqual(frame.actionKinds, ["select_retreat_one", "select_retreat_two"])
	assert.equal(built.stacks.get(scene.mapStackKey("paris")).retreatCandidate, true)
})
