"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")

const data = require("../data.js")
const rules = require("../rules.js")
const { setupGame } = require("./setup_game.js")

const AP = "Allied Powers"
const CP = "Central Powers"

function card(id) {
	return data.cards.find((entry) => entry.id === id)
}

function prepareEvent(id, seed = id) {
	const state = setupGame(seed)
	state.turn = 10
	state.active = "ap"
	state.state = "action_card"
	state.phase = "行动阶段"
	state.commitment.ap = "total"
	state.hands.ap = [id]
	state.decks.ap = state.decks.ap.filter((entry) => entry !== id)
	return state
}

function clearMo(state) {
	for (const nation of Object.keys(state.mo.current)) state.mo.current[nation] = []
}

function finishReinforcement(state) {
	let guard = 0
	while (state.pending_event?.kind === "reinforcement") {
		assert.ok(guard++ < 40)
		const actions = rules.view(state, AP).actions
		if (actions.reinforcement_to_reserve)
			rules.action(state, AP, "reinforcement_to_reserve")
		else if (actions.event_space?.length)
			rules.action(state, AP, "event_space", actions.event_space[0])
		else
			rules.action(state, AP, "event_confirm")
	}
}

function attackFixture(seed, { italian = false, twoOrigins = false } = {}) {
	const state = setupGame(seed)
	clearMo(state)
	const spaces = new Map(data.spaces.map((space) => [space.id, space]))
	let target
	let origins
	for (const space of data.spaces) {
		if (italian && rules._test.multinationalAttackValid &&
			!(space.nation === "it" || space.theater === "italian")) continue
		const neighbors = data.edges
			.filter((edge) => (edge.modes || []).includes("attack") &&
				(edge.factions || []).includes("ap") &&
				(edge.a === space.id || edge.b === space.id))
			.map((edge) => edge.a === space.id ? edge.b : edge.a)
		if (neighbors.length >= (twoOrigins ? 2 : 1)) {
			target = space.id
			origins = neighbors.slice(0, twoOrigins ? 2 : 1)
			break
		}
	}
	assert.ok(target)
	const nations = twoOrigins ? ["it", "fr"] : ["fr"]
	const attackers = origins.map((origin, index) => {
		const piece = data.pieces.find((entry) => entry.faction === "ap" &&
			entry.nation === nations[index] && entry.type === "corps")
		assert.ok(piece)
		return {
			id: `attacker-${seed}-${index}`,
			piece: piece.id,
			faction: "ap",
			nation: piece.nation,
			type: piece.type,
			location: origin,
			reduced: false,
			attack_eligible: true,
			supplied: true,
		}
	})
	const defenderPiece = data.pieces.find((entry) => entry.faction === "cp" &&
		entry.nation === (italian ? "ah" : "ge") && entry.type === "corps")
	assert.ok(defenderPiece)
	const defender = {
		id: `defender-${seed}`,
		piece: defenderPiece.id,
		faction: "cp",
		nation: defenderPiece.nation,
		type: defenderPiece.type,
		location: target,
		reduced: false,
		supplied: true,
	}
	state.units = [...attackers, defender]
	if (italian) state.events.entry_it = true
	state.active = "ap"
	state.activations = Object.fromEntries(origins.map((space) => [space, "attack"]))
	state.ops = {
		card: 640,
		total: 4,
		remaining: 4,
		activated: origins.slice(),
		attack_selection: attackers.map((unit) => unit.id),
		pending_attack: {
			attackers: attackers.map((unit) => unit.id),
			target,
			flank: false,
			mo_assignments: {},
			mo_decisions: {},
		},
		forced_attacks: [],
	}
	state.state = "attack_mo"
	return { state, attackers, defender, target, origins, spaces }
}

test("640 Royal Tank Corps is an explicit one-combat trench choice and survives cancellation until dice", () => {
	const event = prepareEvent(640, 6401)
	rules.action(event, AP, "card_event", 640)
	assert.equal(event.state, "ops_activate")
	assert.equal(event.discard.ap.includes(640), true)
	assert.equal(event.removed.ap.includes(640), false)

	const { state, attackers, defender, target } = attackFixture(6402)
	state.events[card(640).event] = {
		turn: state.turn,
		duration: "action_round",
		expires: "action_round",
	}
	state.trenches[target] = 2
	state.fortifications[target] = 2
	rules._test.advanceDeterministicStates(state)
	assert.equal(state.state, "optional_combat_event")
	assert.ok(rules.view(state, AP).actions.event_choose.includes("640:use"))
	rules.action(state, AP, "event_choose", "640:use")
	const declaration = state.combat_window.declaration
	const modifiers = rules._test.combatModifiers(state, declaration, attackers, [defender])
	assert.equal(modifiers.ignore_trench, true)
	assert.equal(modifiers.ignore_fortification, false)
	const key = `optional_combat_event:640:${state.turn}:${state.action_round}`
	assert.equal(Boolean(state.usage_limits[key]), false)
})

