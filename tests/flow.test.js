"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")

const data = require("../data.js")
const rules = require("../rules.js")
const { setupGame } = require("./setup_game.js")

function isLandConnection(a, b) {
	return data.edges.some(
		(edge) =>
			(edge.type || "land") === "land" &&
			((edge.a === a && edge.b === b) || (edge.a === b && edge.b === a))
	)
}

function chooseFleet(state, role) {
	const actions = rules.view(state, role).actions
	if (actions.naval_fleet?.length) {
		const card = actions.naval_fleet[0]
		rules.action(state, role, "naval_fleet", card)
		return { kind: "fleet", card }
	}
	assert.equal(actions.naval_empty_fleet, 1)
	rules.action(state, role, "naval_empty_fleet")
	return { kind: "fleet", card: null }
}

function finishFleetDispositions(state, dispositions = {}) {
	while (state.state === "naval_disposition") {
		const role = state.active === "cp" ? "Central Powers" : "Allied Powers"
		const choice = dispositions[state.active] || "discard"
		rules.action(state, role, choice === "shuffle" ? "naval_shuffle" : "naval_discard")
	}
}

function confirmMos(state) {
	rules.action(state, "Central Powers", "confirm_mo")
	rules.action(state, "Allied Powers", "confirm_mo")
}

function beginActions(seed = 1) {
	const state = setupGame(seed)
	rules.action(state, "Central Powers", "confirm_mo")
	assert.equal(state.state, "mo_review")
	assert.equal(state.active, "ap")
	rules.action(state, "Allied Powers", "confirm_mo")
	assert.equal(state.state, "naval_choice")
	chooseFleet(state, "Central Powers")
	const apView = rules.view(state, "Allied Powers")
	assert.deepEqual(apView.naval.selections.cp, { kind: "hidden" })
	chooseFleet(state, "Allied Powers")
	finishFleetDispositions(state)
	assert.equal(state.state, "action_card")
	assert.equal(state.active, "cp")
	return state
}

test("VP is clamped to 0-40 without endpoint automatic victory", () => {
	const state = setupGame(4001)
	state.turn = 2
	state.vp = 39
	rules._test.adjustVp(state, 5)
	assert.equal(state.vp, 40)
	assert.equal(rules._test.checkVictory(state), false)
	assert.notEqual(state.state, "game_over")
	rules._test.adjustVp(state, -100)
	assert.equal(state.vp, 0)
	assert.equal(rules._test.checkVictory(state), false)
	assert.notEqual(state.state, "game_over")
})

test("legacy VP values are normalized when a state is viewed", () => {
	const high = setupGame(4002)
	high.vp = 99
	assert.equal(rules.view(high, "Central Powers").vp, 40)
	const low = setupGame(4003)
	low.vp = -12
	assert.equal(rules.view(low, "Allied Powers").vp, 0)
})

test("naval choices are hidden until both sides reveal", () => {
	const state = setupGame(4)
	confirmMos(state)
	state.undo = [{
		label: "海军暗选前旧操作",
		turn: state.turn,
		round: state.action_round,
		actor: "cp",
		state: globalThis.structuredClone({ ...state, undo: [] }),
	}]
	chooseFleet(state, "Central Powers")
	assert.deepEqual(state.undo, [])
	assert.deepEqual(rules.view(state, "Allied Powers").naval.selections.cp, { kind: "hidden" })
	assert.equal(rules.view(state, "Central Powers").naval.selections.cp.kind, "fleet")
})

test("naval Event is limited to legal blue cards while every hand card may be Fleet", () => {
	const state = setupGame(40)
	state.turn = 2
	const blue = data.cards.find((card) => card.faction === "cp" && card.color === "blue")
	const nonBlue = data.cards.find((card) => card.faction === "cp" && card.color !== "blue")
	state.hands.cp = [blue.id, nonBlue.id]
	confirmMos(state)
	const actions = rules.view(state, "Central Powers").actions
	assert.deepEqual(actions.naval_fleet, [blue.id, nonBlue.id])
	assert.equal(actions.naval_event.includes(nonBlue.id), false)
	assert.equal(actions.naval_event.includes(blue.id), true)
})

