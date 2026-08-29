"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const data = require("../data.js")
const protocol = require("../action-protocol.js")
const rules = require("../rules.js")
const { setupGame } = require("./setup_game.js")

const AP_ROLE = "Allied Powers"
const CP_ROLE = "Central Powers"
const protocolView = rules.protocolView || rules.view
const protocolAction = rules.protocolAction || rules.action

test("action presentation routes utilities away from the top action area", () => {
	assert.equal(protocol.catalog.confirm_attack, undefined)
	assert.equal(protocol.catalog.confirm_defense_mo, undefined)
	assert.equal(protocol.catalog.finish_losses, undefined)
	assert.equal(protocol.catalog.cancel_retreat_unit, undefined)
	assert.equal(protocol.catalog.deselect_advance_unit, undefined)
	assert.equal(protocol.catalog.advance, undefined)
	assert.equal(protocol.surfaceFor("undo"), "top")
	assert.equal(protocol.surfaceFor("propose_rollback"), "toolbar")
	assert.equal(protocol.surfaceFor("flag_supply_warnings"), "toolbar")
	assert.equal(protocol.surfaceFor("select_move_unit"), "target")
	assert.equal(protocol.surfaceFor("declare_attack"), "target")
	assert.equal(protocol.surfaceFor("select_attack_mo"), "target")
	assert.equal(protocol.surfaceFor("select_event_unit"), "target")
	assert.equal(protocol.surfaceFor("deselect_event_unit"), "target")
	assert.equal(protocol.surfaceFor("voluntary_destroy_unit"), "target")
	assert.equal(protocol.catalog.choose_replacement.target, "piece")
	for (const [action, entry] of Object.entries(protocol.catalog))
		if (entry.target === "piece")
			assert.equal(protocol.surfaceFor(action), "target", `${action} must be handled by its piece`)
	assert.equal(protocol.surfaceFor("event_choose"), "top")
	const client = fs.readFileSync(path.join(__dirname, "..", "play.js"), "utf8")
	assert.match(client, /select_attack_mo.*endsWith\(":none"\)/s)
	assert.doesNotMatch(client, /for \(const entries of targetIndex\.pieces\.values\(\)\)/)
})

test("public deck contents are sorted without exposing the draw order", () => {
	const state = setupGame(26000)
	state.decks.ap = [602, 600, 601]
	state.decks.cp = [703, 701, 702]
	const storedApOrder = state.decks.ap.slice()
	const storedCpOrder = state.decks.cp.slice()
	for (const role of [AP_ROLE, CP_ROLE, "Observer"]) {
		const current = protocolView(state, role)
		assert.deepEqual(current.deck_cards.ap, [600, 601, 602])
		assert.deepEqual(current.deck_cards.cp, [701, 702, 703])
	}
	assert.deepEqual(state.decks.ap, storedApOrder)
	assert.deepEqual(state.decks.cp, storedCpOrder)
})

function makeUnit(id, faction, location) {
	const piece = data.pieces.find(
		(candidate) => candidate.faction === faction && candidate.type === "army"
	)
	return {
		id,
		piece: piece.id,
		faction,
		nation: piece.nation,
		type: "army",
		location,
		reduced: false,
		moved: false,
		attacked: false,
		supplied: true,
		limited_supply: false,
		fort_limited_supply: false
	}
}

function westernPair() {
	const spaces = new Map(data.spaces.map((space) => [space.id, space]))
	const edge = data.edges.find(
		(candidate) =>
			(candidate.type || "land") === "land" &&
			!["it", "ah"].includes(spaces.get(candidate.a)?.nation) &&
			!["it", "ah"].includes(spaces.get(candidate.b)?.nation) &&
			!spaces.get(candidate.a)?.large_area &&
			!spaces.get(candidate.b)?.fort
	)
	return [edge.a, edge.b]
}

