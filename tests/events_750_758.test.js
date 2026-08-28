"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")

const data = require("../data.js")
const rules = require("../rules.js")
const { setupGame } = require("./setup_game.js")

const ROLE = { ap: "Allied Powers", cp: "Central Powers" }

function card(id) {
	return data.cards.find((candidate) => candidate.id === id)
}

function prepareEvent(id, { turn = 10, commitment = "total" } = {}) {
	const eventCard = card(id)
	const state = setupGame(id)
	state.turn = turn
	state.action_round = 1
	state.active = eventCard.faction
	state.state = "action_card"
	state.phase = "行动阶段"
	state.commitment[eventCard.faction] = commitment
	state.hands[eventCard.faction] = [id]
	state.decks[eventCard.faction] = []
	state.discard[eventCard.faction] = []
	state.removed[eventCard.faction] = []
	const prerequisite = data.card_effects[id]?.prerequisites?.requires_event
	if (prerequisite) state.events[prerequisite] = { faction: eventCard.faction }
	return state
}

function addCombatUnit(state, { id, faction, nation, type, location }) {
	const piece = data.pieces.find((candidate) =>
		candidate.nation === nation && candidate.type === type)
	assert.ok(piece)
	const unit = {
		id,
		piece: piece.id,
		faction,
		nation,
		type,
		location,
		reduced: false,
		moved: false,
		attacked: false,
		supplied: true,
	}
	state.units.push(unit)
	return unit
}

function basicCombat(
	state,
	effectId,
	target,
	origin,
	defenders = [{ nation: "it", type: "army" }],
	attackerDefinition = { faction: "cp", nation: "ah", type: "army" },
) {
	state.units = []
	const attacker = addCombatUnit(state, {
		id: "test-attacker",
		...attackerDefinition,
		location: origin,
	})
	const defendingUnits = defenders.map((definition, index) => addCombatUnit(state, {
		id: `test-defender-${index}`,
		faction: definition.faction || (attackerDefinition.faction === "cp" ? "ap" : "cp"),
		nation: definition.nation,
		type: definition.type,
		location: target,
	}))
	state.active = card(effectId).faction
	state.state = "combat_card_window"
	state.hands.cp = [effectId]
	state.combat_window = {
		declaration: { attackers: [attacker.id], target },
		attacker: attackerDefinition.faction,
		defender: attackerDefinition.faction === "cp" ? "ap" : "cp",
		side: card(effectId).faction,
		cards: [],
		card_owners: {},
	}
	return { attacker, defenders: defendingUnits }
}

test("750 Max von Baden uses combined-war-status OR turn eligibility and treaty suppression", () => {
	const early = prepareEvent(750, { turn: 8 })
	early.war_status.combined = 25
	assert.equal(rules.view(early, ROLE.cp).actions.card_event?.includes(750) || false, false)
	early.war_status.combined = 26
	assert.equal(rules.view(early, ROLE.cp).actions.card_event.includes(750), true)

	const late = prepareEvent(750, { turn: 9 })
	late.war_status.combined = 0
	assert.equal(rules.view(late, ROLE.cp).actions.card_event.includes(750), true)
	rules.action(late, ROLE.cp, "card_event", 750)
	assert.equal(late.events[card(750).event].end_vp, 1)
	late.entry_tracks.armistice = 3
	late.events[card(745).event] = { faction: "cp" }
	rules._test.applyWarStatusEntryTracks(late)
	assert.equal(late.entry_tracks.armistice, 3)
})

test("751 Italian Neutrality is mobilization-only before entry and adds one persistent none MO", () => {
	const state = prepareEvent(751, { turn: 1, commitment: "mobilization" })
	delete state.events.entry_it
	assert.equal(rules.view(state, ROLE.cp).actions.card_event.includes(751), true)
	rules.action(state, ROLE.cp, "card_event", 751)
	assert.equal(state.rp.cp.ah, 2)
	assert.equal(state.mo.pool.ah.filter((entry) => entry.source_card === 751).length, 1)

	const entered = prepareEvent(751, { turn: 2, commitment: "mobilization" })
	entered.events.entry_it = true
	assert.equal(rules.view(entered, ROLE.cp).actions.card_event?.includes(751) || false, false)
})

test("752 White Feather executes AP SR before the private CP card search", () => {
	const state = prepareEvent(752, { commitment: "limited" })
	state.discard.cp = [724]
	rules.action(state, ROLE.cp, "card_event", 752)
	assert.equal(state.active, "ap")
	assert.equal(state.pending_event.kind, "white_feather_sr")
	assert.equal(rules.view(state, ROLE.ap).actions.event_cancel, undefined)
	for (const nation of ["fr", "br"]) {
		assert.equal(state.pending_event.queue[state.pending_event.index], nation)
		const unit = state.pending_event.unit || rules.view(state, ROLE.ap).actions.select_event_unit[0]
		if (!state.pending_event.unit) {
			rules.action(state, ROLE.ap, "select_event_unit", unit)
			rules.action(state, ROLE.ap, "event_units_confirm")
		}
		const destination = rules.view(state, ROLE.ap).actions.event_space[0]
		rules.action(state, ROLE.ap, "event_space", destination)
	}
	assert.equal(state.active, "cp")
	assert.equal(state.pending_event.kind, "card_search")
	assert.deepEqual(rules.view(state, ROLE.cp).actions.event_choose, ["724"])
})