test("Fleet uses the selected card, U-boat value, blue bonus, and chosen disposition", () => {
	const state = setupGame(41)
	state.naval.track = -2
	state.hands.cp = [700]
	state.hands.ap = [613]
	state.decks.cp = state.decks.cp.filter((id) => id !== 700)
	state.decks.ap = state.decks.ap.filter((id) => id !== 613)
	confirmMos(state)
	rules.action(state, "Central Powers", "naval_fleet", 700)
	rules.action(state, "Allied Powers", "naval_fleet", 613)

	const cpCard = data.cards.find((card) => card.id === 700)
	const apCard = data.cards.find((card) => card.id === 613)
	assert.equal(
		state.naval.points.cp,
		cpCard.ops + 2 + (cpCard.color === "blue" ? 1 : 0)
	)
	assert.equal(
		state.naval.points.ap,
		apCard.ops + 2 + (apCard.color === "blue" ? 1 : 0)
	)
	assert.equal(state.state, "naval_disposition")
	assert.equal(state.active, "cp")
	assert.ok(!state.discard.cp.includes(700))
	assert.ok(!state.decks.ap.includes(613))
	assert.ok(!state.hands.cp.includes(700))
	assert.ok(!state.hands.ap.includes(613))
	rules.action(state, "Central Powers", "naval_discard")
	assert.deepEqual(rules.view(state, "Allied Powers").naval.dispositions.cp, { kind: "hidden" })
	rules.action(state, "Allied Powers", "naval_shuffle")
	assert.ok(state.discard.cp.includes(700))
	assert.ok(!state.discard.ap.includes(613))
	assert.ok(state.decks.ap.includes(613))
	assert.equal(state.state, "action_card")
})

test("a starred card used as Fleet is discarded rather than removed", () => {
	const state = setupGame(4011)
	state.hands.cp = []
	state.hands.ap = [604]
	confirmMos(state)
	rules.action(state, "Central Powers", "naval_empty_fleet")
	rules.action(state, "Allied Powers", "naval_fleet", 604)
	finishFleetDispositions(state, { ap: "discard" })
	assert.equal(state.discard.ap.includes(604), true)
	assert.equal(state.removed.ap.includes(604), false)
})

test("equal naval Event points resolve the AP event first", () => {
	const state = setupGame(42)
	const britishArmy = data.pieces.find(
		(piece) => piece.nation === "br" && piece.type === "army" && piece.group !== "bef"
	)
	state.reserves.ap.push({
		id: "colonies-naval-army",
		piece: britishArmy.id,
		faction: "ap",
		nation: "br",
		type: "army",
		reduced: false
	})
	state.hands.cp = [726]
	state.hands.ap = [613]
	state.commitment.cp = "limited"
	confirmMos(state)
	rules.action(state, "Central Powers", "naval_event", 726)
	rules.action(state, "Allied Powers", "naval_event", 613)
	assert.equal(state.pending_event.card, 613)
	assert.deepEqual(state.naval.event_queue, [{ faction: "cp", card: 726 }])
})

test("a Fleet card waits until all naval Events and the track move are complete", () => {
	const state = setupGame(421)
	state.hands.cp = [700]
	state.hands.ap = [643]
	state.decks.cp = state.decks.cp.filter((id) => id !== 700)
	state.decks.ap = state.decks.ap.filter((id) => id !== 643)
	state.commitment.ap = "total"
	confirmMos(state)
	const before = state.naval.track
	rules.action(state, "Central Powers", "naval_fleet", 700)
	rules.action(state, "Allied Powers", "naval_event", 643)
	assert.equal(state.events.ap_护航.faction, "ap")
	assert.equal(state.naval.pending_fleet_cards.cp, 700)
	assert.equal(state.discard.cp.includes(700), false)
	assert.equal(state.state, "naval_disposition")
	assert.equal(state.active, "cp")
	assert.notEqual(state.naval.track, before)
	assert.equal(state.discard.cp.includes(700), false)
	rules.action(state, "Central Powers", "naval_discard")
	assert.equal(state.state, "action_card")
	assert.equal(state.discard.cp.includes(700), true)
})

