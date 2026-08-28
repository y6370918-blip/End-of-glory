"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")

const rules = require("../rules.js")
const { setupGame } = require("./setup_game.js")

function generator(seed) {
	let value = seed >>> 0
	return (maximum) => {
		value = (Math.imul(value, 1664525) + 1013904223) >>> 0
		return maximum ? value % maximum : 0
	}
}

function pick(random, values) {
	return values[random(values.length)]
}

function actionHasValue(value) {
	if (value == null || value === false) return false
	if (Array.isArray(value)) return value.length > 0
	if (typeof value === "object") return Object.keys(value).length > 0
	return true
}

function actionArgument(state, actions, name, random) {
	const value = actions[name]
	if (value === 1) return undefined
	if (
		[
			"done",
			"confirm_mo",
			"confirm_mo_penalty_loss",
			"one_op",
			"finish",
			"pass",
			"event_confirm",
			"event_cancel",
			"cancel",
			"stop"
		].includes(name)
	)
		return undefined
	if (name === "event_choose") {
		if (state.pending_event?.kind === "mo_penalty")
			return value.find((choice) => choice === "loss") || value[0]
		return pick(random, value)
	}
	if (name === "move") {
		return pick(random, value)
	}
	if (name === "retreat") {
		const unit = pick(random, Object.keys(value))
		return { unit, destination: pick(random, value[unit]) }
	}
	if (name === "declare_attack") {
		return pick(random, value)
	}
	if (name === "event_exchange") return pick(random, value)
	if (name === "combine") return pick(random, value)
	return pick(random, value)
}