test("641 Armando Diaz waives the POG multinational origin rule and deploys the unique HQ once", () => {
	const { state, attackers, defender } = attackFixture(6411, { italian: true, twoOrigins: true })
	const declaration = state.ops.pending_attack
	declaration.optional_events_resolved = true
	assert.throws(() => rules._test.validateAttackDeclaration(state, declaration), /multinational/)
	delete declaration.optional_events_resolved
	state.events[card(641).event] = {
		turn: state.turn,
		duration: "until_used",
		first_play: true,
	}
	rules._test.advanceDeterministicStates(state)
	assert.equal(state.state, "attack_mode")
	rules.action(state, AP, "regular_attack")
	assert.equal(state.state, "optional_combat_event")
	rules.action(state, AP, "event_choose", "641:use")
	const spaces = rules.view(state, AP).actions.event_space
	assert.ok(spaces.length)
	rules.action(state, AP, "event_space", spaces[0])
	const window = state.combat_window
	const diaz = state.units.filter((unit) => unit.piece === "component-003")
	assert.equal(diaz.length, 1)
	assert.ok(window.declaration.attackers.includes(diaz[0].id))
	const modifiers = rules._test.combatModifiers(
		state,
		window.declaration,
		[...attackers, diaz[0]],
		[defender],
	)
	assert.equal(modifiers.ignore_trench, true)
	assert.equal(modifiers.ignore_natural_terrain, true)
})

test("642 Greek Entry moves the Turkish front only when Salonika and Turkish entry are both active", () => {
	const inactive = prepareEvent(642, 6421)
	inactive.events[card(653).event] = { duration: "game" }
	const inactiveFront = inactive.fronts.turkish
	rules.action(inactive, AP, "card_event", 642)
	assert.equal(inactive.fronts.turkish, inactiveFront)
	assert.equal(inactive.vp, 9)

	const active = prepareEvent(642, 6422)
	active.events[card(653).event] = { duration: "game" }
	active.events.entry_tu = true
	const front = active.fronts.turkish
	rules.action(active, AP, "card_event", 642)
	assert.equal(active.fronts.turkish, front + 1)
})

test("643 Convoy separates its action effect from the four-point naval event", () => {
	const action = prepareEvent(643, 6431)
	const points = action.naval.points.ap
	rules.action(action, AP, "card_event", 643)
	assert.equal(action.naval.points.ap, points)
	assert.equal(action.vp, 9)
	assert.ok(action.events[card(643).event])

	const naval = setupGame(6432)
	naval.commitment.ap = "total"
	naval.state = "naval_choice"
	naval.active = "cp"
	naval.naval.selections = {}
	naval.naval.points = { ap: 0, cp: 0 }
	naval.naval.event_queue = []
	naval.hands.cp = []
	naval.hands.ap = [643]
	rules.action(naval, CP, "naval_empty_fleet")
	rules.action(naval, AP, "naval_event", 643)
	assert.equal(naval.naval.points.ap, 4)
})

test("644 Brusilov moves only the Russian front and unlocks Romania", () => {
	const state = prepareEvent(644, 6441)
	state.fronts.russian = 5
	const units = state.units.length
	rules.action(state, AP, "card_event", 644)
	assert.equal(state.fronts.russian, 3)
	assert.equal(state.units.length, units)
	const romania = prepareEvent(648, 6442)
	romania.fronts.russian = 4
	romania.events[card(644).event] = { duration: "instant" }
	assert.equal(rules.view(romania, AP).actions.card_event.includes(648), true)
})

test("645 Reserve Army deploys every printed reinforcement and prohibits Shell Shortage", () => {
	const state = prepareEvent(645, 6451)
	const before = Object.fromEntries([
		"component-093", "component-099", "component-094", "component-100",
	].map((piece) => [piece, [...state.units, ...state.reserves.ap]
		.filter((unit) => unit.piece === piece).length]))
	const upgradeBefore = Object.fromEntries(["component-091", "component-092"]
		.map((piece) => [piece, state.upgrade_pool.ap.filter((unit) => unit.piece === piece).length]))
	rules.action(state, AP, "card_event", 645)
	finishReinforcement(state)
	const pools = [...state.units, ...state.reserves.ap]
	assert.equal(pools.filter((unit) => unit.piece === "component-093").length - before["component-093"], 2)
	assert.equal(pools.filter((unit) => unit.piece === "component-099").length - before["component-099"], 1)
	assert.equal(pools.filter((unit) => unit.piece === "component-094").length - before["component-094"], 2)
	assert.equal(pools.filter((unit) => unit.piece === "component-100").length - before["component-100"], 2)
	assert.equal(state.upgrade_pool.ap.filter((unit) => unit.piece === "component-091").length - upgradeBefore["component-091"], 1)
	assert.equal(state.upgrade_pool.ap.filter((unit) => unit.piece === "component-092").length - upgradeBefore["component-092"], 1)
	const shortage = prepareEvent(731, 6452)
	shortage.events[card(645).event] = { duration: "instant" }
	assert.equal(rules._test.eventLegal(shortage, card(731)), false)
})