test("version seventeen naval choices defer legacy Fleet disposition", () => {
	const state = setupGame(422)
	state.version = 17
	state.state = "naval_choice"
	state.active = "ap"
	state.naval.selections = { cp: { kind: "fleet", card: state.hands.cp[0], disposition: "shuffle" } }
	rules.view(state, "Allied Powers")
	assert.equal(state.version, 46)
	assert.deepEqual(state.naval.selections.cp, { kind: "fleet", card: state.naval.selections.cp.card })
})

test("naval event cards apply persistent effects only after both choices reveal", () => {
	const state = setupGame(43)
	state.hands.cp = [723]
	state.hands.ap = [643]
	state.commitment.cp = "total"
	state.commitment.ap = "total"
	const initialVp = state.vp
	confirmMos(state)
	rules.action(state, "Central Powers", "naval_event", 723)
	assert.equal(state.events.cp_U艇攻势, undefined)
	rules.action(state, "Allied Powers", "naval_event", 643)
	assert.equal(state.events.ap_护航.faction, "ap")
	assert.equal(state.events.cp_U艇攻势, undefined)
	assert.equal(state.naval.points.ap, 4)
	assert.equal(state.vp, initialVp - 1)
	assert.equal(state.state, "action_card")
})

test("naval Event choices execute the same structured track and entry effects as action events", () => {
	const state = setupGame(703)
	state.turn = 2
	state.hands.cp = [703]
	state.hands.ap = []
	state.commitment.cp = "total"
	const startingFront = state.fronts.turkish
	confirmMos(state)
	rules.action(state, "Central Powers", "naval_event", 703)
	assert.equal(state.events.entry_tu, undefined)
	chooseFleet(state, "Allied Powers")
	assert.equal(state.events.entry_tu, true)
	assert.equal(state.fronts.turkish, startingFront)
	assert.equal(state.removed.cp.includes(703), true)
	assert.equal(state.discard.cp.includes(703), false)
	assert.equal(state.state, "action_card")
})

test("naval reinforcement events pause in the standard server target-selection flow", () => {
	const state = setupGame(603)
	const before = {
		units: state.units.length,
		reserves: state.reserves.ap.length,
		upgrade: state.upgrade_pool.ap.length,
		eliminated: state.eliminated.ap.length
	}
	state.hands.cp = []
	state.hands.ap = [603]
	confirmMos(state)
	chooseFleet(state, "Central Powers")
	rules.action(state, "Allied Powers", "naval_event", 603)
	assert.equal(state.state, "event_reinforcement")
	assert.equal(state.pending_event.kind, "reinforcement")
	assert.equal(state.pending_event.card, 603)
	assert.equal(state.pending_event.naval_event, true)
	assert.deepEqual(
		state.pending_event.placements.map((entry) => [entry.piece, entry.space]),
		[
			["component-097", "london"],
			["component-097", "london"],
			["component-007", "london"],
			["component-005", "london"]
		]
	)
	const staged = rules.view(state, "Allied Powers").units.filter((unit) => unit.staged)
	assert.equal(staged.filter((unit) => unit.location === "london").length, 4)
	assert.ok(rules.view(state, "Allied Powers").actions.event_space.length)
	rules.action(state, "Allied Powers", "event_cancel")
	assert.deepEqual(
		{
			units: state.units.length,
			reserves: state.reserves.ap.length,
			upgrade: state.upgrade_pool.ap.length,
			eliminated: state.eliminated.ap.length
		},
		before
	)
	assert.equal(rules.view(state, "Allied Powers").units.some((unit) => unit.staged), false)
})

