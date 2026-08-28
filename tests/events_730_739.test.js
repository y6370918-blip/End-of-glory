"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")

const data = require("../data.js")
const rules = require("../rules.js")
const { setupGame } = require("./setup_game.js")

const AP = "Allied Powers"
const CP = "Central Powers"
const card = (id) => data.cards.find((entry) => entry.id === id)
const piece = (nation, type) => data.pieces.find((entry) => entry.nation === nation && entry.type === type)

function unit(id, nation, type, location, reduced = false) {
	const model = piece(nation, type)
	assert.ok(model)
	return {
		id,
		piece: model.id,
		faction: model.faction,
		nation,
		type,
		location,
		reduced,
		moved: false,
		attacked: false,
		supplied: true,
	}
}

function prepareCpEvent(id, turn = 6) {
	const state = setupGame(id)
	state.turn = turn
	state.active = "cp"
	state.state = "action_card"
	state.phase = "行动阶段"
	state.commitment.cp = "total"
	state.hands.cp = [id]
	state.decks.cp = state.decks.cp.filter((entry) => entry !== id)
	state.discard.cp = state.discard.cp.filter((entry) => entry !== id)
	return state
}

function combatWindow(id, { attacker, defender, origin, target, owner = "cp" }) {
	const state = setupGame(id)
	state.units = [attacker, defender]
	state.active = owner
	state.state = "combat_card_window"
	state.hands[owner] = [id]
	state.combat_window = {
		attacker: attacker.faction,
		defender: defender.faction,
		side: owner,
		cards: [],
		card_sources: {},
		card_owners: {},
		declaration: { attackers: [attacker.id], target },
	}
	assert.equal(attacker.location, origin)
	return state
}

test("730 Trentino Surprise restricts its OP to Italian attack activations but ignores terrain everywhere", () => {
	const state = prepareCpEvent(730)
	state.events[card(633).event] = { faction: "cp", persistent: true }
	state.events.entry_it = true
	state.units = [
		unit("ah", "ah", "corps", "gorizia"),
		unit("it", "it", "corps", "udine"),
		unit("ge", "ge", "corps", "metz"),
		unit("fr", "fr", "corps", "verdun"),
	]
	rules.action(state, CP, "card_event", 730)
	assert.equal(state.ops.italian_bonus, 0)
	assert.equal(state.ops.combat_effect.attack_only, true)
	assert.equal(state.ops.combat_effect.theater, "italian")
	const view = rules.view(state, CP)
	assert.equal(view.actions.activate_attack.includes("gorizia"), true)
	assert.equal(view.actions.activate_attack.includes("metz"), false)
	assert.equal(data.card_effects[730].combat.all_theaters, true)
})

test("731 British Shell Shortage uses the corps table, unlocks br-8 once, and is prohibited by 645", () => {
	const state = combatWindow(731, {
		attacker: unit("br", "br", "corps", "metz"),
		defender: unit("ge", "ge", "corps", "verdun"),
		origin: "metz",
		target: "verdun",
	})
	assert.equal(rules.view(state, CP).actions.combat_card.includes(731), true)
	rules.action(state, CP, "combat_card", 731)
	assert.equal(data.mo.br.find((entry) => entry.id === "br-8").requires_event,
		"cp_英国炮弹短缺_MO解锁")
	const modifiers = rules._test.combatModifiers(
		state,
		state.combat_window.declaration,
		[state.units.find((entry) => entry.id === "br")],
		[state.units.find((entry) => entry.id === "ge")],
	)
	assert.equal(modifiers.attack_table, "corps")
	rules.action(state, CP, "pass")
	assert.equal(Boolean(state.events["cp_英国炮弹短缺_MO解锁"]), true)

	const prohibited = combatWindow(731, {
		attacker: unit("br", "br", "corps", "metz"),
		defender: unit("ge", "ge", "corps", "verdun"),
		origin: "metz",
		target: "verdun",
	})
	prohibited.events[card(645).event] = { faction: "ap", persistent: true }
	assert.equal(rules.view(prohibited, CP).actions.combat_card?.includes(731) || false, false)
})

test("732 Boroevic deploys its unique HQ to the selected attack origin on first use", () => {
	const state = combatWindow(732, {
		attacker: unit("ah", "ah", "corps", "gorizia"),
		defender: unit("it", "it", "corps", "udine"),
		origin: "gorizia",
		target: "udine",
	})
	state.events.entry_it = true
	for (const pool of [state.reserves.cp, state.eliminated.cp, state.upgrade_pool.cp])
		for (let index = pool.length - 1; index >= 0; index--)
			if (pool[index].piece === "component-013") pool.splice(index, 1)
	assert.equal(rules.view(state, CP).actions.combat_card.includes(732), true)
	rules.action(state, CP, "combat_card", 732)
	rules.action(state, CP, "pass")
	rules.action(state, AP, "pass")
	assert.equal(state.pending_event.kind, "combat_hq_reinforcement")
	assert.deepEqual(rules.view(state, CP).actions.event_space, ["gorizia"])
	rules.action(state, CP, "event_space", "gorizia")
	const hq = state.units.find((entry) => entry.piece === "component-013")
	assert.equal(hq.location, "gorizia")
	assert.equal(state.usage_limits["combat_card_first:732"], 1)
	assert.equal(hq.attacked, true)
	assert.equal(state.log.some((entry) => String(entry).includes("并参加战斗")), true)
})