function westernFork() {
	const spaces = new Map(data.spaces.map((space) => [space.id, space]))
	for (const target of data.spaces) {
		if (!["clear", "forest"].includes(target.terrain) || target.fort || target.large_area || ["it", "ah"].includes(target.nation)) continue
		const neighbors = target.connections.filter(
			(id) =>
				!["it", "ah"].includes(spaces.get(id)?.nation) &&
				data.edges.some(
					(edge) =>
						(edge.type || "land") === "land" &&
						!edge.alpine &&
						edge.modes.includes("attack") &&
						edge.factions.includes("ap") &&
						((edge.a === target.id && edge.b === id) || (edge.b === target.id && edge.a === id))
				)
		)
		if (neighbors.length >= 2) return [neighbors[0], neighbors[1], target.id]
	}
	throw new Error("No Western two-origin attack fixture")
}

function opsState(units, remaining = 4) {
	const state = setupGame(26001)
	state.turn = 4
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
		combat_effect: null,
		activated: [],
		activated_units: {},
		pending_activation: null,
		pending_attack: null,
		attack_selection: [],
		moving: null,
		forced_attacks: [],
		preactivation_sr_used: [],
		preactivation_sr_units: [],
		entrench_attempted: [],
		pending_siege: null
	}
	return state
}

test("action protocol accepts only non-empty primitive action arrays", () => {
	assert.doesNotThrow(() => protocol.validate({ finish: 1, disabled: 0, move: ["paris", 2] }))
	for (const actions of [
		{ move: [] },
		{ move: [{ id: "paris" }] },
		{ move: [["paris"]] },
		{ move: ["paris", "paris"] },
		{ move: true }
	]) assert.throws(() => protocol.validate(actions))
})

test("all public views use protocol version 1 and primitive legal actions", () => {
	const state = setupGame(26002)
	const active = protocolView(state, CP_ROLE)
	assert.equal(active.action_protocol, 1)
	assert.equal(protocol.validate(active.actions), active.actions)
	assert.deepEqual(protocolView(state, AP_ROLE).actions, {})
	assert.deepEqual(protocolView(state, "Observer").actions, {})
})

test("action choices create one public structured history entry per faction slot", () => {
	const uses = [
		["card_ops", "ops"],
		["card_sr", "sr"],
		["card_rp", "rp"],
		["card_event", "event"]
	]
	for (const [action, type] of uses) {
		const state = setupGame(26100 + uses.findIndex((entry) => entry[0] === action))
		const card = data.cards.find((candidate) => candidate.faction === "cp" && (!candidate.combat_card || action !== "card_event"))
		state.state = "action_card"
		state.phase = "行动阶段"
		state.turn = 3
		state.action_round = 2
		state.active = "cp"
		state.log = []
		state.hands.cp = [card.id]
		protocolAction(state, CP_ROLE, action, card.id)
		assert.deepEqual(state.action_history, [{
			turn: 3,
			round: 2,
			faction: "cp",
			type,
			card: card.id,
			log_cursor: 0
		}])
		assert.deepEqual(protocolView(state, CP_ROLE).action_history, state.action_history)
	}

	const oneOp = setupGame(26110)
	oneOp.state = "action_card"
	oneOp.phase = "行动阶段"
	oneOp.turn = 4
	oneOp.action_round = 1
	oneOp.active = "ap"
	oneOp.log = []
	protocolAction(oneOp, AP_ROLE, "one_op")
	assert.deepEqual(oneOp.action_history.at(-1), {
		turn: 4,
		round: 1,
		faction: "ap",
		type: "one_op",
		card: null,
		log_cursor: 0
	})
})

test("legacy saves gain version eighteen private MO, map-driven movement, and rollback cursors", () => {
	const state = setupGame(26111)
	delete state.action_history
	state.version = 8
	state.log.push("T1 行动轮 1：同盟国使用某张牌。")
	const current = protocolView(state, CP_ROLE)
	assert.equal(state.version, 46)
	assert.deepEqual(state.action_history, [])
	assert.deepEqual(state.mo.review.confirmed, [])
	assert.deepEqual(current.action_history, [])
})