test("Jutland suppresses the current annual blockade VP loss and turn effects expire afterwards", () => {
	const resolveTurnFour = (withJutland) => {
		const state = setupGame(755)
		state.turn = 4
		state.action_round = 6
		state.state = "replacement"
		state.phase = "补员/升级"
		state.active = "ap"
		state.replacement_active = "ap"
		const blockade = data.cards.find((card) => card.id === 606)
		const blockadeRule = data.card_effects[606].operations.find(
			(operation) => operation.type === "rule_modifier"
		)
		state.events[blockade.event] = { faction: "ap", rule: blockadeRule, duration: "game" }
		if (withJutland) {
			const jutland = data.cards.find((card) => card.id === 755)
			const jutlandRule = data.card_effects[755].operations.find(
				(operation) => operation.type === "rule_modifier"
			)
			state.events[jutland.event] = {
				faction: "cp",
				turn: 4,
				rule: jutlandRule,
				duration: "turn"
			}
		}
		const vp = state.vp
		rules.action(state, "Allied Powers", "finish")
		if (state.state === "replacement" && state.active === "cp")
			rules.action(state, "Central Powers", "finish")
		while (state.state === "draw_discard") {
			const role = state.active === "cp" ? "Central Powers" : "Allied Powers"
			rules.action(state, role, "done")
		}
		return { state, vp }
	}

	const suppressed = resolveTurnFour(true)
	assert.equal(suppressed.state.vp, suppressed.vp)
	assert.equal(suppressed.state.events.cp_日德兰海战, undefined)
	assert.ok(suppressed.state.events.ap_皇家海军封锁)
	const unsuppressed = resolveTurnFour(false)
	assert.equal(unsuppressed.state.vp, unsuppressed.vp - 1)
})

test("six action rounds advance to replacement and next turn", () => {
	const state = beginActions(5)
	for (const [nation, ids] of Object.entries(state.mo.current))
		state.mo.completed[nation] = ids.slice()
	for (let round = 1; round <= 6; round++) {
		assert.equal(state.action_round, round)
		rules.action(state, "Central Powers", "one_op")
		assert.equal(state.state, "ops_activate")
		let actions = rules.view(state, "Central Powers").actions
		rules.action(state, "Central Powers", "activate_move", actions.activate_move[0])
		rules.action(state, "Central Powers", "finish")
		actions = rules.view(state, "Central Powers").actions
		rules.action(state, "Central Powers", "resolve_stack", actions.resolve_stack[0])
		rules.action(state, "Central Powers", "finish")
		assert.equal(state.active, "ap")
		rules.action(state, "Allied Powers", "one_op")
		actions = rules.view(state, "Allied Powers").actions
		rules.action(state, "Allied Powers", "activate_move", actions.activate_move[0])
		rules.action(state, "Allied Powers", "finish")
		actions = rules.view(state, "Allied Powers").actions
		rules.action(state, "Allied Powers", "resolve_stack", actions.resolve_stack[0])
		rules.action(state, "Allied Powers", "finish")
	}
	assert.equal(state.pending_event.kind, "front_maintenance")
	let guard = 0
	while (state.pending_event?.kind === "front_maintenance" && guard++ < 100) {
		const role = state.active === "cp" ? "Central Powers" : "Allied Powers"
		const actions = rules.view(state, role).actions
		const action = actions.event_choose?.length
			? "event_choose"
			: "front_maintenance_loss"
		const choice = actions[action]?.[0]
		assert.ok(choice)
		rules.action(state, role, action, choice)
	}
	assert.ok(guard < 100)
	assert.equal(state.state, "replacement")
	assert.equal(state.active, "ap")
	rules.action(state, "Allied Powers", "finish")
	rules.action(state, "Central Powers", "finish")
	while (state.state === "draw_discard") {
		const role = state.active === "cp" ? "Central Powers" : "Allied Powers"
		rules.action(state, role, "done")
	}
	assert.equal(state.turn, 2)
	assert.equal(state.state, "mo_review")
	assert.equal(state.action_round, 0)
})

test("undo cannot cross the opposing faction's completed MO confirmation", () => {
	const state = setupGame(11)
	const seed = state.seed
	rules.action(state, "Central Powers", "confirm_mo")
	rules.action(state, "Allied Powers", "confirm_mo")
	assert.equal(state.state, "naval_choice")
	rules.action(state, "Central Powers", "undo")
	assert.equal(state.state, "naval_choice")
	assert.equal(state.seed, seed)
})

test("corps and army fire tables clamp to legal columns", () => {
	assert.equal(rules._test.fireResult("corps", 99, 6), 3)
	assert.equal(rules._test.fireResult("army", 99, 6), 6)
	assert.equal(rules._test.fireResult("army", 1, 1), 0)
})