test("753 Flanders Mud uses basic land adjacency to swamp and prohibits AP advance", () => {
	const swamp = data.spaces.find((space) => space.terrain === "swamp" && rules._test.landNeighbors(space.id).length)
	assert.ok(swamp)
	const adjacent = rules._test.landNeighbors(swamp.id)[0]
	const origin = rules._test.landNeighbors(adjacent).find((id) => id !== swamp.id)
	assert.ok(origin)
	const state = setupGame(753)
	basicCombat(
		state,
		753,
		adjacent,
		origin,
		[{ faction: "cp", nation: "ge", type: "army" }],
		{ faction: "ap", nation: "fr", type: "army" },
	)
	assert.equal(rules.view(state, ROLE.cp).actions.combat_card.includes(753), true)
	rules.action(state, ROLE.cp, "combat_card", 753)
	const modifiers = state.combat?.modifiers || state.combat_modifiers
	assert.equal(modifiers.attack_column, -1)
	assert.ok(modifiers.prohibit_advance.includes("ap"))
})

test("754 Lenin hides the Russian-front branch when Brest-Litovsk locks the track", () => {
	const state = prepareEvent(754)
	state.events[card(745).event] = { faction: "cp", duration: "game" }
	rules.action(state, ROLE.cp, "card_event", 754)
	assert.deepEqual(rules.view(state, ROLE.cp).actions.event_choose, ["ge_rp"])
})

test("755 Jutland naval Event is fixed at five points and applies only its printed marker", () => {
	const state = setupGame(755)
	state.turn = 8
	state.commitment.cp = "limited"
	state.state = "naval_choice"
	state.phase = "海军阶段"
	state.active = "cp"
	state.hands.cp = [755]
	state.hands.ap = []
	state.naval.selections = {}
	const before = state.war_status.cp
	rules.action(state, ROLE.cp, "naval_event", 755)
	rules.action(state, ROLE.ap, "naval_empty_fleet")
	assert.equal(state.naval.points.cp, 5)
	assert.equal(state.war_status.cp, before + 1)
	assert.equal(state.events[card(755).event], undefined)
	assert.equal(state.discard.cp.includes(755), true)
})

test("756 Desertion waits until the complete post-combat sequence and uses any Italian unit at an origin", () => {
	const state = setupGame(756)
	const origin = data.spaces.find((space) => !space.ui?.hidden).id
	const target = rules._test.landNeighbors(origin)[0]
	state.units = []
	const attacker = addCombatUnit(state, {
		id: "italian-attacker", faction: "ap", nation: "it", type: "army", location: target,
	})
	const nonparticipant = addCombatUnit(state, {
		id: "italian-origin-unit", faction: "ap", nation: "it", type: "corps", location: origin,
	})
	state.events[card(756).event] = {
		faction: "cp",
		rule: data.card_effects[756].operations.find((operation) => operation.type === "rule_modifier"),
	}
	state.combat = {
		attacker: "ap",
		attackers: [attacker.id],
		defenders: [],
		target,
		origins: { [attacker.id]: origin },
		modifiers: { cards: [] },
	}
	assert.equal(state.pending_event, null)
	rules._test.finishCombatSequence(state)
	assert.equal(state.pending_event.kind, "desertion_combat_loss")
	assert.deepEqual(state.pending_event.candidates, [nonparticipant.id])
})

test("757 German-trained AH storm troops require an AH LCU and all-Italian defenders", () => {
	const target = data.spaces.find((space) => rules._test.landNeighbors(space.id).length).id
	const origin = rules._test.landNeighbors(target)[0]
	const state = setupGame(757)
	basicCombat(state, 757, target, origin, [
		{ nation: "it", type: "army" },
		{ nation: "it", type: "corps" },
	])
	state.trenches[target] = 1
	state.fortifications[target] = 2
	assert.equal(rules.view(state, ROLE.cp).actions.combat_card.includes(757), true)
	rules.action(state, ROLE.cp, "combat_card", 757)
	const modifiers = state.combat?.modifiers || state.combat_modifiers
	assert.equal(modifiers.ignore_natural_terrain, true)
	assert.equal(modifiers.ignore_trench, true)
	assert.equal(modifiers.ignore_fortification, true)

	const illegal = setupGame(757)
	basicCombat(illegal, 757, target, origin, [{ nation: "fr", type: "army" }])
	assert.equal(rules.view(illegal, ROLE.cp).actions.combat_card?.includes(757) || false, false)
})

test("758 Kemal is removed as an Event and for every use in Total War", () => {
	const limited = prepareEvent(758, { commitment: "limited" })
	rules.action(limited, ROLE.cp, "card_event", 758)
	assert.equal(limited.removed.cp.includes(758), true)
	assert.equal(limited.discard.cp.includes(758), false)
	assert.equal(limited.turn_flags.turkish_front_cost_increase, 1)

	const totalEvent = prepareEvent(758, { commitment: "total" })
	rules.action(totalEvent, ROLE.cp, "card_event", 758)
	assert.equal(totalEvent.removed.cp.includes(758), true)
	assert.equal(totalEvent.discard.cp.includes(758), false)

	const totalOps = prepareEvent(758, { commitment: "total" })
	rules.action(totalOps, ROLE.cp, "card_ops", 758)
	assert.equal(totalOps.removed.cp.includes(758), true)
})

test("version 28 saves add the corrected CP commitment cards exactly once", () => {
	const state = setupGame(758)
	state.version = 28
	state.commitment.cp = "limited"
	const cards = [751, 752, 755, 756, 757, 758]
	for (const id of cards)
		for (const pool of [state.hands.cp, state.decks.cp, state.discard.cp, state.removed.cp])
			while (pool.includes(id)) pool.splice(pool.indexOf(id), 1)
	rules.view(state, ROLE.cp)
	assert.equal(state.version, 42)
	for (const id of cards)
		assert.equal(state.decks.cp.filter((candidate) => candidate === id).length, 1)
})


