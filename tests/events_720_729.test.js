"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")

const data = require("../data.js")
const rules = require("../rules.js")
const { setupGame } = require("./setup_game.js")

const AP = "Allied Powers"
const CP = "Central Powers"
const card = (id) => data.cards.find((entry) => entry.id === id)

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

function combatWindow(id, owner = "cp") {
	const state = setupGame(id)
	const edge = data.edges.find((entry) => entry.modes.includes("attack") && entry.factions.includes(owner))
	const attackerPiece = data.pieces.find((piece) => piece.faction === owner && piece.type === "corps")
	const defenderFaction = owner === "cp" ? "ap" : "cp"
	const defenderPiece = data.pieces.find((piece) => piece.faction === defenderFaction && piece.type === "corps")
	const attacker = { id: "attacker", piece: attackerPiece.id, faction: owner, nation: attackerPiece.nation,
		type: "corps", location: edge.a, reduced: false, supplied: true }
	const defender = { id: "defender", piece: defenderPiece.id, faction: defenderFaction, nation: defenderPiece.nation,
		type: "corps", location: edge.b, reduced: false, supplied: true }
	state.units = [attacker, defender]
	state.active = owner
	state.state = "combat_card_window"
	state.hands[owner] = [id]
	state.combat_window = {
		attacker: owner, defender: defenderFaction, side: owner,
		cards: [], card_sources: {}, card_owners: {},
		declaration: { attackers: [attacker.id], target: defender.location },
	}
	return state
}

test("720 Killing Ground keeps Falkenhayn on capture and returns the card to CP discard", () => {
	const state = setupGame(720)
	state.markers.killing_ground = { space: "verdun", cost: 1, source_card: 720, destroy_vp: 1 }
	state.removed.cp = [720]
	const before = state.vp
	rules._test.captureSpace(state, "verdun", "cp")
	assert.equal(state.vp, before + 1)
	assert.equal(state.discard.cp.includes(720), true)
	assert.equal(state.permanently_removed_units.some((unit) => unit.piece === "component-004"), false)
})

test("721 Fokker Scourge prohibits and cancels 621 only before AP Total War", () => {
	const early = combatWindow(621, "ap")
	early.commitment.ap = "limited"
	early.hands.ap = [621]
	early.hands.cp = [721]
	early.active = "ap"
	rules.action(early, AP, "combat_card", 621)
	rules.action(early, AP, "pass")
	rules.action(early, CP, "combat_card", 721)
	assert.equal(early.discard.ap.includes(621) || early.removed.ap.includes(621), true)
	assert.equal(Boolean(early.events["cp_福克灾难_禁用空中优势"]), true)

	const late = combatWindow(621, "ap")
	late.commitment.ap = "total"
	late.hands.ap = [621]
	late.hands.cp = [721]
	late.active = "ap"
	rules.action(late, AP, "combat_card", 621)
	rules.action(late, AP, "pass")
	rules.action(late, CP, "combat_card", 721)
	assert.equal(late.combat_modifiers.canceled_cards?.includes(621) || false, false)
	assert.equal(late.removed.cp.includes(721), true)
})

test("722 Trench Machine Guns has separate pre-combat and post-combat uses", () => {
	const pre = combatWindow(722, "ap")
	pre.hands.ap = []
	pre.hands.cp = [722]
	pre.active = "cp"
	pre.combat_window.side = "cp"
	pre.trenches[pre.combat_window.declaration.target] = 1
	assert.equal(rules.view(pre, CP).actions.combat_card.includes(722), true)

	const post = setupGame(722)
	const attacker = post.units.find((unit) => unit.faction === "ap" && unit.type === "army")
	const defender = post.units.find((unit) => unit.faction === "cp" && unit.type === "army")
	post.units = [attacker, defender]
	post.hands.cp = [722]
	post.active = "cp"
	post.state = "post_combat_card_window"
	post.post_combat_window = { attacker: "ap", defender: "cp", side: "cp" }
	post.combat = {
		attacker: "ap", attackers: [attacker.id], defenders: [defender.id], target: defender.location,
		attack_loss: 0, defense_loss: 1,
		modifiers: { cards: [], prohibit_advance: [], cancel_advance: [], cancel_retreat: [], minimum_retreat: 0 },
	}
	assert.equal(rules.view(post, CP).actions.combat_card.includes(722), true)
	rules.action(post, CP, "combat_card", 722)
	assert.equal(post.discard.cp.includes(722), true)
	assert.notEqual(post.state, "advance_select")
})

test("723 U-boat Offensive establishes a four-point naval minimum and Convoy removes it", () => {
	const state = prepareCpEvent(723)
	rules.action(state, CP, "card_event", 723)
	state.state = "naval_choice"
	state.phase = "海军阶段"
	state.active = "cp"
	state.hands.cp = []
	state.hands.ap = []
	state.naval.selections = {}
	rules.action(state, CP, "naval_empty_fleet")
	rules.action(state, AP, "naval_empty_fleet")
	assert.equal(state.naval.points.cp, 4)
	state.events[card(643).event] = { faction: "ap" }
	delete state.events[card(723).event]
	assert.equal(rules._test.eventLegal(state, card(723)), false)
})