test("version 42 saves discard legacy single-step undo entries", () => {
	const state = setupGame(26115)
	state.undo = [{
		label: "旧撤销",
		turn: state.turn,
		round: state.action_round,
		actor: state.active,
		state: globalThis.structuredClone({ ...state, undo: [] }),
	}]
	state.version = 42
	protocolView(state, state.active === "cp" ? CP_ROLE : AP_ROLE)
	assert.equal(state.version, 46)
	assert.deepEqual(state.undo, [])
})

test("undo restores action history to the pre-action slot", () => {
	const state = setupGame(26112)
	const card = data.cards.find((candidate) => candidate.faction === "cp")
	state.state = "action_card"
	state.phase = "行动阶段"
	state.turn = 2
	state.action_round = 1
	state.active = "cp"
	state.log = []
	state.hands.cp = [card.id]
	protocolAction(state, CP_ROLE, "card_ops", card.id)
	assert.equal(state.action_history.length, 1)
	protocolAction(state, CP_ROLE, "undo")
	assert.deepEqual(state.action_history, [])
})

test("supply warnings are server-owned and acknowledged before changing faction", () => {
	const state = setupGame(26020)
	state.state = "action_card"
	state.phase = "行动阶段"
	state.action_round = 1
	state.active = "cp"

	let current = protocolView(state, CP_ROLE)
	assert.equal(current.actions.flag_supply_warnings, 1)
	protocolAction(state, CP_ROLE, "flag_supply_warnings")
	current = protocolView(state, CP_ROLE)
	assert.equal(current.state, "flag_supply_warnings")
	assert.ok(current.actions.select_supply_warning.includes("ostend"))
	protocolAction(state, CP_ROLE, "select_supply_warning", "ostend")
	current = protocolView(state, CP_ROLE)
	assert.deepEqual(current.selection.selected, ["ostend"])
	assert.deepEqual(current.actions.deselect_supply_warning, ["ostend"])
	protocolAction(state, CP_ROLE, "finish_supply_warnings")
	assert.deepEqual(state.supply_warnings, { owner: "cp", spaces: ["ostend"] })

	rules._test.nextFactionAction(state)
	assert.equal(state.state, "review_supply_warnings")
	assert.equal(state.active, "ap")
	assert.equal(protocolView(state, AP_ROLE).actions.acknowledge_supply_warnings, 1)
	protocolAction(state, AP_ROLE, "acknowledge_supply_warnings")
	assert.equal(state.state, "action_card")
	assert.equal(state.active, "ap")
	assert.equal(state.phase, "行动阶段")
	assert.equal(state.supply_warnings, null)
})

test("rollback checkpoints require opponent review and direct rollback is unavailable", () => {
	const state = setupGame(26021)
	state.state = "action_card"
	state.phase = "行动阶段"
	state.action_round = 1
	state.active = "cp"
	state.undo = [{
		label: "回滚提议前旧操作",
		turn: state.turn,
		round: state.action_round,
		actor: "cp",
		state: globalThis.structuredClone({ ...state, undo: [] }),
	}]
	let current = protocolView(state, CP_ROLE)
	assert.deepEqual(current.actions.propose_rollback, [0])
	assert.equal(current.actions.rollback, undefined)

	const unchanged = globalThis.structuredClone(state)
	protocolAction(state, CP_ROLE, "rollback", 0)
	assert.deepEqual(state, unchanged)

	protocolAction(state, CP_ROLE, "propose_rollback", 0)
	assert.equal(state.state, "review_rollback_proposal")
	assert.equal(state.active, "ap")
	protocolAction(state, AP_ROLE, "reject_rollback")
	assert.equal(state.state, "action_card")
	assert.equal(state.active, "cp")
	assert.deepEqual(state.undo, [])

	protocolAction(state, CP_ROLE, "propose_rollback", 0)
	protocolAction(state, AP_ROLE, "accept_rollback")
	assert.equal(state.state, "confirm_rollback")
	assert.equal(state.active, "cp")
	assert.equal(state.undo.length, 0)
	assert.equal(state.rollback.length, 0)
	protocolAction(state, CP_ROLE, "confirm_rollback")
	assert.equal(state.state, "mo_review")
})

