"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")
const rules = require("../rules.js")

const role = (faction) =>
	faction === "cp" ? "Central Powers" : "Allied Powers"

test("front maintenance accepts printed cross-national RP conversions", () => {
	const state = rules.setup(1201)
	state.events.entry_tu = true
	state.fronts.russian = 0
	state.fronts.turkish = 0
	state.rp.cp.ge = 4
	state.rp.ap.br = 1

	assert.equal(rules._test.beginFrontMaintenance(state), true)
	let guard = 0
	while (state.pending_event?.kind === "front_maintenance" && guard++ < 40) {
		const actions = rules.view(state, role(state.active)).actions.event_choose
		const preferred =
			actions.find((choice) => choice === "pay:ge") ||
			actions.find((choice) => choice === "pay:br")
		assert.ok(preferred)
		rules.action(state, role(state.active), "event_choose", preferred)
	}
	assert.ok(guard < 40)
	assert.equal(state.rp.cp.ge, 0)
	assert.equal(state.rp.ap.br, 0)
	assert.equal(state.usage_limits["front_maintenance:1"], 1)
})

test("unpaid front maintenance offers a non-lethal unit reduction", () => {
	const state = rules.setup(1202)
	state.fronts.russian = 0
	state.fronts.turkish = 0
	for (const faction of ["ap", "cp"])
		for (const key of Object.keys(state.rp[faction])) state.rp[faction][key] = 0

	assert.equal(rules._test.beginFrontMaintenance(state), true)
	const choice = rules
		.view(state, "Central Powers")
		.actions.front_maintenance_loss[0]
	assert.ok(choice)
	const id = choice.split(":")[0]
	const unit =
		state.units.find((candidate) => candidate.id === id) ||
		state.reserves.cp.find((candidate) => candidate.id === id)
	assert.ok(unit)
	assert.equal(unit.reduced, false)
	rules.action(state, "Central Powers", "front_maintenance_loss", choice)
	assert.equal(unit.reduced, true)
})

test("Russian-front investment costs 4.5 EAST-equivalent RP", () => {
	const state = rules.setup(1203)
	state.state = "replacement"
	state.active = "cp"
	state.replacement_active = "cp"
	state.rp.cp = { east: 3, ge: 1, ah: 1 }
	state.mo.current.ge = []
	state.mo.completed.ge = []

	assert.deepEqual(rules.view(state, "Central Powers").actions.spend_front, ["russian"])
	assert.equal(
		rules.view(state, "Central Powers").action_labels.spend_front.russian,
		"推进俄国战线",
	)
	rules.action(state, "Central Powers", "spend_front", "russian")
	let guard = 0
	while (state.pending_event?.kind === "front_investment" && guard++ < 20) {
		const choice = rules
			.view(state, "Central Powers")
			.actions.event_choose.find((candidate) => candidate.startsWith("pay:"))
		assert.ok(choice)
		rules.action(state, "Central Powers", "event_choose", choice)
	}
	assert.ok(guard < 20)
	assert.equal(state.fronts.russian, 1)
	assert.equal(state.usage_limits["front:1:cp:russian"], 1)
	assert.deepEqual(state.rp.cp, { east: 0, ge: 0, ah: 0 })
})

test("incomplete front investment stores at most one front RP", () => {
	const state = rules.setup(1204)
	state.events.entry_tu = true
	state.state = "replacement"
	state.active = "ap"
	state.replacement_active = "ap"
	state.rp.ap = { br: 1.5, fr: 0, it: 0, us: 0 }

	rules.action(state, "Allied Powers", "spend_front", "turkish")
	rules.action(state, "Allied Powers", "event_choose", "pay:br")
	rules.action(state, "Allied Powers", "event_choose", "pay:br")
	const choices = rules.view(state, "Allied Powers").actions.event_choose
	assert.equal(choices.some((choice) => choice === "store"), true)
	assert.equal(choices.some((choice) => choice === "pay:br"), false)
	rules.action(state, "Allied Powers", "event_choose", "store")
	assert.equal(state.state, "replacement")
	assert.equal(state.front_storage.turkish, 1)
	assert.equal(state.rp.ap.br, 0.5)
	assert.equal(state.fronts.turkish, 0)
	assert.deepEqual(rules.view(state, "Allied Powers").actions.spend_front || [], [])
})

test("each faction may invest only in its own front", () => {
	const state = rules.setup(1205)
	state.events.entry_tu = true
	state.state = "replacement"
	state.active = "cp"
	state.rp.cp.east = 5
	const cpFronts = rules.view(state, "Central Powers").actions.spend_front
	assert.deepEqual(cpFronts, ["russian"])
	state.active = "ap"
	state.replacement_active = "ap"
	state.rp.ap.br = 3
	const apFronts = rules.view(state, "Allied Powers").actions.spend_front
	assert.deepEqual(apFronts, ["turkish"])
	assert.equal(
		rules.view(state, "Allied Powers").action_labels.spend_front.turkish,
		"推进土耳其战线",
	)
})

