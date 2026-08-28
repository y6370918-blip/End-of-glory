"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")

const data = require("../data.js")
const rules = require("../rules.js")

const AP_ROLE = "Allied Powers"
const CP_ROLE = "Central Powers"

const hqValues = {
	"component-001": [0, 1, 5],
	"component-002": [0, 1, 5],
	"component-003": [1, 0, 5],
	"component-004": [1, 1, 5],
	"component-005": [0, 1, 5],
	"component-006": [1, 1, 5],
	"component-007": [1, 0, 5],
	"component-008": [1, 1, 5],
	"component-009": [1, 0, 5],
	"component-010": [0, 1, 5],
	"component-011": [1, 0, 5],
	"component-012": [1, 1, 5],
	"component-013": [1, 1, 5],
	"component-025": [0, 1, 5],
	"component-029": [1, 0, 5],
	"component-036": [1, 0, 5],
	"component-040": [1, 0, 5],
	"component-085": [1, 1, 5],
	"component-087": [1, 0, 5],
	"component-088": [1, 0, 5]
}

function makeUnit(id, pieceId, location) {
	const piece = data.pieces.find((candidate) => candidate.id === pieceId)
	return {
		id,
		piece: piece.id,
		faction: piece.faction,
		nation: piece.nation,
		type: piece.type,
		location,
		reduced: false,
		moved: false,
		attacked: false,
		supplied: true,
		limited_supply: false,
		fort_limited_supply: false
	}
}

function piece(nation, type, predicate = () => true) {
	const result = data.pieces.find(
		(candidate) =>
			candidate.nation === nation &&
			candidate.type === type &&
			predicate(candidate)
	)
	assert.ok(result)
	return result
}

test("all twenty HQ counters use their printed attack, defense, and movement values", () => {
	const hqs = data.pieces.filter((candidate) => candidate.type === "hq")
	assert.equal(hqs.length, 20)
	for (const hq of hqs)
		assert.deepEqual(
			[hq.attack_drm, hq.defense_drm, hq.movement],
			hqValues[hq.id],
			hq.name
		)
})

test("HQs add printed DRMs without adding combat strength", () => {
	const state = rules.setup(3101)
	const geArmy = piece("ge", "army")
	const frArmy = piece("fr", "army")
	const geHq = data.pieces.find(
		(candidate) => candidate.type === "hq" && candidate.nation === "ge" && candidate.attack_drm === 1
	)
	const frHq = data.pieces.find(
		(candidate) => candidate.type === "hq" && candidate.nation === "fr" && candidate.defense_drm === 1
	)
	const attacker = makeUnit("hq-combat-ge", geArmy.id, "essen")
	const attackingHq = makeUnit("hq-combat-ge-hq", geHq.id, "essen")
	const defender = makeUnit("hq-combat-fr", frArmy.id, "dusseldorf")
	const defendingHq = makeUnit("hq-combat-fr-hq", frHq.id, "dusseldorf")
	state.units = [attacker, attackingHq, defender, defendingHq]
	state.active = "cp"
	state.turn = 4
	state.ops = { activated_units: { essen: [attacker.id, attackingHq.id] } }
	state.activations = { essen: "attack" }
	state.combat_window = { attacker: "cp", defender: "ap", cards: [] }
	const unselected = rules._test.combatModifiers(
		state,
		{ attackers: [attacker.id], target: "dusseldorf" },
		[attacker],
		[defender]
	)
	assert.equal(unselected.attack_drm, 0)

	const modifiers = rules._test.combatModifiers(
		state,
		{ attackers: [attacker.id, attackingHq.id], target: "dusseldorf" },
		[attacker, attackingHq],
		[defender]
	)
	assert.equal(modifiers.attack_drm, geHq.attack_drm)
	assert.equal(modifiers.defense_drm, frHq.defense_drm)
	assert.deepEqual(modifiers.attack_hqs, [attackingHq.id])
	assert.deepEqual(modifiers.defense_hqs, [defendingHq.id])
	assert.equal(rules._test.combatStrength(state, [attacker.id, attackingHq.id]), geArmy.combat)
})

test("an HQ uses the ordinary attacker-selection action and cannot attack alone", () => {
	const state = rules.setup(3107)
	const geArmy = piece("ge", "army")
	const frArmy = piece("fr", "army")
	const geHq = data.pieces.find(
		(candidate) => candidate.type === "hq" && candidate.nation === "ge" && candidate.attack_drm
	)
	const attacker = makeUnit("hq-select-army", geArmy.id, "essen")
	const hq = makeUnit("hq-select-hq", geHq.id, "essen")
	const defender = makeUnit("hq-select-defender", frArmy.id, "dusseldorf")
	state.units = [attacker, hq, defender]
	state.turn = 4
	state.active = "cp"
	state.state = "ops_attack"
	state.ops = {
		attack_selection: [],
		activated_units: { essen: [attacker.id, hq.id] },
		forced_attacks: [],
		pending_attack: null
	}
	state.activations = { essen: "attack" }

	let actions = rules.view(state, CP_ROLE).actions
	assert.equal(actions.select_attacker.includes(attacker.id), true)
	assert.equal(actions.select_attacker.includes(hq.id), false)
	rules.action(state, CP_ROLE, "select_attacker", attacker.id)
	actions = rules.view(state, CP_ROLE).actions
	assert.equal(actions.select_attacker.includes(hq.id), true)
	rules.action(state, CP_ROLE, "select_attacker", hq.id)
	rules.action(state, CP_ROLE, "declare_attack", "dusseldorf")
	const declaration = state.combat_window?.declaration || state.combat?.declaration
	assert.deepEqual(declaration.attackers, [attacker.id, hq.id])
})