test("single-step undo never crosses into the opponent's action", () => {
	const state = setupGame(26022)
	state.state = "action_card"
	state.phase = "行动阶段"
	state.action_round = 1
	state.active = "cp"
	state.action_state = { turn: 1, round: 1, actor: "cp", used_combat_cards: [] }
	state.undo = [{
		label: "同盟国旧步骤",
		turn: 1,
		round: 1,
		actor: "cp",
		state: globalThis.structuredClone({ ...state, undo: [] }),
	}]

	rules._test.nextFactionAction(state)
	assert.equal(state.active, "ap")
	assert.deepEqual(state.undo, [])
	assert.equal(protocolView(state, AP_ROLE).actions.undo, undefined)
})

test("server rejects a stale undo snapshot owned by the other player", () => {
	const state = setupGame(26023)
	state.state = "action_card"
	state.phase = "行动阶段"
	state.action_round = 1
	state.active = "ap"
	state.action_state = { turn: 1, round: 1, actor: "ap", used_combat_cards: [] }
	state.undo = [{
		label: "同盟国旧步骤",
		turn: 1,
		round: 1,
		actor: "cp",
		state: globalThis.structuredClone({ ...state, active: "cp", undo: [] }),
	}]
	const before = globalThis.structuredClone(state)

	assert.equal(protocolView(state, AP_ROLE).actions.undo, undefined)
	protocolAction(state, AP_ROLE, "undo")
	assert.deepEqual(state, before)
})

test("target indexes and server validation consume the exact same action list", () => {
	const [origin, target] = westernPair()
	const attacker = makeUnit("protocol-attacker", "ap", origin)
	const defender = makeUnit("protocol-defender", "cp", target)
	const state = opsState([attacker, defender])
	let view = protocolView(state, AP_ROLE)
	assert.ok(view.actions.activate_attack.includes(origin))
	assert.ok(
		protocol.indexTargets(view.actions).spaces.get(origin)
			.some((entry) => entry.action === "activate_attack" && entry.arg === origin)
	)

	const before = globalThis.structuredClone(state)
	protocolAction(state, AP_ROLE, "activate_attack", "not-a-space")
	assert.deepEqual(state, before)

	protocolAction(state, AP_ROLE, "activate_attack", origin)
	view = protocolView(state, AP_ROLE)
	assert.equal(view.state, "ops_activate")
	assert.equal(view.actions.move_unit, undefined)
	assert.equal(view.actions.declare_attack, undefined)
	const activationOnly = globalThis.structuredClone(state)
	protocolAction(state, AP_ROLE, "move_unit", attacker.id)
	protocolAction(state, AP_ROLE, "declare_attack", target)
	assert.deepEqual(state, activationOnly)
	protocolAction(state, AP_ROLE, "finish")
	view = protocolView(state, AP_ROLE)
	assert.equal(state.state, "ops_attack")
	assert.deepEqual(view.actions.declare_attack, [target])
	assert.deepEqual(protocol.indexTargets(view.actions).spaces.get(target), [
		{ action: "declare_attack", arg: target }
	])
	protocolAction(state, AP_ROLE, "declare_attack", target)
	view = protocolView(state, AP_ROLE)
	assert.equal(state.state, "combat_card_window")
	assert.equal(view.actions.confirm_attack, undefined)
	assert.deepEqual(state.combat_window.declaration.attackers, [attacker.id])
	assert.equal(state.combat_window.declaration.target, target)
	assert.equal(state.combat, null)

	assert.equal(state.combat, null)
})

