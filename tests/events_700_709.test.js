"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")

const data = require("../data.js")
const combatCardDispositions = require("../data/source/combat_card_dispositions.json")
const rules = require("../rules.js")
const { setupGame } = require("./setup_game.js")

const CP = "Central Powers"

const card = (id) => data.cards.find((entry) => entry.id === id)

function prepareCpEvent(id, turn = 1) {
	const state = setupGame(id)
	state.turn = turn
	state.action_round = 1
	state.active = "cp"
	state.state = "action_card"
	state.phase = "行动阶段"
	state.commitment.cp = "mobilization"
	state.hands.cp = [id]
	state.decks.cp = state.decks.cp.filter((entry) => entry !== id)
	return state
}

function cpCombat(id, defenderNation = "br") {
	const state = setupGame(id)
	const edge = data.edges.find((entry) =>
		entry.modes.includes("attack") && entry.factions.includes("cp"))
	assert.ok(edge)
	const attackerPiece = data.pieces.find((piece) => piece.faction === "cp" && piece.type === "corps")
	const defenderPiece = data.pieces.find((piece) => piece.faction === "ap" && piece.type === "corps" && piece.nation === defenderNation)
	assert.ok(attackerPiece)
	assert.ok(defenderPiece)
	const attacker = {
		id: `cp-${id}`, piece: attackerPiece.id, faction: "cp", nation: attackerPiece.nation,
		type: "corps", location: edge.a, reduced: false, supplied: true,
	}
	const defender = {
		id: `ap-${id}`, piece: defenderPiece.id, faction: "ap", nation: defenderNation,
		type: "corps", location: edge.b, reduced: false, supplied: true,
	}
	state.units = [attacker, defender]
	state.active = "cp"
	state.state = "combat_card_window"
	state.hands.cp = [id]
	state.combat_window = {
		attacker: "cp", defender: "ap", side: "cp", cards: [], card_sources: {},
		declaration: { attackers: [attacker.id], target: defender.location },
	}
	return state
}

test("700 Race to the Sea extends the CP action-start occupation depth from two to three", () => {
	const state = setupGame(700)
	state.turn = 1
	state.action_start_control = {
		actor: "cp",
		spaces: Object.fromEntries(data.spaces.map((space) => [space.id, null])),
	}
	state.action_start_control.spaces.metz = "cp"
	const depths = rules._test.occupationDepths(state, "cp")
	const at = (distance) => [...depths].find(([, depth]) => depth === distance)?.[0]
	assert.ok(at(2))
	assert.ok(at(3))
	assert.ok(at(4))
	assert.equal(rules._test.canOccupyByEarlyWarDepth(state, "cp", at(2)), true)
	assert.equal(rules._test.canOccupyByEarlyWarDepth(state, "cp", at(3)), false)
	state.control[at(2)] = "cp"
	assert.equal(rules._test.occupationDepth(state, "cp", at(3)), 3)
	state.events[card(700).event] = {
		faction: "cp", expires: "action_round",
		rule: data.card_effects[700].operations.find((entry) => entry.key === "race_to_sea"),
	}
	assert.equal(rules._test.earlyWarOccupationLimit(state, "cp"), 3)
	assert.equal(rules._test.canOccupyByEarlyWarDepth(state, "cp", at(3)), true)
	assert.equal(rules._test.canOccupyByEarlyWarDepth(state, "cp", at(4)), false)
	state.turn = 4
	assert.equal(rules._test.canOccupyByEarlyWarDepth(state, "cp", at(4)), false)
})

test("campaign-long occupation depth applies independently to AP and refreshes at the formal AP action", () => {
	const state = setupGame(700)
	state.turn = 2
	state.action_round = 1
	state.active = "cp"
	state.state = "action_card"
	state.phase = "行动阶段"
	state.action_state = { turn: 2, round: 1, actor: "cp", used_combat_cards: [] }
	state.action_start_control = { actor: "cp", spaces: { ...state.control } }
	const beforeAp = { ...state.control }
	const newlyControlled = data.spaces.find((space) => beforeAp[space.id] !== "ap")
	assert.ok(newlyControlled)
	state.control[newlyControlled.id] = "ap"
	rules._test.nextFactionAction(state)
	assert.equal(state.action_start_control.actor, "ap")
	assert.equal(state.action_start_control.spaces[newlyControlled.id], "ap")
	assert.equal(state.action_state.actor, "ap")

	const depths = rules._test.occupationDepths(state, "ap")
	const distanceThree = [...depths].find(([, depth]) => depth === 3)?.[0]
	assert.ok(distanceThree)
	assert.equal(rules._test.canOccupyByEarlyWarDepth(state, "ap", distanceThree), false)
	state.events[card(700).event] = {
		faction: "cp", expires: "action_round",
		rule: data.card_effects[700].operations.find((entry) => entry.key === "race_to_sea"),
	}
	assert.equal(rules._test.earlyWarOccupationLimit(state, "ap"), 2)
})

test("701 August Guns uses separate Belgian and CP placement stages", () => {
	assert.equal(data.card_effects[701].operations[0].key, "august_guns")
	assert.equal(data.card_effects[701].operations[0].activate_spaces, 2)
	assert.match(card(701).effect, /逐枚重新放置/)
})