test("an HQ follows a national unit and cannot end alone away from supply", () => {
	const state = rules.setup(3102)
	const geArmy = piece("ge", "army")
	const geHq = piece("ge", "hq")
	const army = makeUnit("hq-move-army", geArmy.id, "essen")
	const hq = makeUnit("hq-move", geHq.id, "essen")
	state.units = [army, hq]
	state.active = "cp"
	state.turn = 4
	state.ops = {
		activated_units: { essen: [hq.id] },
		activated: ["essen"],
		moving: null
	}
	state.activations = { essen: "move" }
	assert.equal(rules._test.movementDestinations(state, hq).includes("dusseldorf"), false)

	state.ops.activated_units.essen.push(army.id)
	army.location = "dusseldorf"
	army.moved = true
	assert.equal(rules._test.movementDestinations(state, hq).includes("dusseldorf"), true)
})

test("HQ strategic redeployment costs one point and cannot cross into Italy", () => {
	const state = rules.setup(3103)
	const geArmy = piece("ge", "army")
	const geHq = piece("ge", "hq")
	const hq = makeUnit("hq-sr", geHq.id, "essen")
	const westernArmy = makeUnit("hq-sr-west", geArmy.id, "dusseldorf")
	const italianArmy = makeUnit("hq-sr-italy", geArmy.id, "tyrol")
	state.units = [hq, westernArmy, italianArmy]
	state.events.entry_it = true
	state.turn = 4
	state.active = "cp"
	state.state = "sr"
	state.sr = { card: 700, remaining: 1, used_units: [] }
	rules.action(state, CP_ROLE, "select_sr_unit", hq.id)
	const destinations = rules.view(state, CP_ROLE).actions.sr_destination
	assert.ok(destinations.includes("dusseldorf"))
	assert.equal(destinations.includes("tyrol"), false)
	rules.action(state, CP_ROLE, "sr_destination", "dusseldorf")
	assert.equal(state.sr.remaining, 0)
	assert.equal(hq.location, "dusseldorf")
})

test("orphaned HQs choose a controlled supply source or the turn track after combat", () => {
	const state = rules.setup(3104)
	const geArmy = piece("ge", "army")
	const geHq = piece("ge", "hq")
	const hq = makeUnit("hq-orphan", geHq.id, "dusseldorf")
	const army = makeUnit("hq-return-army", geArmy.id, "essen")
	state.units = [hq, army]
	state.active = "cp"
	state.state = "advance"
	state.combat = {
		attacker: "cp",
		attackers: [],
		defenders: [],
		target: "dusseldorf",
		origins: { orphan: "dusseldorf" },
		modifiers: { cards: [] }
	}
	rules._test.finishCombatSequence(state)
	assert.equal(state.pending_event.kind, "hq_relocation")
	assert.ok(rules.view(state, CP_ROLE).actions.event_space.includes("essen"))
	assert.deepEqual(
		rules.view(state, CP_ROLE).actions.event_choose,
		["turn_track"]
	)

	rules.action(state, CP_ROLE, "event_choose", "turn_track")
	assert.equal(state.hq_turn_track.cp.some((unit) => unit.id === hq.id), true)
	assert.equal(state.units.some((unit) => unit.id === hq.id), false)
	assert.equal(state.combat, null)

	rules._test.beginReplacement(state)
	assert.equal(state.pending_event.kind, "hq_return")
	assert.ok(rules.view(state, CP_ROLE).actions.event_space.includes("essen"))
	rules.action(state, CP_ROLE, "event_space", "essen")
	assert.equal(state.hq_turn_track.cp.length, 0)
	assert.equal(state.units.find((unit) => unit.id === hq.id).location, "essen")
	assert.equal(state.pending_event?.kind, "front_maintenance")
})

test("British-Belgian and French-American equivalence applies to HQ stacking", () => {
	const state = rules.setup(3105)
	const belgianHq = makeUnit("hq-belgian", piece("be", "hq").id, "ghent")
	const britishCorps = makeUnit("hq-british-corps", piece("br", "corps").id, "ghent")
	const frenchHq = makeUnit("hq-french", piece("fr", "hq").id, "reims")
	const americanCorps = makeUnit("hq-american-corps", piece("us", "corps").id, "reims")
	state.units = [belgianHq, britishCorps, frenchHq, americanCorps]
	assert.equal(rules._test.hqEndLegal(state, belgianHq), true)
	assert.equal(rules._test.hqEndLegal(state, frenchHq), true)
})

test("an HQ may stand alone at an allied supply source but not an ordinary port", () => {
	const state = rules.setup(3107)
	state.events.entry_it = true
	state.control.milan = "ap"
	state.control.portogruaro = "ap"
	const britishHq = makeUnit("hq-allied-source", piece("br", "hq").id, "milan")
	state.units = [britishHq]
	assert.equal(rules._test.hqEndLegal(state, britishHq, "milan"), true)
	assert.equal(rules._test.hqEndLegal(state, britishHq, "portogruaro"), false)
})

test("the server refuses to finish an action while an HQ is illegally orphaned", () => {
	const state = rules.setup(3106)
	const hq = makeUnit("hq-illegal-finish", piece("ge", "hq").id, "dusseldorf")
	state.units = [hq]
	state.turn = 4
	state.active = "cp"
	state.state = "ops_activate"
	state.ops = { remaining: 0, activated: [], forced_attacks: [] }
	state.activations = {}
	rules.action(state, CP_ROLE, "finish")
	assert.equal(state.state, "ops_activate")

	assert.deepEqual(rules.view(state, AP_ROLE).actions, {})
})