test("space activation immediately activates every eligible unit", () => {
	const [origin] = westernPair()
	const first = makeUnit("activation-first", "ap", origin)
	const second = makeUnit("activation-second", "ap", origin)
	const state = opsState([first, second])

	protocolAction(state, AP_ROLE, "activate_move", origin)
	const view = protocolView(state, AP_ROLE)
	assert.equal(view.state, "ops_activate")
	assert.equal(view.actions.select_activation_unit, undefined)
	assert.deepEqual(new Set(state.ops.activated_units[origin]), new Set([first.id, second.id]))
})

test("movement is a separate state and exposes only adjacent next steps", () => {
	const [origin, destination] = westernPair()
	const unit = makeUnit("step-mover", "ap", origin)
	const state = opsState([unit])
	state.control[destination] = "ap"

	protocolAction(state, AP_ROLE, "activate_move", origin)
	protocolAction(state, AP_ROLE, "finish")
	let view = protocolView(state, AP_ROLE)
	assert.equal(view.state, "movement_units")
	assert.deepEqual(view.selection.selected, [unit.id])
	assert.ok(view.actions.move.includes(destination))
	assert.ok(
		view.actions.move.every((space) =>
			data.spaces.find((candidate) => candidate.id === origin).connections.includes(space)
		)
	)

	protocolAction(state, AP_ROLE, "move", destination)
	view = protocolView(state, AP_ROLE)
	assert.equal(view.state, "movement")
	assert.equal(view.actions.stop, 1)
	assert.equal(view.actions.cancel, undefined)
	protocolAction(state, AP_ROLE, "stop")
	assert.equal(state.state, "ops_move")
})

test("multi-origin attacks use server-owned mode and flank selection", () => {
	const [firstOrigin, secondOrigin, target] = westernFork()
	const first = makeUnit("flank-first", "ap", firstOrigin)
	const second = makeUnit("flank-second", "ap", secondOrigin)
	const defender = makeUnit("flank-defender", "cp", target)
	const state = opsState([first, second, defender])
	state.state = "ops_attack"
	state.activations = { [firstOrigin]: "attack", [secondOrigin]: "attack" }
	state.ops.activated = [firstOrigin, secondOrigin]
	state.ops.activated_units = { [firstOrigin]: [first.id], [secondOrigin]: [second.id] }
	state.trenches[target] = 0

	protocolAction(state, AP_ROLE, "select_attacker", first.id)
	protocolAction(state, AP_ROLE, "select_attacker", second.id)
	let view = protocolView(state, AP_ROLE)
	assert.deepEqual(new Set(view.selection.selected), new Set([first.id, second.id]))
	assert.ok(view.actions.declare_attack.includes(target))
	protocolAction(state, AP_ROLE, "declare_attack", target)
	view = protocolView(state, AP_ROLE)
	assert.equal(state.state, "attack_mode")
	assert.equal(view.actions.confirm_attack, undefined)
	assert.equal(view.pending_attack.target, target)
	assert.equal(view.pending_attack.origin_count, 2)
	assert.equal(view.pending_attack.flank_available, true)

	protocolAction(state, AP_ROLE, "cancel")
	assert.equal(state.state, "ops_attack")
	assert.equal(protocolView(state, AP_ROLE).pending_attack, null)
	assert.deepEqual(new Set(protocolView(state, AP_ROLE).selection.selected), new Set([first.id, second.id]))

	protocolAction(state, AP_ROLE, "declare_attack", target)
	view = protocolView(state, AP_ROLE)
	assert.equal(state.state, "attack_mode")
	assert.equal(view.actions.regular_attack, 1)
	assert.equal(view.actions.flank_attack, 1)

	protocolAction(state, AP_ROLE, "cancel")
	assert.equal(state.state, "ops_attack")
	protocolAction(state, AP_ROLE, "declare_attack", target)
	assert.equal(state.state, "attack_mode")
	assert.deepEqual(new Set(protocolView(state, AP_ROLE).selection.selected), new Set([first.id, second.id]))
	protocolAction(state, AP_ROLE, "flank_attack")
	view = protocolView(state, AP_ROLE)
	assert.equal(state.state, "flank_final")
	assert.ok(view.actions.choose_flank_final.length)
	protocolAction(state, AP_ROLE, "cancel")
	assert.equal(state.state, "attack_mode")
	protocolAction(state, AP_ROLE, "flank_attack")
	view = protocolView(state, AP_ROLE)
	protocolAction(state, AP_ROLE, "choose_flank_final", view.actions.choose_flank_final[0])
	assert.equal(state.state, "combat_card_window")
})

