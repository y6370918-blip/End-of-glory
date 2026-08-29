"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")

const data = require("../data.js")
const rules = require("../rules.js")
const { setupGame } = require("./setup_game.js")

const CP_ROLE = "Central Powers"
const AP_ROLE = "Allied Powers"

function unit(id, piece, location, reduced = false) {
	return {
		id,
		piece: piece.id,
		faction: piece.faction,
		nation: piece.nation,
		type: piece.type,
		location,
		reduced,
		moved: false,
		attacked: false,
		supplied: true,
		limited_supply: false
	}
}

function replacementFixture({ supplied = true, reserves = [] } = {}) {
	const state = setupGame(12001)
	const armyPiece = data.pieces.find((piece) => piece.id === "component-016")
	const army = unit("replacement-army", armyPiece, "milan", true)
	army.supplied = supplied
	state.units = [army]
	state.reserves.ap = reserves
	state.eliminated.ap = []
	state.permanently_removed_units = []
	state.active = "ap"
	state.state = "combat_losses"
	state.combat = {
		attacker: "cp",
		attackers: [],
		defenders: [army.id],
		pending_side: "ap",
		remaining_loss: 1,
		mo_assignments: {},
		resolution_events: []
	}
	return { state, army }
}

test("a supplied destroyed LCU prefers a full reserve SCU and preserves its face", () => {
	const corpsPiece = data.pieces.find((piece) => piece.id === "component-015")
	const full = unit("replacement-full", corpsPiece, undefined, false)
	const reduced = unit("replacement-reduced", corpsPiece, undefined, true)
	delete full.location
	delete reduced.location
	const { state, army } = replacementFixture({ reserves: [reduced, full] })

	rules._test.reduceCombatUnit(state, army.id)
	assert.equal(state.eliminated.ap.some((entry) => entry.id === army.id), true)
	assert.equal(state.pending_replacement, null)
	const placed = state.units.find((entry) => entry.id === full.id)
	assert.equal(placed.location, "milan")
	assert.equal(placed.reduced, false)
	assert.equal(state.combat.resolution_events.at(-1).kind, "replace")
})

test("combat replacement recognizes unhydrated SCU records from the real reserve pool", () => {
	const setup = setupGame(120011)
	const reserve = setup.reserves.ap.find((entry) => entry.piece === "component-028")
	assert.ok(reserve)
	assert.equal(reserve.type, undefined)
	const { state, army } = replacementFixture({ reserves: [reserve] })
	const frenchArmy = data.pieces.find((piece) => piece.id === "component-026")
	army.piece = frenchArmy.id
	army.nation = frenchArmy.nation
	rules._test.reduceCombatUnit(state, army.id)
	const placed = state.units.find((entry) => entry.id === reserve.id)
	assert.ok(placed)
	assert.equal(placed.location, "milan")
	assert.equal(placed.type, "corps")
})

test("a supplied destroyed LCU without a reserve SCU stays in the eliminated pool", () => {
	const { state, army } = replacementFixture()
	rules._test.reduceCombatUnit(state, army.id)
	assert.equal(state.eliminated.ap.some((entry) => entry.id === army.id), true)
	assert.equal(state.permanently_removed_units.length, 0)
	assert.equal(state.pending_replacement, null)
})

test("a fully out-of-supply destroyed LCU is permanently removed and never replaced", () => {
	const corpsPiece = data.pieces.find((piece) => piece.id === "component-015")
	const reserve = unit("replacement-oos", corpsPiece, undefined, false)
	delete reserve.location
	const { state, army } = replacementFixture({ supplied: false, reserves: [reserve] })
	rules._test.reduceCombatUnit(state, army.id)
	assert.equal(state.eliminated.ap.some((entry) => entry.id === army.id), false)
	assert.equal(state.permanently_removed_units.some((entry) => entry.id === army.id), true)
	assert.equal(state.pending_replacement, null)
})

test("Turkey entry activates its front, while Churchill separately unlocks br-6", () => {
	const state = setupGame(12002)
	assert.equal(rules.view(state, CP_ROLE).fronts_active.turkish, false)
	assert.equal(rules._test.moBagDefinitions(state, "br").some((mo) => mo.id === "br-6"), false)

	state.active = "cp"
	state.state = "action_card"
	state.turn = 2
	state.hands.cp = [703]
	rules.action(state, CP_ROLE, "card_event", 703)
	assert.equal(state.events.entry_tu, true)
	assert.equal(state.fronts.turkish, 0)
	assert.equal(rules.view(state, CP_ROLE).fronts_active.turkish, true)
	assert.equal(rules._test.moBagDefinitions(state, "br").some((mo) => mo.id === "br-6"), false)

	state.active = "ap"
	state.state = "action_card"
	state.commitment.ap = "limited"
	state.hands.ap = [626]
	rules.action(state, "Allied Powers", "card_event", 626)
	rules.action(state, "Allied Powers", "event_choose", "front_only")
	assert.equal(rules._test.moBagDefinitions(state, "br").some((mo) => mo.id === "br-6"), true)
})

