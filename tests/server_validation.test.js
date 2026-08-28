"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")

const data = require("../data.js")
const rules = require("../rules.js")

const AP_ROLE = "Allied Powers"

function landPair() {
	const edge = data.edges.find((candidate) => candidate.type === "land")
	return [edge.a, edge.b]
}

function unitsFor(state, faction, count, type = null) {
	return state.units
		.filter((unit) => unit.faction === faction && (!type || unit.type === type))
		.slice(0, count)
}

function opsState(seed = 901) {
	const state = rules.setup(seed)
	state.active = "ap"
	state.state = "ops_activate"
	state.ops = {
		card: null,
		total: 4,
		remaining: 4,
		activated: [],
		moving: null,
		preactivation_sr_used: [],
		preactivation_sr_units: [],
		entrench_attempted: []
	}
	state.activations = {}
	return state
}

test("a forged action cannot move the same unit twice", () => {
	const state = opsState()
	const [origin] = landPair()
	const [unit] = unitsFor(state, "ap", 1)
	state.units = [unit]
	unit.location = origin
	unit.moved = true
	state.activations[origin] = "move"
	state.state = "ops_move"
	state.ops.execution_phase = "move"
	state.ops.execution_origin = origin
	state.ops.activated_units = { [origin]: [unit.id] }

	rules.action(state, AP_ROLE, "select_move_unit", unit.id)
	assert.equal(state.state, "ops_move")
	assert.equal(state.ops.moving, null)

	unit.moved = false
	rules.action(state, AP_ROLE, "select_move_unit", unit.id)
	assert.equal(state.state, "movement_units")
	assert.deepEqual(state.ops.move_selection.selected, [unit.id])
})

test("a forged attack requires unused attack-activated units and unique ids", () => {
	const state = opsState(902)
	const [origin, target] = landPair()
	const [attacker] = unitsFor(state, "ap", 1)
	const [defender] = unitsFor(state, "cp", 1)
	state.units = [attacker, defender]
	attacker.location = origin
	defender.location = target
	state.ops.execution_phase = "attack"

	rules.action(state, AP_ROLE, "declare_attack", target)
	assert.equal(state.state, "ops_activate")
	assert.equal(state.combat_window, null)

	state.state = "ops_attack"
	state.activations[origin] = "attack"
	state.ops.activated_units = { [origin]: [attacker.id] }
	state.ops.attack_selection = []
	state.ops.attacked_units = []
	state.ops.forced_attacks = []
	attacker.attacked = true
	rules.action(state, AP_ROLE, "select_attacker", attacker.id)
	assert.equal(state.state, "ops_attack")
	assert.deepEqual(state.ops.attack_selection, [])

	attacker.attacked = false
	rules.action(state, AP_ROLE, "select_attacker", attacker.id)
	rules.action(state, AP_ROLE, "select_attacker", attacker.id)
	assert.deepEqual(state.ops.attack_selection, [attacker.id])
	rules.action(state, AP_ROLE, "declare_attack", target)
	assert.notEqual(state.state, "ops_attack")
	assert.ok(state.combat_window || state.combat || state.pending_retreat)
})

test("one unit may use strategic redeployment only once per SR action", () => {
	const state = rules.setup(903)
	const [unit] = unitsFor(state, "ap", 1, "corps")
	const source = data.spaces.find((space) => space.supply && space.faction === "ap")
	state.units = [unit]
	state.control = Object.fromEntries(data.spaces.map((space) => [space.id, "ap"]))
	unit.location = source.id
	state.active = "ap"
	state.state = "sr"
	state.sr = { card: null, remaining: 4, used_units: [] }
	rules._test.updateSupply(state)
	rules.action(state, AP_ROLE, "select_sr_unit", unit.id)
	const firstDestination = rules.view(state, AP_ROLE).actions.sr_destination[0]

	rules.action(state, AP_ROLE, "sr_destination", firstDestination)
	assert.deepEqual(state.sr.used_units, [unit.id])
	assert.equal(rules.view(state, AP_ROLE).actions.select_sr_unit?.includes(unit.id) || false, false)
	const remaining = state.sr.remaining

	rules.action(state, AP_ROLE, "sr_destination", source.id)
	assert.equal(unit.location, firstDestination)
	assert.equal(state.sr.remaining, remaining)
})