test("733 Destruction of Serbia defines four full armies, three reserve corps, and the atomic two-army option", () => {
	const operation = data.card_effects[733].operations.find((entry) => entry.type === "reinforcement")
	assert.deepEqual(operation.units.map((entry) => [entry.piece, entry.count, entry.to]), [
		["component-021", 4, "eliminated"],
		["component-014", 3, "reserve"],
	])
	assert.equal(operation.optional_deploy.rp.amount, 4)
	assert.equal(operation.optional_deploy.count, 2)
})

test("734 Gneisenau compares printed loss results and does not cancel trenches outside the west", () => {
	const effect = data.card_effects[734].combat
	assert.equal(effect.western_front_only, true)
	assert.equal(effect.ignore_trench, true)
	assert.equal(effect.prohibit_damaged_retreat_cancel_if_margin, 2)
})

test("735 Below restrictions follow only the generated army and HQ instances", () => {
	const operation = data.card_effects[735].operations.find((entry) => entry.type === "reinforcement")
	assert.equal(operation.restriction_scope, "generated_army_hq")
	assert.equal(operation.rebuild_theater, "italian")
	assert.equal(Object.hasOwn(operation, "restricted_pieces"), false)
})

test("736 Hindenburg Line adds one drawable defense MO and upgrades a level-one trench", () => {
	const operation = data.card_effects[736].operations[0]
	assert.equal(operation.add_mo.kind, "passive")
	assert.equal(operation.add_mo.defense_drm, 1)
	assert.equal(operation.marker_count, 2)
	assert.equal(operation.trench_at_retreat_destination, 1)
})

test("737 Hindenburg-Ludendorff adds one MO and pays the second Russian step with selectable units", () => {
	const state = setupGame(737)
	state.events[card(737).event] = { faction: "cp", persistent: true }
	state.active = "cp"
	state.state = "replacement"
	state.phase = "补员/升级"
	state.replacement_active = "cp"
	state.usage_limits[`front:${state.turn}:cp:russian`] = 1
	state.rp.cp = { ge: 0, ah: 0, east: 0 }
	state.units = []
	state.reserves.cp = [
		...Array.from({ length: 5 }, (_, index) => unit(`ge-${index}`, "ge", "corps", undefined)),
		unit("ah-half", "ah", "corps", undefined),
	]
	assert.equal(data.card_effects[737].operations[1].add[0].count, 1)
	assert.deepEqual(rules.view(state, CP).actions.spend_front, ["russian"])
	rules.action(state, CP, "spend_front", "russian")
	for (const id of ["ge-0", "ge-1", "ge-2", "ge-3", "ge-4", "ah-half"]) {
		assert.equal(rules.view(state, CP).actions.front_unit_payment.includes(id), true)
		rules.action(state, CP, "front_unit_payment", id)
	}
	assert.equal(state.fronts.russian, 1)
	assert.equal(state.reserves.cp.every((entry) => entry.reduced), true)

	const impossible = setupGame(7370)
	impossible.events[card(737).event] = { faction: "cp", persistent: true }
	impossible.active = "cp"
	impossible.state = "replacement"
	impossible.phase = "补员/升级"
	impossible.replacement_active = "cp"
	impossible.usage_limits[`front:${impossible.turn}:cp:russian`] = 1
	impossible.rp.cp = { ge: 0, ah: 0, east: 0 }
	impossible.units = []
	impossible.reserves.cp = Array.from({ length: 3 }, (_, index) =>
		unit(`army-${index}`, "ge", "army", undefined, true))
	assert.deepEqual(rules.view(impossible, CP).actions.spend_front || [], [])
})

test("738 Reims Battle charges VP only when no CP army advanced during the action round", () => {
	const failed = setupGame(738)
	failed.events[card(738).event] = { duration: "action_round", army_advanced: false }
	const before = failed.vp
	rules._test.clearCombatEvents(failed, "action_round")
	assert.equal(failed.vp, before - 1)

	const advanced = setupGame(7381)
	advanced.events[card(738).event] = { duration: "action_round", army_advanced: true }
	const advancedBefore = advanced.vp
	rules._test.clearCombatEvents(advanced, "action_round")
	assert.equal(advanced.vp, advancedBefore)
})

test("739 Nivelle forced attacks reduce losses inflicted on CP by one, to a minimum of zero", () => {
	const effect = data.card_effects[739].combat
	assert.equal(effect.forced_attack_loss_adjust, -1)
	assert.equal(Object.hasOwn(effect, "forced_attack_loss_floor"), false)
	assert.equal(effect.remove_piece_before_combat, "component-011")
	assert.equal(effect.excluded_hq_piece, "component-001")
})

test("version 26 combat saves restore Boroevic's pending first-use deployment", () => {
	const state = combatWindow(732, {
		attacker: unit("ah", "ah", "corps", "gorizia"),
		defender: unit("it", "it", "corps", "udine"),
		origin: "gorizia",
		target: "udine",
	})
	state.version = 26
	state.events.entry_it = true
	state.combat_window.cards = [732]
	state.combat_window.card_owners[732] = "cp"
	state.hands.cp = []
	rules.view(state, CP)
	assert.equal(state.version, 42)
	assert.deepEqual(state.combat_window.pending_hq_reinforcement, {
		kind: "combat_hq_reinforcement",
		card: 732,
		owner: "cp",
		piece: "component-013",
		placement: "origin",
		required: true,
		resume: "resolve",
	})
})