test("MO draws use the revised German and Austro-Hungarian entry schedule", () => {
	const state = setupGame(12003)
	state.turn = 1
	rules._test.drawMo(state)
	assert.equal(state.mo.current.ge.length, 2)
	assert.equal(state.mo.current.ah.length, 0)

	state.turn = 2
	rules._test.drawMo(state)
	assert.equal(state.mo.current.ge.length, 2)
	assert.equal(state.mo.current.ah.length, 0)
	assert.equal(rules._test.moBagDefinitions(state, "ge").some((mo) => mo.id === "ge-10"), false)

	state.events.entry_it = true
	state.events["cp_坦能堡的英雄"] = true
	rules._test.drawMo(state)
	assert.equal(state.mo.current.ah.length, 1)
	assert.equal(rules._test.moBagDefinitions(state, "ge").some((mo) => mo.id === "ge-10"), true)
})

test("a selected part of a stack moves as a locked group and can undo every step", () => {
	const state = setupGame(12004)
	const pieces = data.pieces.filter(
		(piece) => piece.faction === "cp" && piece.nation === "ge" && piece.type === "corps" && piece.movement >= 2
	)
	const first = unit("group-first", pieces[0], "essen")
	const second = unit("group-second", pieces[1] || pieces[0], "essen")
	const staying = unit("group-staying", pieces[2] || pieces[0], "essen")
	state.units = [first, second, staying]
	state.turn = 4
	state.active = "cp"
	state.state = "ops_move"
	state.ops = {
		remaining: 0,
		activated: ["essen"],
		activated_units: {},
		execution_phase: "move",
		moving: null,
		pending_siege: null,
		move_selection: null
	}
	state.activations = { essen: "move" }

	rules.action(state, CP_ROLE, "select_move_unit", first.id)
	rules.action(state, CP_ROLE, "select_move_unit", second.id)
	assert.deepEqual(state.ops.move_selection.selected, [first.id, second.id])
	const undoBeforeMovement = state.undo.length
	rules.action(state, CP_ROLE, "move", "dusseldorf")
	assert.equal(staying.location, "essen")
	assert.equal(first.location, "dusseldorf")
	assert.equal(second.location, "dusseldorf")

	assert.equal(rules.view(state, CP_ROLE).actions.drop_move_unit, undefined)
	rules.action(state, CP_ROLE, "move", "aachen")
	assert.equal(first.location, "aachen")
	assert.equal(second.location, "aachen")
	assert.equal(state.undo.length, undoBeforeMovement + 2)

	rules.action(state, CP_ROLE, "undo")
	assert.equal(state.units.find((entry) => entry.id === second.id).location, "dusseldorf")
	rules.action(state, CP_ROLE, "undo")
	assert.equal(state.units.find((entry) => entry.id === first.id).location, "essen")
	assert.equal(state.units.find((entry) => entry.id === second.id).location, "essen")
	assert.equal(state.state, "movement_units")
	assert.deepEqual(state.ops.move_selection.selected, [first.id, second.id])
})

test("a reserve-bound reinforcement SCU may deploy on the map or enter reserve", () => {
	const state = setupGame(12005)
	const beforeMap = state.units.length
	const beforeReserve = state.reserves.ap.length
	state.active = "ap"
	state.state = "action_card"
	state.hands.ap = [603]
	rules.action(state, "Allied Powers", "card_event", 603)

	let deployedOptional = false
	while (state.pending_event.index < state.pending_event.queue.length) {
		const actions = rules.view(state, "Allied Powers").actions
		if (actions.reinforcement_to_reserve && !deployedOptional) {
			assert.ok(actions.event_space.length)
			rules.action(state, "Allied Powers", "event_space", actions.event_space[0])
			deployedOptional = true
		} else if (actions.reinforcement_to_reserve) {
			rules.action(state, "Allied Powers", "reinforcement_to_reserve")
		} else {
			rules.action(state, "Allied Powers", "event_space", actions.event_space[0])
		}
	}
	rules.action(state, "Allied Powers", "event_confirm")
	assert.equal(state.units.length, beforeMap + 5)
	assert.equal(state.reserves.ap.length, beforeReserve + 6)
})

test("a reinforcement appears on the selected map space before event confirmation", () => {
	const state = setupGame(12006)
	state.active = "ap"
	state.state = "action_card"
	state.hands.ap = [603]
	rules.action(state, AP_ROLE, "card_event", 603)
	const destination = rules.view(state, AP_ROLE).actions.event_space[0]
	const committedCount = state.units.length
	rules.action(state, AP_ROLE, "event_space", destination)
	assert.equal(state.units.length, committedCount)
	const staged = rules.view(state, AP_ROLE).units.find(
		(entry) => entry.staged && entry.location === destination,
	)
	assert.ok(staged)

	while (state.pending_event.index < state.pending_event.queue.length) {
		const actions = rules.view(state, AP_ROLE).actions
		if (actions.reinforcement_to_reserve)
			rules.action(state, AP_ROLE, "reinforcement_to_reserve")
		else rules.action(state, AP_ROLE, "event_space", actions.event_space[0])
	}
	rules.action(state, AP_ROLE, "event_confirm")
	const committed = state.units.find((entry) => entry.id === staged.id)
	assert.ok(committed)
	assert.equal(committed.location, destination)
	assert.equal(committed.staged, undefined)
})