test("702 German Heavy Artillery retains only after a CP victory", () => {
	const disposition = combatCardDispositions[702]
	assert.equal(disposition.retain_on_win, true)
	assert.equal(disposition.win_draw, "optional")
	assert.equal(data.card_effects[702].combat.defense_drm, -1)
	assert.equal(data.card_effects[702].combat.required_attacker_faction, "cp")

	const attacking = cpCombat(702)
	assert.equal(rules.view(attacking, CP).actions.combat_card.includes(702), true)

	const defending = cpCombat(702)
	const cpUnit = defending.units.find((unit) => unit.faction === "cp")
	const apUnit = defending.units.find((unit) => unit.faction === "ap")
	defending.active = "cp"
	defending.combat_window = {
		attacker: "ap", defender: "cp", side: "cp", cards: [], card_sources: {},
		declaration: { attackers: [apUnit.id], target: cpUnit.location },
	}
	assert.equal(rules.view(defending, CP).actions.combat_card?.includes(702) || false, false)
})

test("703 voluntary Turkey entry costs VP while automatic entry does not", () => {
	const voluntary = prepareCpEvent(703, 2)
	const voluntaryVp = voluntary.vp
	rules.action(voluntary, CP, "card_event", 703)
	assert.equal(voluntary.vp, voluntaryVp - 1)
	assert.equal(voluntary.fronts.turkish, 0)

	const automatic = prepareCpEvent(704, 3)
	automatic.war_status.cp = 6
	automatic.war_status.combined = 6
	automatic.hands.cp.push(703)
	const automaticVp = automatic.vp
	rules._test.resolveWarStatus(automatic)
	assert.equal(automatic.events[card(703).event].automatic, true)
	assert.equal(automatic.vp, automaticVp)
	assert.equal(automatic.removed.cp.includes(703), true)
})

test("704 Burgfrieden supplies one maintenance-only credit and is prohibited by 724", () => {
	const state = prepareCpEvent(704)
	rules.action(state, CP, "card_event", 704)
	state.usage_limits = {}
	state.rp.cp.ge = 0
	state.rp.cp.east = 0
	state.rp.cp.ah = 0
	state.fronts.russian = 0
	assert.equal(rules._test.beginFrontMaintenance(state), true)
	assert.equal(state.pending_event.obligations[0].remaining, 0)
	assert.equal(state.pending_event.credit.remaining, 0)
	assert.equal(rules.view(state, CP).actions.event_choose?.includes("credit:burgfrieden") || false, false)
	assert.equal(state.rp.cp.ge, 0)
	state.events[card(724).event] = { faction: "cp" }
	const blocked = prepareCpEvent(704)
	blocked.events[card(724).event] = { faction: "cp" }
	assert.equal(rules._test.eventLegal(blocked, card(704)), false)
})

test("705 French Offensive Doctrine requires exactly two legal stacks", () => {
	assert.equal(data.card_effects[705].operations.find((entry) => entry.key === "french_offensive_doctrine").attack_spaces, 2)
	assert.equal(data.card_effects[705].combat.attack_column, -1)
})

test("706 Tannenberg Heroes is limited to mobilization and unlocks future ge-10 draws", () => {
	const state = prepareCpEvent(706)
	const east = state.rp.cp.east
	const ah = state.rp.cp.ah
	rules.action(state, CP, "card_event", 706)
	assert.equal(state.rp.cp.east, east + 2)
	assert.equal(state.rp.cp.ah, ah + 1)
	assert.equal(state.fronts.russian, 1)
	assert.equal(Object.values(data.mo).flat().find((mo) => mo.id === "ge-10").requires_event, card(706).event)
})

test("707 Schlieffen overstack returns a player-selected imported SCU to reserve", () => {
	const state = setupGame(707)
	const space = data.spaces.find((entry) => !entry.large_area && !entry.ui?.hidden).id
	const piece = data.pieces.find((entry) => entry.faction === "cp" && entry.type === "corps")
	state.units = Array.from({ length: 4 }, (_, index) => ({
		id: `schlieffen-${index}`, piece: piece.id, faction: "cp", nation: piece.nation,
		type: "corps", location: space, reduced: index === 3, moved: false, attacked: false,
	}))
	state.active = "cp"
	state.state = "schlieffen_overstack"
	state.ops = {
		schlieffen: { allow_temporary_overstack: true },
		preactivation_sr_units: ["schlieffen-3"], forced_attacks: [],
	}
	const actions = rules.view(state, CP).actions
	assert.deepEqual(actions.return_schlieffen_unit, ["schlieffen-3"])
	rules.action(state, CP, "return_schlieffen_unit", "schlieffen-3")
	const returned = state.reserves.cp.find((unit) => unit.id === "schlieffen-3")
	assert.ok(returned)
	assert.equal(returned.reduced, true)
})

test("708 Trenches grants movement and construction OP but no attack activation", () => {
	const state = prepareCpEvent(708, 3)
	rules.action(state, CP, "card_event", 708)
	assert.equal(state.state, "ops_activate")
	assert.equal(state.ops.prohibit_attack, true)
	assert.equal(rules.view(state, CP).actions.activate_attack, undefined)
})

test("709 Target Paris is legal without a French defender and is removed on reveal", () => {
	const state = cpCombat(709, "br")
	assert.equal(rules.view(state, CP).actions.combat_card.includes(709), true)
	rules.action(state, CP, "combat_card", 709)
	rules._test.revealCommittedCombatCards(state)
	assert.equal(state.removed.cp.includes(709), true)
	assert.equal(state.discard.cp.includes(709), false)
	assert.equal(combatCardDispositions[709].retain_on_win, false)
})