test("646 AEF pays the entry gap before its printed VP and places each later SCU independently", () => {
	const state = prepareEvent(646, 6461)
	state.war_status.combined = 7
	state.entry_tracks.us = 2
	const navalPreview = setupGame(6460)
	navalPreview.commitment.ap = "total"
	navalPreview.active = "ap"
	navalPreview.state = "naval_choice"
	navalPreview.hands.ap = [646]
	navalPreview.war_status.combined = 7
	navalPreview.entry_tracks.us = 2
	const preview = rules.view(navalPreview, AP)
	assert.equal(preview.action_labels.naval_event[646], "事件（+3 VP）")
	rules.action(state, AP, "card_event", 646)
	finishReinforcement(state)
	assert.equal(state.vp, 12)
	assert.equal(state.units.filter((unit) => unit.piece === "component-012").length, 1)
	assert.equal(state.units.filter((unit) => unit.piece === "component-103").length, 1)

	state.turn = 9
	delete state.usage_limits["aef_replacements:9"]
	assert.equal(rules._test.applyRecurringReinforcements(state), true)
	rules.action(state, AP, "reinforcement_to_reserve")
	const destination = rules.view(state, AP).actions.event_space[0]
	assert.ok(destination)
	rules.action(state, AP, "event_space", destination)
	assert.ok(rules.view(state, AP).units.some((unit) => unit.staged && unit.location === destination))
	rules.action(state, AP, "reinforcement_to_reserve")
	rules.action(state, AP, "event_confirm")
	assert.equal(state.reserves.ap.filter((unit) => unit.piece === "component-103").length, 2)
})

test("647 Clemenceau enforces its timing, adds French MO, and stores recurring armistice and end VP", () => {
	const blocked = prepareEvent(647, 6471)
	blocked.war_status.combined = 27
	assert.equal(rules.view(blocked, AP).actions.card_event?.includes(647) || false, false)
	const late = prepareEvent(647, 6472)
	late.turn = 12
	late.war_status.combined = 28
	assert.equal(rules.view(late, AP).actions.card_event?.includes(647) || false, false)
	const state = prepareEvent(647, 6473)
	state.turn = 11
	state.war_status.combined = 28
	rules.action(state, AP, "card_event", 647)
	assert.equal(state.mo.pool.fr.filter((entry) => entry.source_card === 647).length, 2)
	assert.equal(state.mo.draw_bonus.fr, 1)
	assert.equal(state.events[card(647).event].end_vp, -2)
	const track = state.entry_tracks.armistice
	rules._test.applyWarStatusEntryTracks(state)
	assert.equal(state.entry_tracks.armistice, track + 1)
})

test("648 Romanian Entry accepts either Brusilov or a Russian front at three", () => {
	const blocked = prepareEvent(648, 6481)
	blocked.fronts.russian = 4
	assert.equal(rules.view(blocked, AP).actions.card_event?.includes(648) || false, false)
	const front = prepareEvent(648, 6482)
	front.fronts.russian = 3
	rules.action(front, AP, "card_event", 648)
	assert.equal(front.fronts.russian, 2)
	assert.equal(front.vp, 9)
})

test("649 Pershing reinforcement separates event rewards from its OPS-only combat modifier", () => {
	const state = prepareEvent(649, 6491)
	state.events[card(646).event] = { duration: "game" }
	rules.action(state, AP, "card_event", 649)
	finishReinforcement(state)
	assert.equal(state.units.filter((unit) => unit.piece === "component-102").length, 3)
	assert.equal(state.mo.pool.us.filter((entry) => entry.source_card === 649).length, 1)
	assert.equal(state.mo.draw_count.us, 1)

	const ops = prepareEvent(649, 6492)
	ops.events[card(646).event] = { duration: "game" }
	rules.action(ops, AP, "card_ops", 649)
	assert.equal(ops.ops.combat_effect.attack_column, 1)
	assert.equal(ops.ops.combat_effect.ignore_trench_with_nation, "us")
	const sr = prepareEvent(649, 6493)
	sr.events[card(646).event] = { duration: "game" }
	rules.action(sr, AP, "card_sr", 649)
	assert.equal(sr.ops, null)
	assert.equal(sr.sr.card, 649)
})