test("724 German War Industry grants its immediate total-war RP only once", () => {
	const state = prepareCpEvent(724)
	const before = state.rp.cp.ge
	rules.action(state, CP, "card_event", 724)
	assert.equal(state.rp.cp.ge, before + 1)
	assert.equal(data.card_effects[724].operations[0].free_upgrade.type, "corps")
})

test("725 Bulgaria keeps immediate RP and schedules exactly two AP choices", () => {
	const state = prepareCpEvent(725)
	rules.action(state, CP, "card_event", 725)
	assert.equal(state.rp.cp.ge, 4)
	assert.equal(state.rp.cp.ah, 2)
	assert.deepEqual(state.scheduled_events.filter((entry) => entry.source_card === 725).map((entry) => entry.due_turn), [state.turn + 1, state.turn + 2])
})

test("726 African War validates and atomically removes the base and extra SCU payment", () => {
	const state = prepareCpEvent(726)
	const armyPiece = data.pieces.find((piece) => piece.nation === "br" && piece.type === "army")
	const corpsPiece = data.pieces.find((piece) => piece.nation === "br" && piece.type === "corps")
	state.reserves.ap = [
		{ id: "army", piece: armyPiece.id, reduced: false },
		...Array.from({ length: 5 }, (_, index) => ({ id: `corps-${index}`, piece: corpsPiece.id, reduced: false })),
	]
	rules.action(state, CP, "card_event", 726)
	rules.action(state, AP, "event_choose", "remove_lcu")
	for (const id of ["army", "corps-0", "corps-1"])
		rules.action(state, AP, "select_event_unit", id)
	rules.action(state, AP, "event_units_confirm")
	assert.deepEqual(state.permanently_removed_units.filter((unit) => unit.removed_by === 726).map((unit) => unit.id).sort(), ["army", "corps-0", "corps-1"])
})

test("727 Gorlice-Tarnow lets CP choose the German task MO", () => {
	const state = prepareCpEvent(727)
	const selected = data.mo.ge.find((entry) => (entry.kind || "task") === "task").id
	state.mo.current.ge = [selected]
	state.mo.completed.ge = []
	assert.ok(selected)
	rules.action(state, CP, "card_event", 727)
	assert.equal(rules.view(state, CP).actions.event_choose.includes(selected), true)
	rules.action(state, CP, "event_choose", selected)
	assert.equal(state.mo.completed.ge.includes(selected), true)
	assert.equal(state.fronts.russian, 1)
	assert.equal(state.rp.cp.east, 2)
	assert.equal(state.rp.cp.ah, 2)
})

test("728 Gallipoli action lock is canceled by Allenby while the naval branch is only four points", () => {
	const locked = prepareCpEvent(728)
	locked.events[card(703).event] = { faction: "cp" }
	locked.events.entry_tu = true
	locked.fronts.turkish = 3
	rules.action(locked, CP, "card_event", 728)
	assert.equal(locked.fronts.turkish, 2)
	assert.equal(locked.turn_flags.turkish_front_locked, locked.turn)

	const unlocked = prepareCpEvent(728)
	unlocked.events[card(703).event] = { faction: "cp" }
	unlocked.events.entry_tu = true
	unlocked.events[card(636).event] = { faction: "ap" }
	unlocked.fronts.turkish = 3
	rules.action(unlocked, CP, "card_event", 728)
	assert.equal(unlocked.turn_flags.turkish_front_locked, undefined)

	const naval = setupGame(728)
	naval.events[card(703).event] = { faction: "cp" }
	naval.events.entry_tu = true
	naval.fronts.turkish = 3
	naval.active = "cp"
	naval.state = "naval_choice"
	naval.phase = "海军阶段"
	naval.commitment.cp = "total"
	naval.hands.cp = [728]
	naval.hands.ap = []
	rules.action(naval, CP, "naval_event", 728)
	rules.action(naval, AP, "naval_empty_fleet")
	assert.equal(naval.naval.points.cp, 4)
	assert.equal(naval.fronts.turkish, 3)
})

test("729 Gas transfers between owners before Total War and is removed once either side is Total", () => {
	const transfer = setupGame(729)
	transfer.card_owners[729] = "cp"
	transfer.discard.cp = [729]
	const combat = { attack_loss: 0, defense_loss: 1, played_cards: [{ id: 729, faction: "cp" }] }
	assert.equal(rules._test.prepareCombatCardDispositions(transfer, combat), false)
	assert.equal(transfer.card_owners[729], "ap")
	assert.equal(transfer.decks.ap.includes(729), true)

	const removed = setupGame(7290)
	removed.commitment.ap = "total"
	removed.card_owners[729] = "cp"
	removed.discard.cp = [729]
	rules._test.prepareCombatCardDispositions(removed, {
		attack_loss: 0, defense_loss: 1, played_cards: [{ id: 729, faction: "cp" }],
	})
	assert.equal(removed.removed.cp.includes(729), true)
	assert.equal(removed.decks.ap.includes(729), false)
})

test("version 25 migration initializes dynamic card ownership without changing history", () => {
	const state = setupGame(72925)
	state.version = 25
	state.card_owners = {}
	state.decks.ap.push(729)
	state.event_history = [{ card: 720, turn: 4 }]
	const history = JSON.parse(JSON.stringify(state.event_history))
	rules.view(state, AP)
	assert.equal(state.version, 46)
	assert.equal(state.card_owners[729], "ap")
	assert.deepEqual(state.event_history, history)
})