test("same seed and legal action sequence produce identical replay state", () => {
	const first = beginActions(91)
	const second = beginActions(91)
	for (const state of [first, second]) {
		rules.action(state, "Central Powers", "one_op")
		rules.action(state, "Central Powers", "finish")
		rules.action(state, "Allied Powers", "one_op")
		rules.action(state, "Allied Powers", "finish")
	}
	assert.deepEqual(first, second)
})

test("combat cards are committed privately before combat and expire afterwards", () => {
	const state = setupGame(23)
	const spaces = Object.fromEntries(data.spaces.map((space) => [space.id, space]))
	const attacker = state.units.find((unit) =>
		state.units.some(
			(defender) =>
				defender.faction !== unit.faction &&
				spaces[unit.location]?.connections.includes(defender.location) &&
				isLandConnection(unit.location, defender.location)
		)
	)
	const defender = state.units.find(
		(unit) =>
			unit.faction !== attacker.faction &&
			spaces[attacker.location].connections.includes(unit.location) &&
			isLandConnection(attacker.location, unit.location)
	)
	const apCard = data.cards.find((card) => card.id === 621)
	// 702 is an attacker-only CP card. This fixture begins with an AP attack,
	// so use the CP defensive card that accepts the Belgian attacker instead.
	const cpCard = data.cards.find((card) => card.id === 731)
	state.active = attacker.faction
	state.state = "ops_attack"
	state.phase = "行动阶段"
	state.ops = { remaining: 3, activated: [attacker.location], activated_units: { [attacker.location]: [attacker.id] }, attack_selection: [], attacked_units: [], forced_attacks: [], execution_phase: "attack" }
	state.activations = { [attacker.location]: "attack" }
	state.hands.ap = [apCard.id]
	state.hands.cp = [cpCard.id]
	const attackerRole = attacker.faction === "ap" ? "Allied Powers" : "Central Powers"
	const defenderRole = attacker.faction === "ap" ? "Central Powers" : "Allied Powers"
	const firstCard = attacker.faction === "ap" ? apCard : cpCard
	const secondCard = attacker.faction === "ap" ? cpCard : apCard

	rules.action(state, attackerRole, "select_attacker", attacker.id)
	rules.action(state, attackerRole, "declare_attack", defender.location)
	while (rules.view(state, attackerRole).actions.select_attack_mo?.length)
		rules.action(state, attackerRole, "select_attack_mo", rules.view(state, attackerRole).actions.select_attack_mo.at(-1))
	if (state.state === "defense_mo") {
		while (rules.view(state, defenderRole).actions.select_defense_mo?.length)
			rules.action(state, defenderRole, "select_defense_mo", rules.view(state, defenderRole).actions.select_defense_mo.at(-1))
	}
	assert.equal(state.state, "combat_card_window")
	assert.equal(rules.view(state, attackerRole).actions.combat_card.includes(firstCard.id), true)
	rules.action(state, attackerRole, "combat_card", firstCard.id)
	rules.action(state, attackerRole, "pass")
	assert.equal(state.active, defender.faction)
	assert.equal(rules.view(state, defenderRole).actions.combat_card.includes(secondCard.id), true)
	rules.action(state, defenderRole, "combat_card", secondCard.id)
	rules.action(state, defenderRole, "pass")
	assert.equal(state.state, "combat_losses")

	while (state.state === "combat_losses") {
		const role = state.active === "ap" ? "Allied Powers" : "Central Powers"
		const actions = rules.view(state, role).actions
		if (actions.take_loss?.length) rules.action(state, role, "take_loss", actions.take_loss[0])
		else rules._test.advanceDeterministicStates(state)
	}
	if (state.state === "combat_card_disposition") {
		const role = state.active === "ap" ? "Allied Powers" : "Central Powers"
		const id = rules.view(state, role).actions.retain_combat_card[0]
		rules.action(state, role, "retain_combat_card", id)
	}
	if (state.state === "retreat") {
		const role = state.active === "ap" ? "Allied Powers" : "Central Powers"
		for (const id of [...state.pending_retreat.units]) rules.action(state, role, "eliminate", id)
	}
	if (state.state === "advance") rules.action(state, attackerRole, "finish")
	assert.equal(state.state, "ops_attack")
	assert.equal(state.events[firstCard.event], undefined)
	assert.equal(state.events[secondCard.event], undefined)
})