test("surplus EAST RP converts to GE or AH during CP replacement", () => {
	const state = rules.setup(1211)
	state.state = "replacement"
	state.phase = "补员/升级"
	state.active = "cp"
	state.replacement_active = "cp"
	state.rp.cp = { east: 2, ge: 0, ah: 0 }

	assert.deepEqual(
		rules.view(state, "Central Powers").actions.convert_east_rp,
		["ge", "ah"],
	)
	assert.equal(
		rules.view(state, "Central Powers").action_labels.convert_east_rp.ge,
		"1 EAST:RP → 1 GE:RP",
	)
	rules.action(state, "Central Powers", "convert_east_rp", "ge")
	assert.deepEqual(state.rp.cp, { east: 1, ge: 1, ah: 0 })
	rules.action(state, "Central Powers", "convert_east_rp", "ah")
	assert.deepEqual(state.rp.cp, { east: 0, ge: 1, ah: 2 })
	assert.equal(rules.view(state, "Central Powers").actions.convert_east_rp, undefined)
})

test("reserved EAST RP cannot be converted", () => {
	const state = rules.setup(1212)
	state.state = "replacement"
	state.phase = "补员/升级"
	state.active = "cp"
	state.replacement_active = "cp"
	state.rp.cp.east = 1
	state.mo.front_commitments = {
		"ge:reserved": {
			turn: state.turn,
			faction: "cp",
			processed: false,
			reserved_rp: { east: 1 },
		},
	}

	assert.equal(rules.view(state, "Central Powers").actions.convert_east_rp, undefined)
	rules.action(state, "Central Powers", "convert_east_rp", "ge")
	assert.deepEqual(state.rp.cp, { east: 1, ge: 0, ah: 0 })
})

test("front-track VP thresholds score in both directions", () => {
	const state = rules.setup(1206)
	const startingVp = state.vp
	state.fronts.russian = 1
	rules._test.moveFront(state, "russian", 1, "test")
	assert.equal(state.vp, startingVp + 1)
	rules._test.moveFront(state, "russian", -1, "test")
	assert.equal(state.vp, startingVp)

	state.fronts.turkish = 2
	rules._test.moveFront(state, "turkish", 1, "test")
	assert.equal(state.vp, startingVp - 1)
	rules._test.moveFront(state, "turkish", -1, "test")
	assert.equal(state.vp, startingVp)
})

test("attempts to move left of front position zero apply the printed VP", () => {
	const state = rules.setup(1207)
	const startingVp = state.vp
	rules._test.moveFront(state, "russian", -2, "test")
	assert.equal(state.fronts.russian, 0)
	assert.equal(state.vp, startingVp - 2)
	rules._test.moveFront(state, "turkish", -2, "test")
	assert.equal(state.fronts.turkish, 0)
	assert.equal(state.vp, startingVp)
})

test("Turkish position 2 pushes a Russian front below 2 one space left", () => {
	const state = rules.setup(1208)
	state.fronts.russian = 1
	state.fronts.turkish = 1
	rules._test.moveFront(state, "turkish", 1, "test")
	assert.equal(state.fronts.turkish, 2)
	assert.equal(state.fronts.russian, 0)
})

test("Turkish position 5 advances at turn end while the Russian front is below 4", () => {
	const state = rules.setup(1209)
	state.events.entry_tu = true
	state.fronts.russian = 3
	state.fronts.turkish = 5
	rules._test.applyFrontEndTurnEffects(state)
	assert.equal(state.fronts.turkish, 6)
	rules._test.applyFrontEndTurnEffects(state)
	assert.equal(state.fronts.turkish, 6)
})

test("Turkish collapse grants one British RP each turn", () => {
	const state = rules.setup(1210)
	state.events.entry_tu = true
	state.fronts.russian = 4
	state.fronts.turkish = 9
	state.rp.ap.br = 0
	rules._test.applyFrontEndTurnEffects(state)
	assert.equal(state.rp.ap.br, 1)
})

test("front positions 6 and 4 grant immediate, non-storable one-point SR in order", () => {
	const state = rules.setup(1211)
	state.events.entry_tu = true
	state.turn = 4
	state.fronts.russian = 6
	state.fronts.turkish = 4

	assert.equal(rules._test.beginFrontEndSr(state), true)
	assert.equal(state.state, "sr")
	assert.equal(state.active, "cp")
	assert.equal(state.sr.remaining, 1)
	assert.equal(state.sr.source, "front_end")

	rules.action(state, "Central Powers", "finish")
	assert.equal(state.state, "sr")
	assert.equal(state.active, "ap")
	assert.equal(state.sr.remaining, 1)

	rules.action(state, "Allied Powers", "finish")
	while (state.state === "draw_discard") {
		const role = state.active === "cp" ? "Central Powers" : "Allied Powers"
		rules.action(state, role, "done")
	}
	assert.equal(state.sr, null)
	assert.equal(state.turn, 5)
	assert.equal(state.usage_limits["front_sr:4:cp"], 1)
	assert.equal(state.usage_limits["front_sr:4:ap"], 1)
})

test("one point of front-track SR cannot move an LCU", () => {
	const state = rules.setup(1212)
	state.turn = 4
	state.fronts.russian = 6
	state.fronts.turkish = 0
	rules._test.beginFrontEndSr(state)
	const view = rules.view(state, "Central Powers")
	const armies = state.units
		.filter((unit) => unit.faction === "cp" && unit.type === "army")
		.map((unit) => unit.id)
	assert.equal(armies.some((id) => view.actions.select_sr_unit?.includes(id)), false)
})