test("an activated space receives only one entrench attempt", () => {
	const state = opsState(904)
	const space = data.spaces.find(
		(candidate) => !["mountain", "alpine", "swamp"].includes(candidate.terrain)
	).id
	const [unit] = unitsFor(state, "ap", 1)
	const card = data.cards.find((candidate) => candidate.id === 608)
	const rule = data.card_effects[608].operations.find(
		(operation) => operation.type === "rule_modifier"
	)
	state.units = [unit]
	unit.location = space
	state.activations[space] = "move"
	state.events[card.event] = { faction: "ap", rule }
	state.state = "ops_construct"
	state.ops.execution_phase = "construct"
	state.ops.execution_origin = space
	state.ops.activated_units = { [space]: [unit.id] }

	rules.action(state, AP_ROLE, "entrench", space)
	assert.deepEqual(state.ops.entrench_attempted, [space])
	assert.equal(rules.view(state, AP_ROLE).actions.entrench?.includes(space) || false, false)
	const level = state.trenches[space] || 0

	rules.action(state, AP_ROLE, "entrench", space)
	assert.equal(state.trenches[space] || 0, level)
})

function constructionState(seed, armies, corps) {
	const state = opsState(seed)
	const space = data.spaces.find(
		(candidate) => !["mountain", "alpine", "swamp"].includes(candidate.terrain)
	).id
	const piece = (unit) => data.pieces.find((candidate) => candidate.id === unit.piece)
	const selectedArmies = state.units
		.filter((unit) => unit.faction === "ap" && unit.type === "army" && !piece(unit)?.veteran)
		.slice(0, armies)
	const selectedCorps = state.units
		.filter((unit) => unit.faction === "ap" && unit.type === "corps" && !piece(unit)?.veteran)
		.slice(0, corps)
	const units = [...selectedArmies, ...selectedCorps]
	assert.equal(selectedArmies.length, armies)
	assert.equal(selectedCorps.length, corps)
	const card = data.cards.find((candidate) => candidate.id === 608)
	const rule = data.card_effects[608].operations.find(
		(operation) => operation.type === "rule_modifier"
	)
	state.turn = 4
	state.commitment.ap = "limited"
	state.units = units
	state.activations[space] = "construct"
	state.events[card.event] = { faction: "ap", rule }
	state.state = "ops_construct"
	state.ops.execution_phase = "construct"
	state.ops.execution_origin = space
	state.ops.activated_units = { [space]: units.map((unit) => unit.id) }
	for (const unit of units) {
		unit.location = space
		unit.moved = false
		unit.attacked = false
	}
	return { state, space }
}

test("LCU construction is a fixed three points and does not add SCU points", () => {
	const { state, space } = constructionState(906, 2, 2)
	rules.action(state, AP_ROLE, "entrench", space)
	assert.equal(state.fortifications[space], 3)
})

test("SCU-only construction gains one point per SCU", () => {
	const { state, space } = constructionState(907, 0, 3)
	rules.action(state, AP_ROLE, "entrench", space)
	assert.equal(state.fortifications[space], 3)
})

test("a retreating unit cannot be voluntarily eliminated while a route exists", () => {
	const state = rules.setup(905)
	const [origin] = landPair()
	const [unit] = unitsFor(state, "ap", 1)
	state.units = [unit]
	unit.location = origin
	state.control = Object.fromEntries(data.spaces.map((space) => [space.id, "ap"]))
	state.active = "ap"
	state.state = "retreat"
	state.combat = { attacker: "cp" }
	state.pending_retreat = {
		faction: "ap",
		units: [unit.id],
		steps: 1,
		from: origin,
		remaining: { [unit.id]: 1 },
		paths: { [unit.id]: [origin] }
	}
	assert.equal(rules.view(state, AP_ROLE).actions.select_retreat_unit.includes(unit.id), true)
	assert.deepEqual(rules.view(state, AP_ROLE).actions.eliminate || [], [])

	rules.action(state, AP_ROLE, "eliminate", unit.id)
	assert.equal(state.units.includes(unit), true)
	assert.equal(unit.location, origin)
})

test("one legal loss cancels retreat for the whole defending stack", () => {
	const state = rules.setup(906)
	const [origin] = landPair()
	const retreaters = unitsFor(state, "ap", 2)
	state.units = retreaters
	for (const unit of retreaters) {
		unit.location = origin
		unit.reduced = false
	}
	state.active = "ap"
	state.state = "retreat"
	state.combat = { attacker: "cp" }
	state.pending_retreat = {
		faction: "ap",
		units: retreaters.map((unit) => unit.id),
		steps: 1,
		from: origin,
		remaining: Object.fromEntries(retreaters.map((unit) => [unit.id, 1])),
		paths: Object.fromEntries(retreaters.map((unit) => [unit.id, [origin]])),
		can_cancel_with_loss: true,
		prohibit_damaged_cancel: false
	}

	rules.action(state, AP_ROLE, "cancel_retreat", retreaters[0].id)
	assert.notEqual(state.state, "retreat")
	assert.equal(state.pending_retreat, null)
	assert.equal(retreaters[0].reduced, true)
	assert.equal(retreaters[1].reduced, false)
})