test("replacement points flip and veteran-upgrade units through server actions", () => {
	const state = setupGame(31)
	const unit = state.units.find((candidate) => candidate.faction === "ap")
	const key =
		unit.nation === "fr"
			? "fr"
			: unit.nation === "it"
				? "it"
				: ["us", "be"].includes(unit.nation)
					? "us"
					: "br"
	state.state = "replacement"
	state.phase = "补员阶段"
	state.active = "ap"
	state.commitment.ap = "limited"
	state.rp.ap[key] = 3
	unit.reduced = true
	const repairCost = unit.type === "army" ? 1 : 0.5
	rules.action(state, "Allied Powers", "spend_flip", unit.id)
	assert.equal(unit.reduced, false)
	assert.equal(state.rp.ap[key], 3 - repairCost)
	const veteran = data.pieces.find(
		(piece) =>
			piece.veteran &&
			piece.nation === unit.nation &&
			piece.type === unit.type &&
			Boolean(piece.cavalry) === Boolean(data.pieces.find((candidate) => candidate.id === unit.piece)?.cavalry)
	)
	if (veteran) {
		const poolBefore = state.upgrade_pool.ap.length
		rules.action(state, "Allied Powers", "spend_upgrade", unit.id)
		assert.equal(state.pending_event.kind, "veteran_upgrade")
		const destination = rules.view(state, "Allied Powers").actions.event_space[0]
		rules.action(state, "Allied Powers", "event_space", destination)
		assert.equal(
			data.pieces.find(
				(piece) => piece.id === state.units.find((candidate) => candidate.id === unit.id).piece
			)?.veteran,
			true
		)
		assert.equal(state.rp.ap[key], 3 - repairCost)
		assert.equal(state.upgrade_pool.ap.length, poolBefore - 1)
		assert.equal(state.permanently_removed_units.some((entry) =>
			entry.removed_by === "veteran_upgrade" && entry.piece === unit.piece), true)
	}
})

test("isolated units are marked out of supply and cannot use strategic redeployment", () => {
	const state = setupGame(47)
	const supplied = rules._test.suppliedSpaces(state, "ap")
	const isolated = data.spaces.find((space) => !supplied.has(space.id))
	assert.ok(isolated)
	const unit = state.units.find((candidate) => candidate.faction === "ap")
	unit.location = isolated.id
	rules._test.updateSupply(state)
	assert.equal(unit.supplied, false)
	assert.deepEqual(rules._test.srDestinations(state, unit), [])
})

test("movement uses a server-validated path and changes control one space at a time", () => {
	const state = setupGame(81)
	const unit = state.units.find((candidate) => candidate.faction === "cp" && (data.pieces.find((piece) => piece.id === candidate.piece)?.movement || 0) >= 3)
	state.turn = 4
	state.units = [unit]
	unit.moved = false
	unit.fort_limited_supply = false
	state.active = "cp"
	let origin = null
	let route = null
	for (const space of data.spaces) {
		unit.location = space.id
		state.activations = { [space.id]: "move" }
		const candidate = Object.values(rules._test.movementPaths(state, unit)).find((path) => path.length >= 2)
		if (candidate) {
			origin = space
			route = candidate
			break
		}
	}
	assert.ok(origin)
	assert.ok(route)
	const [middle, destination] = route
	state.state = "movement"
	state.ops = { moving: unit.id, remaining: 1, activated: [origin.id] }
	state.activations = { [origin.id]: "move" }
	const role = "Central Powers"
	let actions = rules.view(state, role).actions
	assert.ok(actions.move.includes(middle))
	assert.equal(actions.move.includes(destination), false)

	rules.action(state, role, "move", [middle, destination])
	assert.equal(unit.location, origin.id)

	rules.action(state, role, "move", middle)
	assert.equal(unit.location, middle)
	assert.deepEqual(unit.movement_path, [middle])
	assert.equal(state.control[middle], "cp")
	assert.equal(state.state, "movement")
	actions = rules.view(state, role).actions
	assert.ok(actions.move.includes(destination))
	assert.equal(actions.stop, 1)

	rules.action(state, role, "move", destination)
	assert.equal(unit.location, destination)
	assert.deepEqual(unit.movement_path, [middle, destination])
	assert.equal(state.control[destination], "cp")
	if (state.state === "movement") rules.action(state, role, "stop")
	assert.equal(unit.moved, true)
	assert.equal(state.state, "ops_activate")
})