test("labels never grant actions and action arguments are always primitive", () => {
	const actions = { event_choose: ["gain_vp"] }
	const labels = { event_choose: { gain_vp: "+1 VP", forged: "forged" } }
	assert.equal(protocol.allows(actions, "event_choose", "gain_vp"), true)
	assert.equal(protocol.allows(actions, "event_choose", "forged"), false)
	assert.equal(protocol.labelFor("event_choose", "gain_vp", labels), "+1 VP")
	assert.equal(protocol.labelFor("event_choose", "forged", labels), "forged")
})

test("reachable actions validate, have catalog entries, and execute through the unified entry", () => {
	const state = setupGame(26003)
	const preferred = [
		"done",
		"event_units_confirm",
		"event_confirm",
		"stop",
		"pass",
		"finish"
	]
	for (let step = 0; step < 60 && state.state !== "game_over"; step++) {
		const role = state.active === "ap" ? AP_ROLE : CP_ROLE
		const view = protocolView(state, role)
		protocol.validate(view.actions)
		const entries = Object.entries(view.actions).filter(([action]) => !["undo", "rollback"].includes(action))
		assert.ok(entries.length, `no protocol action in ${state.state}`)
		for (const [action, value] of entries) {
			assert.ok(protocol.catalog[action], `missing catalog entry for ${action}`)
			const args = value === 1 ? [undefined] : value
			for (const arg of args) {
				const copy = globalThis.structuredClone({
					...state,
					undo: [],
					rollback: state.rollback_proposal ? state.rollback : []
				})
				const beforeIllegal = copy.log.filter((line) => line.startsWith("Illegal action:")).length
				protocolAction(copy, role, action, arg)
				const afterIllegal = copy.log.filter((line) => line.startsWith("Illegal action:")).length
				assert.equal(
					afterIllegal,
					beforeIllegal,
					`${action} ${String(arg)} was rejected: ${JSON.stringify({ turn: state.turn, state: state.state, selection: view.selection, actions: view.actions, ops: state.ops })}`
				)
			}
		}
		const selected =
			preferred.map((action) => entries.find(([candidate]) => candidate === action)).find(Boolean) ||
			entries.find(([action]) => !action.startsWith("cancel")) ||
			entries[0]
		const [action, value] = selected
		protocolAction(state, role, action, value === 1 ? undefined : value[0])
	}
})

test("client contains no local rules selection or complex action payload path", () => {
	const root = path.join(__dirname, "..")
	const client = fs.readFileSync(path.join(root, "play.js"), "utf8")
	const html = fs.readFileSync(path.join(root, "play.html"), "utf8")
	assert.match(html, /<script defer src="action-protocol\.js"><\/script>/)
	assert.doesNotMatch(client, /_legacy|selectedUnits|selectedSrUnit|selectedRetreatUnit|selectedSpace/)
	assert.doesNotMatch(client, /window\.prompt|\bconfirm\s*\(/)
	assert.doesNotMatch(client, /perform\([^\n]+\{\s*(attackers|unit|destination|kind)/)
	assert.match(client, /targetIndex\.spaces\.get\(unit\.location\)/)
})