test("advance after combat cannot overstack the destination", () => {
	const state = rules.setup(907)
	const [origin, target] = landPair()
	const apUnits = unitsFor(state, "ap", 4).filter((unit) => unit.type !== "hq")
	assert.equal(apUnits.length, 4)
	const [advancing, ...occupants] = apUnits
	state.units = apUnits
	advancing.location = origin
	for (const unit of occupants) unit.location = target
	state.active = "ap"
	state.state = "advance_select"
	state.combat = { attacker: "ap", modifiers: { cards: [] } }
	state.pending_retreat = {
		units: [advancing.id],
		target,
		maximum: null,
		advanced: 0
	}

	assert.deepEqual(rules.view(state, AP_ROLE).actions.select_advance_unit || [], [])
	rules.action(state, AP_ROLE, "select_advance_unit", advancing.id)
	assert.equal(advancing.location, origin)
})

test("a rolled combat clears every pre-combat undo snapshot", () => {
	const state = rules.setup(910)
	const [origin, target] = landPair()
	const [attacker] = unitsFor(state, "ap", 1, "army")
	const [defender] = unitsFor(state, "cp", 1, "army")
	state.units = [attacker, defender]
	attacker.location = origin
	defender.location = target
	state.active = "ap"
	state.combat_window = {
		attacker: "ap",
		defender: "cp",
		cards: []
	}
	state.undo = [{ label: "Declare attack", state: { state: "ops_attack" } }]
	state.rollback = [{ turn: 1, round: 1, kind: "action-round", label: "before combat", state: { state: "action_card" } }]

	rules._test.resolveCombat(state, {
		attackers: [attacker.id],
		target,
		flank: false
	})

	assert.equal(state.combat.target, target)
	assert.deepEqual(state.undo, [])
	assert.deepEqual(state.rollback, [])
	assert.equal(rules.view(state, state.active === "ap" ? AP_ROLE : "Central Powers").actions.undo, undefined)
	assert.equal(rules.view(state, state.active === "ap" ? AP_ROLE : "Central Powers").actions.propose_rollback, undefined)
})

test("undo after an advance returns only to the pre-advance state", () => {
	const state = rules.setup(911)
	const [origin, target] = landPair()
	const [attacker] = unitsFor(state, "ap", 1, "army")
	state.units = [attacker]
	attacker.location = origin
	state.active = "ap"
	state.state = "advance_select"
	state.ops = {
		card: null,
		remaining: 0,
		activated: [],
		attacked_units: [],
		forced_attacks: [],
		prohibit_attack: false,
		execution_phase: "attack"
	}
	state.combat = {
		attacker: "ap",
		defender: "cp",
		target,
		attackers: [attacker.id],
		defenders: [],
		declaration: { attackers: [attacker.id], target },
		modifiers: { cards: [], prohibit_advance: [], cancel_advance: [] },
		resolution_events: []
	}
	state.pending_retreat = {
		units: [attacker.id],
		advance_units: [attacker.id],
		target,
		maximum: null,
		advanced: 0,
		advanced_ids: [],
		selected_advance_units: [],
		advance_group: null,
		retreat_paths: [],
		advance_max_steps: 1
	}
	state.undo = []

	rules._test.advanceDeterministicStates(state)
	assert.deepEqual(rules.view(state, AP_ROLE).actions.select_advance_unit, [attacker.id])
	rules.action(state, AP_ROLE, "select_advance_unit", attacker.id)
	assert.equal(state.units.find((unit) => unit.id === attacker.id).location, target)
	assert.equal(state.undo.length, 1)

	rules.action(state, AP_ROLE, "undo")
	assert.equal(state.state, "advance_select")
	assert.equal(state.units.find((unit) => unit.id === attacker.id).location, origin)
	assert.deepEqual(state.undo, [])
	assert.equal(rules.view(state, AP_ROLE).actions.undo, undefined)
})

test("Turkish front maintenance preserves half replacement points", () => {
	const state = rules.setup(908)
	state.events["cp_土耳其参战"] = true
	state.events.entry_tu = true
	state.fronts.russian = 0
	state.fronts.turkish = 2
	state.rp.cp.east = 5
	state.rp.cp.ge = 3
	state.rp.ap.br = 5

	assert.equal(rules._test.beginFrontMaintenance(state), true)
	let guard = 0
	while (state.pending_event?.kind === "front_maintenance" && guard++ < 30) {
		const actions = rules.view(state, state.active === "cp" ? "Central Powers" : AP_ROLE).actions
		const pool = state.pending_event.obligations[state.pending_event.index].pool
		const payment = pool === "east" ? "pay:east" : pool === "ah" ? "pay:ge" : "pay:br"
		const choice = actions.event_choose.find((candidate) => candidate === payment)
		assert.ok(choice)
		rules.action(
			state,
			state.active === "cp" ? "Central Powers" : AP_ROLE,
			"event_choose",
			choice
		)
	}
	assert.ok(guard < 30)
	assert.equal(state.rp.cp.east, 4)
	assert.equal(state.rp.ap.br, 3.5)
})
