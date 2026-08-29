"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")

const data = require("../data.js")
const rules = require("../rules.js")

const AP_ROLE = "Allied Powers"
const CP_ROLE = "Central Powers"
const pieceById = Object.fromEntries(data.pieces.map((piece) => [piece.id, piece]))

function makeUnit(id, faction, location) {
	const piece = data.pieces.find(
		(candidate) => candidate.faction === faction && candidate.type === "army"
	)
	return {
		id,
		piece: piece.id,
		faction,
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

function westernLandPair() {
	const spaces = new Map(data.spaces.map((space) => [space.id, space]))
	const edge = data.edges.find(
		(candidate) =>
			candidate.type === "land" &&
			!candidate.requires_land_attack_support &&
			!["it", "ah"].includes(spaces.get(candidate.a)?.nation) &&
			!["it", "ah"].includes(spaces.get(candidate.b)?.nation) &&
			!spaces.get(candidate.a)?.large_area &&
			!spaces.get(candidate.b)?.fort
	)
	assert.ok(edge)
	return [edge.a, edge.b]
}

function westernLandChain() {
	const spaces = new Map(data.spaces.map((space) => [space.id, space]))
	for (const middle of data.spaces) {
		if (["it", "ah"].includes(middle.nation) || middle.large_area || middle.fort) continue
		const neighbors = middle.connections.filter(
			(id) =>
				!(["it", "ah"].includes(spaces.get(id)?.nation)) &&
				!spaces.get(id)?.large_area &&
				!spaces.get(id)?.fort &&
				data.edges.some(
					(edge) =>
						edge.type === "land" &&
						!edge.requires_land_attack_support &&
						((edge.a === middle.id && edge.b === id) || (edge.b === middle.id && edge.a === id))
				)
		)
		if (neighbors.length >= 2) return [neighbors[0], middle.id, neighbors[1]]
	}
	throw new Error("No Western land chain")
}

function opsState(turn, units, remaining = 4) {
	const state = rules.setup(9800 + turn)
	state.turn = turn
	state.active = "ap"
	state.state = "ops_activate"
	state.units = units
	state.activations = {}
	state.control = Object.fromEntries(data.spaces.map((space) => [space.id, space.control || space.faction]))
	for (const unit of units) state.control[unit.location] = unit.faction
	state.ops = {
		card: null,
		total: remaining,
		remaining,
		italian_bonus: 0,
		activated: [],
		moving: null,
		preactivation_sr_used: [],
		preactivation_sr_units: [],
		entrench_attempted: [],
		pending_siege: null,
		pending_activation: null,
		activated_units: {}
	}
	return state
}

test("attack activation is unavailable when no unit has a legal adjacent target", () => {
	const [origin] = westernLandPair()
	for (const turn of [3, 4]) {
		const state = opsState(turn, [makeUnit(`isolated-${turn}`, "ap", origin)])
		const actions = rules.view(state, AP_ROLE).actions
		assert.equal(actions.activate_attack?.includes(origin) || false, false)
	}
})

test("mixed activation is never offered", () => {
	const [origin, target] = westernLandPair()
	for (const turn of [1, 3, 4]) {
		const state = opsState(turn, [
			makeUnit(`attacker-${turn}`, "ap", origin),
			makeUnit(`defender-${turn}`, "cp", target)
		])
		assert.equal("activate_both" in rules.view(state, AP_ROLE).actions, false)
	}
})

test("turns one through three spend all available OP before choosing stacks in any order", () => {
	const candidates = data.spaces.filter(
		(space) => !["it", "ah"].includes(space.nation) && !space.large_area && !space.fort
	)
	const first = makeUnit("first-stack", "ap", candidates[0].id)
	const second = makeUnit("second-stack", "ap", candidates.find((space) => space.id !== first.location).id)
	const state = opsState(3, [first, second], 2)
	state.control = Object.fromEntries(data.spaces.map((space) => [space.id, "ap"]))

	rules.action(state, AP_ROLE, "activate_move", first.location)
	let actions = rules.view(state, AP_ROLE).actions
	assert.equal("select_move_unit" in actions, false)
	assert.equal("finish" in actions, false)
	rules.action(state, AP_ROLE, "finish")
	assert.equal(state.state, "ops_activate")

	rules.action(state, AP_ROLE, "activate_move", second.location)
	actions = rules.view(state, AP_ROLE).actions
	assert.equal(actions.finish, 1)
	rules.action(state, AP_ROLE, "finish")
	assert.equal(state.state, "ops_choose_stack")
	assert.deepEqual(new Set(rules.view(state, AP_ROLE).actions.resolve_stack), new Set([first.location, second.location]))

	rules.action(state, AP_ROLE, "resolve_stack", second.location)
	assert.equal(state.state, "movement_units")
	actions = rules.view(state, AP_ROLE).actions
	assert.deepEqual(state.ops.move_selection.selected, [second.id])
	assert.equal(actions.deselect_move_unit.includes(first.id), false)
})

test("a turn-one-through-three move activation may attack only after moving next to an enemy", () => {
	const [origin, destination, target] = westernLandChain()
	const attacker = makeUnit("early-mover", "ap", origin)
	const defender = makeUnit("early-target", "cp", target)
	const state = opsState(2, [attacker, defender], 1)
	state.control = Object.fromEntries(data.spaces.map((space) => [space.id, "ap"]))
	state.control[target] = "cp"

	rules.action(state, AP_ROLE, "activate_move", origin)
	rules.action(state, AP_ROLE, "finish")
	rules.action(state, AP_ROLE, "resolve_stack", origin)
	assert.equal(state.state, "movement_units")
	assert.deepEqual(state.ops.move_selection.selected, [attacker.id])
	assert.ok(rules.view(state, AP_ROLE).actions.move.includes(destination))
	rules.action(state, AP_ROLE, "move", destination)
	rules.action(state, AP_ROLE, "stop")
	assert.equal(attacker.attack_eligible, true)
	rules.action(state, AP_ROLE, "finish")
	assert.equal(state.state, "ops_attack")
	const attackView = rules.view(state, AP_ROLE)
	assert.ok(attackView.actions.deselect_attacker.includes(attacker.id))
	assert.ok(attackView.actions.declare_attack.includes(target))
})

test("turn four and later resolve all activations before movement and server-selected attacks", () => {
	const [attackOrigin, target] = westernLandPair()
	const moveOrigin = data.spaces.find(
		(space) =>
			space.id !== attackOrigin &&
			space.id !== target &&
			!["it", "ah"].includes(space.nation) &&
			!space.large_area &&
			space.connections.length
	).id
	const attacker = makeUnit("late-attacker", "ap", attackOrigin)
	const mover = makeUnit("late-mover", "ap", moveOrigin)
	const defender = makeUnit("late-defender", "cp", target)
	const state = opsState(4, [attacker, mover, defender])

	rules.action(state, AP_ROLE, "activate_move", moveOrigin)
	rules.action(state, AP_ROLE, "activate_attack", attackOrigin)
	let actions = rules.view(state, AP_ROLE).actions
	assert.equal(state.state, "ops_activate")
	assert.equal("select_move_unit" in actions, false)
	assert.equal("declare_attack" in actions, false)
	assert.equal("activate_both" in actions, false)

	rules.action(state, AP_ROLE, "finish")
	assert.equal(state.state, "movement_units")
	actions = rules.view(state, AP_ROLE).actions
	assert.deepEqual(state.ops.move_selection.selected, [mover.id])
	assert.equal("declare_attack" in actions, false)

	rules.action(state, AP_ROLE, "finish")
	assert.equal(state.state, "ops_attack")
	actions = rules.view(state, AP_ROLE).actions
	assert.deepEqual(rules.view(state, AP_ROLE).selection.selected, [attacker.id])
	assert.ok(actions.declare_attack.includes(target))
	rules.action(state, AP_ROLE, "declare_attack", target)
	while (rules.view(state, AP_ROLE).actions.select_attack_mo?.length)
		rules.action(state, AP_ROLE, "select_attack_mo", rules.view(state, AP_ROLE).actions.select_attack_mo.at(-1))
	assert.notEqual(state.state, "ops_attack")
	assert.ok(state.combat_window || state.combat || state.pending_retreat)
})

test("movement may cross a friendly full stack but may not stop there", () => {
	const state = rules.setup(1914)
	const mover = state.units.find(
		(unit) =>
			unit.location === "marfeuilles" &&
			unit.faction === "cp" &&
			unit.type === "corps" &&
			pieceById[unit.piece].movement === 5
	)
	assert.ok(mover)
	assert.equal(
		state.units.filter((unit) => unit.location === "sarrebourg" && unit.type !== "hq").length,
		3
	)
	state.turn = 1
	state.active = "cp"
	state.state = "ops_move"
	state.activations = { marfeuilles: "move" }
	state.ops = {
		card: null,
		total: 1,
		remaining: 0,
		activated: ["marfeuilles"],
		moving: null,
		forced_attacks: [],
		preactivation_sr_used: [],
		preactivation_sr_units: [],
		entrench_attempted: [],
		pending_siege: null,
		pending_activation: null,
		activated_units: { marfeuilles: [mover.id] },
		execution_origin: "marfeuilles",
		execution_phase: "move",
		unresolved_stacks: ["marfeuilles"]
	}

	rules.action(state, CP_ROLE, "select_move_unit", mover.id)
	let actions = rules.view(state, CP_ROLE).actions
	assert.ok(actions.move.includes("metz"))
	assert.ok(actions.move.includes("sarrebourg"))
	assert.equal("stop" in actions, false)

	rules.action(state, CP_ROLE, "move", "sarrebourg")
	actions = rules.view(state, CP_ROLE).actions
	assert.equal(mover.location, "sarrebourg")
	assert.equal("stop" in actions, false)
	assert.equal(actions.move.includes("saarbrucken"), false)
	assert.ok(actions.move.includes("strasbourg"))
})