function fuzz(seed) {
	let state = setupGame(seed)
	const random = generator(seed ^ 0x9e3779b9)
	const targetTurn = Number(process.env.EOG_FUZZ_TARGET_TURN) || 4
	const campaignMode = targetTurn >= 15
	const stepLimit = Number(process.env.EOG_FUZZ_STEPS) || (campaignMode ? 12000 : 1500)
	const supported = new Set([
		"done",
		"confirm_mo",
		"confirm_mo_penalty_loss",
		"select_attack_mo",
		"select_defense_mo",
		"reset_defense_mo",
		"select_mo_penalty_unit",
		"deselect_mo_penalty_unit",
		"naval_event",
		"naval_fleet",
		"naval_empty_fleet",
		"naval_discard",
		"naval_shuffle",
		"one_op",
		"card_ops",
		"card_sr",
		"card_rp",
		"card_event",
		"discard_combat_card",
		"event_choose",
		"select_event_unit",
		"deselect_event_unit",
		"event_units_confirm",
		"event_space",
		"reinforcement_to_reserve",
		"event_confirm",
		"event_cancel",
		"event_exchange",
		"event_front_step",
		"mo_front_loss",
		"front_maintenance_loss",
		"replacement_to_reserve",
		"confirm_discard_replacement_rp",
		"voluntary_destroy_unit",
		"voluntary_remove_fortification",
		"voluntary_reduce_trench",
		"activate_move",
		"activate_attack",
		"activate_construct",
		"select_activation_unit",
		"deselect_activation_unit",
		"activation_confirm",
		"activation_cancel",
		"resolve_stack",
		"select_move_unit",
		"deselect_move_unit",
		"entrench",
		"fortify",
		"combine",
		"select_sr_unit",
		"cancel_sr_unit",
		"sr_destination",
		"select_august_unit",
		"deselect_august_unit",
		"finish_august_reposition",
		"declare_attack",
		"select_attacker",
		"deselect_attacker",
		"regular_attack",
		"flank_attack",
		"choose_flank_final",
		"finish",
		"move",
		"cancel",
		"stop",
		"combat_card",
		"retain_combat_card",
		"discard_combat_card_for_draw",
		"pass",
		"take_loss",
		"choose_replacement",
		"retreat_loss",
		"cancel_retreat",
		"select_retreat_unit",
		"select_retreat_one",
		"select_retreat_two",
		"deselect_retreat_unit",
		"retreat_destination",
		"eliminate",
		"select_advance_unit",
		"decline_advance",
		"advance_destination",
		"spend_flip",
		"spend_upgrade",
		"spend_rebuild",
		"spend_front",
		"spend_option"
	])
	let steps = 0
	let reloadedTurn = state.turn
	while (state.state !== "game_over" && state.turn < targetTurn && steps++ < stepLimit) {
		const role = state.active === "ap" ? "Allied Powers" : "Central Powers"
		const view = rules.view(state, role)
		const names = Object.keys(view.actions)
			.filter((name) => supported.has(name))
			.filter((name) => actionHasValue(view.actions[name]))
		assert.ok(
			names.length,
			`seed ${seed} stalled in ${state.state}: ${JSON.stringify({
				pending_event: state.pending_event,
				pending_siege: state.ops?.pending_siege,
				pending_retreat: state.pending_retreat,
				ops: state.ops,
				sr: state.sr,
				activations: state.activations,
				action_keys: Object.keys(view.actions),
				action_values: view.actions,
				hqs: state.units
					.filter((unit) => unit.type === "hq")
					.map((unit) => ({
						id: unit.id,
						nation: unit.nation,
						location: unit.location,
						moved: unit.moved,
						stack: state.units
							.filter((candidate) => candidate.location === unit.location)
							.map((candidate) => [candidate.id, candidate.nation, candidate.type])
					})),
				activated_units_current: Object.values(state.ops?.activated_units || {})
					.flat()
					.map((id) => {
						const unit = state.units.find((candidate) => candidate.id === id)
						return unit && [unit.id, unit.nation, unit.type, unit.location, unit.moved, unit.attacked]
					}),
				units: state.units.filter(
					(unit) =>
						state.activations[unit.location] ||
						(state.ops?.pending_siege &&
							[state.ops.pending_siege.origin, state.ops.pending_siege.space].includes(unit.location))
				)
			})}`
		)
		let name
		if (state.pending_event?.kind === "mo_penalty" && state.pending_event.stage === "loss")
			name = names.includes("confirm_mo_penalty_loss")
				? "confirm_mo_penalty_loss"
				: "select_mo_penalty_unit"
		else if (state.state === "retreat")
			name = names.includes("retreat_destination")
				? "retreat_destination"
				: names.includes("select_retreat_unit")
					? "select_retreat_unit"
					: names.includes("select_retreat_one")
						? "select_retreat_one"
						: names.includes("select_retreat_two")
							? "select_retreat_two"
							: names.includes("cancel_retreat")
								? "cancel_retreat"
								: "eliminate"
		else if (state.state === "retreat_overstack") name = "retreat_loss"
		else if (state.state === "advance_select")
			name = names.includes("advance_destination") ? "advance_destination" : names.includes("select_advance_unit") ? "select_advance_unit" : "decline_advance"
		else if (state.state === "advance_destination") name = "advance_destination"
		else if (state.state === "defense_mo") name = "select_defense_mo"
		else if (state.state === "event" && names.includes("event_units_confirm"))
			name = "event_units_confirm"
		else if (state.state === "event" && names.includes("select_event_unit"))
			name = "select_event_unit"
		else if (state.state === "movement_units")
			name = names.includes("move") ? "move" : names.includes("select_move_unit") ? "select_move_unit" : "cancel"
		else if (state.state === "movement")
			name = names.includes("move")
				? "move"
				: names.includes("stop")
					? "stop"
					: "cancel"
		else if (state.state === "ops_activate" && state.ops?.preactivation_sr_selected)
			name = "sr_destination"
		else if (state.state === "ops_activate")
			name = ["activate_move", "activate_attack", "activate_construct", "finish", "select_sr_unit"]
				.find((candidate) => names.includes(candidate))
		else if (["ops_move", "ops_construct", "sr"].includes(state.state) && names.includes("finish"))
			name = "finish"
		else if (state.state === "action_card" && names.includes("one_op"))
			name = "one_op"
		else if (["replacement", "ops_attack"].includes(state.state) && names.includes("finish"))
			name = "finish"
		else if (state.state === "attack_mo") name = "select_attack_mo"
		else if (state.state === "attack_mode") name = "regular_attack"
		else if (state.state === "flank_final") name = "choose_flank_final"
		else if (state.state === "ops_attack" && names.includes("declare_attack")) name = "declare_attack"
		else name = pick(random, names)
		const arg = actionArgument(state, view.actions, name, random)
		const logLength = state.log.length
		rules.action(state, role, name, arg)
		try {
			rules._test.assertCardConservation(state)
		} catch (error) {
			const inventory = rules._test.cardZoneInventory(state)
			throw new Error(`seed ${seed} step ${steps} after ${name} ${JSON.stringify(arg)} in ${state.state}: ${error.message}; pending=${JSON.stringify(state.pending_event)}; zones=${JSON.stringify(inventory[Number(arg)] || [])}`)
		}
		if (campaignMode && state.turn !== reloadedTurn) {
			state = JSON.parse(JSON.stringify(state))
			rules.view(state, state.active === "ap" ? "Allied Powers" : "Central Powers")
			rules._test.assertCardConservation(state)
			reloadedTurn = state.turn
		}
		const newLogs = state.log.slice(logLength)
		assert.equal(
			newLogs.some((entry) => entry.startsWith("非法动作：")),
			false,
			`seed ${seed} ${state.state} ${name} ${JSON.stringify(arg)} ${JSON.stringify(newLogs)}`
		)
	}
	assert.ok(
		state.turn >= targetTurn || state.state === "game_over",
		`seed ${seed} did not progress: ${JSON.stringify({
			turn: state.turn,
			state: state.state,
			active: state.active,
			ops: state.ops,
			sr: state.sr,
			pending_event: state.pending_event,
			pending_retreat: state.pending_retreat
		})}`
	)
	return state
}

test("fixed-seed legal-action fuzz reaches the configured target turn without server rejections", () => {
	const targetTurn = Number(process.env.EOG_FUZZ_TARGET_TURN) || 4
	const seeds = targetTurn >= 15 ? [20260825] : [17, 29, 61]
	for (const seed of seeds) fuzz(seed)
})

test("legal-action fuzz remains deterministic for the same seed", { skip: Number(process.env.EOG_FUZZ_TARGET_TURN) >= 15 }, () => {
	assert.deepEqual(fuzz(97), fuzz(97))
})