test("AP movement can cross an ordinary Channel connection", () => {
	const state = setupGame(82)
	const unit = state.units.find((candidate) => candidate.faction === "ap")
	state.units = [unit]
	unit.location = "dover"
	state.turn = 4
	state.active = "ap"
	state.state = "movement"
	state.ops = { moving: unit.id, remaining: 1, activated: ["dover"] }
	state.activations = { dover: "move" }
	assert.equal(rules.view(state, "Allied Powers").actions.move.includes("calais"), true)
	rules.action(state, "Allied Powers", "move", "calais")
	assert.equal(unit.location, "calais")
})

test("two-space retreats remain pending until every retreat step is completed", () => {
	const state = setupGame(83)
	const unit = state.units.find((candidate) => candidate.faction === "ap")
	const spaces = Object.fromEntries(data.spaces.map((space) => [space.id, space]))
	const land = (a, b) =>
		data.edges.some(
			(edge) =>
				edge.type === "land" &&
				((edge.a === a && edge.b === b) || (edge.a === b && edge.b === a))
		)
	const origin = data.spaces.find((space) =>
		space.connections.some((first) =>
			spaces[first]?.connections.some((second) => second !== space.id && land(space.id, first) && land(first, second))
		)
	)
	const first = origin.connections.find((candidate) =>
		spaces[candidate]?.connections.some(
			(second) => second !== origin.id && land(origin.id, candidate) && land(candidate, second)
		)
	)
	const second = spaces[first].connections.find((candidate) => candidate !== origin.id && land(first, candidate))
	state.units = [unit]
	unit.location = origin.id
	state.control = Object.fromEntries(data.spaces.map((space) => [space.id, "ap"]))
	state.active = "ap"
	state.state = "retreat"
	state.combat = { attacker: "cp", modifiers: { cards: [] } }
	state.pending_retreat = {
		faction: "ap",
		units: [unit.id],
		steps: 2,
		from: origin.id,
		remaining: { [unit.id]: 2 },
		paths: { [unit.id]: [origin.id] }
	}
	rules.action(state, "Allied Powers", "select_retreat_unit", unit.id)
	assert.equal(state.pending_retreat.target, origin.id)
	assert.equal(state.combat.target, origin.id)
	rules.action(state, "Allied Powers", "retreat_destination", first)
	assert.equal(state.state, "retreat")
	assert.equal(state.pending_retreat.remaining[unit.id], 1)
	assert.ok(rules.view(state, "Allied Powers").actions.retreat_destination.length)
	assert.equal(rules.view(state, "Allied Powers").actions.retreat_destination.includes(origin.id), false)
	rules.action(state, "Allied Powers", "retreat_destination", second)
	assert.equal(state.state, "ops_activate")
	assert.equal(unit.location, second)
})

test("600 War Aid exchanges RP only during AP replacement and enforces the two-point turn limit", () => {
	const state = setupGame(84)
	const event = data.cards.find((card) => card.id === 600).event
	state.events[event] = { faction: "ap", persistent: true }
	state.state = "replacement"
	state.phase = "补员/升级"
	state.active = "ap"
	state.rp.ap.br = 3
	state.rp.ap.fr = 0
	const actions = rules.view(state, "Allied Powers").actions.event_exchange
	assert.ok(actions.includes("br_to_fr:2"))
	rules.action(state, "Allied Powers", "event_exchange", "br_to_fr:2")
	assert.equal(state.rp.ap.br, 1)
	assert.equal(state.rp.ap.fr, 2)
	assert.equal(state.usage_limits[`war_aid:${state.turn}`], 2)
	rules.action(state, "Allied Powers", "event_exchange", "fr_to_br:1")
	assert.equal(state.rp.ap.fr, 2)
})
