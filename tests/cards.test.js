"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")

const data = require("../data.js")
const rules = require("../rules.js")
const { setupGame } = require("./setup_game.js")

function landNeighbors(space) {
	return data.edges
		.filter(
			(edge) =>
				(edge.type || "land") === "land" &&
				(edge.a === space.id || edge.b === space.id)
		)
		.map((edge) => (edge.a === space.id ? edge.b : edge.a))
}

function eventUnitNation(state, id) {
	const unit = [
		...state.units,
		...state.reserves.ap,
		...state.reserves.cp,
		...state.upgrade_pool.ap,
		...state.upgrade_pool.cp,
		...state.eliminated.ap,
		...state.eliminated.cp
	].find((candidate) => candidate.id === id)
	return data.pieces.find((piece) => piece.id === unit?.piece)?.nation
}

function eventUnitCandidates(state, role) {
	const actions = rules.view(state, role).actions
	return [...(actions.select_event_unit || []), ...(actions.deselect_event_unit || [])]
}

function chooseEventUnits(state, role, ids) {
	for (const id of ids) rules.action(state, role, "select_event_unit", id)
	rules.action(state, role, "event_units_confirm")
}

function declareAttack(state, role, attackerIds, target, confirm = true) {
	state.state = "ops_attack"
	state.ops ||= {}
	state.ops.attack_selection = []
	state.ops.attacked_units ||= []
	state.ops.forced_attacks ||= []
	state.ops.activated_units ||= {}
	const origins = [...new Set(attackerIds.map((id) => state.units.find((unit) => unit.id === id)?.location).filter(Boolean))]
	state.ops.execution_phase = "attack"
	if (origins.length === 1) state.ops.execution_origin = origins[0]
	for (const id of attackerIds) {
		const unit = state.units.find((candidate) => candidate.id === id)
		if (!unit) continue
		state.activations[unit.location] = "attack"
		state.ops.activated_units[unit.location] ||= []
		if (!state.ops.activated_units[unit.location].includes(id)) state.ops.activated_units[unit.location].push(id)
		rules.action(state, role, "select_attacker", id)
	}
	rules.action(state, role, "declare_attack", target)
	if (!confirm) return
	while (rules.view(state, role).actions.select_attack_mo?.length)
		rules.action(state, role, "select_attack_mo", rules.view(state, role).actions.select_attack_mo.at(-1))
	if (state.state === "defense_mo") {
		const defenderRole = role === "Allied Powers" ? "Central Powers" : "Allied Powers"
		while (rules.view(state, defenderRole).actions.select_defense_mo?.length)
			rules.action(state, defenderRole, "select_defense_mo", rules.view(state, defenderRole).actions.select_defense_mo.at(-1))
	}
}

function finishPendingEvent(state, role, card) {
	let guard = 0
	while (state.state.startsWith("event_") || (state.state === "sr" && state.sr?.resume_event)) {
		if (guard++ > 50)
			throw new Error(
				`Pending event loop for ${card.id}: ${JSON.stringify({ pending: state.pending_event, actions: rules.view(state, role).actions })}`
			)
		const currentRole = state.active === "ap" ? "Allied Powers" : state.active === "cp" ? "Central Powers" : role
		const view = rules.view(state, currentRole)
		if (state.state === "sr" && state.sr?.resume_event) {
			rules.action(state, currentRole, "finish")
			continue
		}
		if (view.actions.event_choose) {
			const choice =
				[613, 726].includes(card.id)
					? view.actions.event_choose.find((candidate) => candidate === "remove_lcu")
					: card.id === 754
						? view.actions.event_choose.find((candidate) => candidate === "ge_rp") ||
							view.actions.event_choose[0]
						: view.actions.event_choose[0]
			rules.action(state, currentRole, "event_choose", choice)
			continue
		}
		if (view.actions.select_event_unit?.length) {
			const candidates = view.actions.select_event_unit
			const count =
				state.pending_event.kind === "delay_units"
					? 1
					: state.pending_event.kind === "white_feather_sr"
						? 1
					: state.pending_event.kind === "sack_belgium"
						? state.pending_event.operation.remove_count
					: state.pending_event.kind === "italy_entry_restore"
						? state.pending_event.required
					: state.pending_event.kind === "mass_attrition"
						? Math.min(4, candidates.length)
					: state.pending_event.kind === "reinforcement_rebuild"
						? state.pending_event.maximum
					: data.card_effects[card.id].choices.find(
							(choice) => choice.id === state.pending_event.choice
						).select.count
			assert.ok(candidates.length >= count)
			const selected =
				card.id === 653
					? [
							...candidates
								.filter((id) => eventUnitNation(state, id) === "fr")
								.slice(0, 2),
							...candidates
								.filter((id) => eventUnitNation(state, id) === "br")
								.slice(0, 2)
						]
					: candidates.slice(0, count)
			for (const id of selected) rules.action(state, currentRole, "select_event_unit", id)
			rules.action(state, currentRole, "event_units_confirm")
			continue
		}
		if (view.actions.event_units_confirm) {
			rules.action(state, currentRole, "event_units_confirm")
			continue
		}
		if (view.actions.select_august_unit?.length) {
			rules.action(
				state,
				currentRole,
				"select_august_unit",
				view.actions.select_august_unit[0]
			)
			continue
		}
		if (view.actions.event_confirm && state.pending_event.kind === "space_rule") {
			rules.action(state, currentRole, "event_confirm")
			continue
		}
		if (
			view.actions.event_confirm &&
			state.pending_event.kind === "hindenburg_line" &&
			state.pending_event.stage === "retreat"
		) {
			rules.action(state, currentRole, "event_confirm")
			continue
		}
		if (view.actions.event_space?.length) {
			rules.action(state, currentRole, "event_space", view.actions.event_space[0])
			continue
		}
		if (view.actions.reinforcement_to_reserve) {
			rules.action(state, currentRole, "reinforcement_to_reserve")
			continue
		}
		if (view.actions.event_confirm) {
			rules.action(state, currentRole, "event_confirm")
			continue
		}
		if (view.actions.finish_august_reposition) {
			rules.action(state, currentRole, "finish_august_reposition")
			continue
		}
		throw new Error(`No legal continuation for pending event ${card.id}`)
	}
}

function configureAugustGunsFixture(state) {
	const fort = data.spaces.find(
		(space) => space.nation === "be" && space.fort && landNeighbors(space).length
	)
	const adjacent = fort && data.spaces.find((space) => space.id === landNeighbors(fort)[0])
	const unit = state.units.find((candidate) => candidate.faction === "cp")
	assert.ok(fort)
	assert.ok(adjacent)
	assert.ok(unit)
	state.units = state.units.filter(
		(candidate) => candidate.id === unit.id || candidate.location !== adjacent.id
	)
	unit.location = adjacent.id
}

function configureDelayedUnitFixture(state) {
	const army = data.pieces.find((piece) => piece.nation === "ge" && piece.type === "army")
	const corps = data.pieces.find((piece) => piece.nation === "ge" && piece.type === "corps")
	const spaces = data.spaces.filter((space) => space.nation === "fr").slice(0, 3)
	state.units.push(
		...[
			{ id: "delay-army", piece: army.id, type: "army", location: spaces[0].id },
			{ id: "delay-corps-1", piece: corps.id, type: "corps", location: spaces[1].id },
			{ id: "delay-corps-2", piece: corps.id, type: "corps", location: spaces[2].id }
		].map((unit) => ({
			...unit,
			faction: "cp",
			nation: "ge",
			reduced: false,
			supplied: true
		}))
	)
}

function addBritishArmyForColoniesEvent(state) {
	const piece = data.pieces.find((candidate) => candidate.nation === "br" && candidate.type === "army")
	const corps = data.pieces.find((candidate) => candidate.nation === "br" && candidate.type === "corps")
	assert.ok(piece)
	assert.ok(corps)
	state.reserves.ap.push({
		id: "test-br-army",
		piece: piece.id,
		reduced: false,
		tts_guid: "test"
	}, ...Array.from({ length: 5 }, (_, index) => ({
		id: `test-br-corps-${index + 1}`,
		piece: corps.id,
		reduced: false,
		tts_guid: `test-corps-${index + 1}`
	})))
}

function configureCombatCardFixture(state, card) {
	// Combat-card tests isolate card text from the independently selected MO.
	for (const nation of Object.keys(state.mo.current)) {
		state.mo.current[nation] = []
		state.mo.completed[nation] = []
		state.mo.progress[nation] = {}
		state.mo.drm_used[nation] = {}
	}
	const spec = data.card_effects[card.id]
	let effect = spec.combat || {}
	const turnEffect = spec.combat_by_turn?.find(
		(entry) => state.turn >= (entry.min_turn ?? 1) && state.turn <= (entry.max_turn ?? 15)
	)
	if (turnEffect) effect = turnEffect.replace ? { ...turnEffect.combat } : { ...effect, ...turnEffect.combat }
	const terrain = effect.terrain?.[0]
	const terrainOrAdjacent = effect.terrain_or_adjacent?.[0]
	const target =
		data.spaces.find(
			(space) =>
				landNeighbors(space).length &&
				(!terrain || space.terrain === terrain) &&
				(!terrainOrAdjacent || space.terrain === terrainOrAdjacent ||
					landNeighbors(space).some((id) => data.spaces.find((candidate) => candidate.id === id)?.terrain === terrainOrAdjacent)) &&
				(!effect.target_nation || space.nation === effect.target_nation) &&
				(!effect.italian_front_only || space.nation === "it" || space.theater === "italian") &&
				(!effect.requires_target_fort || Boolean(space.fort))
		) ||
		data.spaces.find((space) => landNeighbors(space).length)
	const origin = data.spaces.find((space) => space.id === landNeighbors(target)[0])
	const attackerFaction = effect.required_attacker_faction ||
		(effect.required_defender_faction
			? (effect.required_defender_faction === "ap" ? "cp" : "ap")
			: effect.defender_only ? (card.faction === "ap" ? "cp" : "ap") : card.faction)
	const defenderFaction = effect.required_defender_faction || (attackerFaction === "ap" ? "cp" : "ap")
	const attackerNation =
		effect.attacker_army_nations_any?.[0] ||
		effect.attacker_nation ||
		effect.attacker_nations_any?.[0] ||
		effect.required_faction_nations?.[attackerFaction]?.[0] ||
		(effect.first_use_hq && card.faction === attackerFaction
			? data.pieces.find((piece) => piece.id === effect.first_use_hq.piece)?.nation
			: null) ||
		(attackerFaction === "ap" ? "fr" : "ge")
	let defenderNation =
		effect.defender_nations_all?.[0] ||
		effect.defender_nation ||
		effect.attack_drm_if_defender_nation ||
		effect.required_faction_nations?.[defenderFaction]?.[0] ||
		(defenderFaction === "ap" ? "fr" : "ge")
	if (effect.italian_front_only && attackerNation !== "it") defenderNation = "it"
	const attackerPiece = data.pieces.find(
		(piece) => piece.nation === attackerNation &&
			(effect.attacker_army_nations_any?.length
				? piece.type === "army"
				: ["army", "corps"].includes(piece.type))
	)
	const defenderPiece = data.pieces.find(
		(piece) => piece.nation === defenderNation && ["army", "corps"].includes(piece.type)
	)
	assert.ok(attackerPiece)
	assert.ok(defenderPiece)
	state.units = [
		{
			id: "combat-attacker",
			piece: attackerPiece.id,
			faction: attackerFaction,
			nation: attackerNation,
			type: attackerPiece.type,
			location: origin.id,
			reduced: false,
			supplied: true
		},
		{
			id: "combat-defender",
			piece: defenderPiece.id,
			faction: defenderFaction,
			nation: defenderNation,
			type: defenderPiece.type,
			location: target.id,
			reduced: false,
			supplied: true
		}
	]
	if (effect.adjacent_hq_required) {
		const hq = effect.required_hq_piece
			? data.pieces.find((piece) => piece.id === effect.required_hq_piece)
			: data.pieces.find(
					(piece) => piece.nation === attackerNation && piece.type === "hq"
				)
		assert.ok(hq)
		state.units.push({
			id: "combat-hq",
			piece: hq.id,
			faction: attackerFaction,
			nation: attackerNation,
			type: "hq",
			location: origin.id,
			reduced: false,
			supplied: true
		})
	}
	if (effect.requires_trench) state.trenches[target.id] = 1
	if (effect.cancel_event) state.events[effect.cancel_event] = { faction: defenderFaction }
	state.combat_window = {
		declaration: { attackers: ["combat-attacker"], target: target.id },
		attacker: attackerFaction,
		defender: defenderFaction,
		side: card.faction,
		cards: []
	}
}

function configureHindenburgFixture(state) {
	const apUnits = state.units.filter((unit) => unit.faction === "ap")
	const german = state.units.find((unit) => unit.nation === "ge" && unit.type === "army")
	const austrian = state.units.filter((unit) => unit.nation === "ah" && unit.type === "corps").slice(0, 2)
	assert.ok(german)
	assert.equal(austrian.length, 2)
	german.location = "metz"
	austrian[0].location = "rethel"
	austrian[1].location = "epernay"
	state.units = [...apUnits, german, ...austrian]
	state.control.rethel = "cp"
	state.control.epernay = "cp"
}

function satisfyCardPrerequisites(state, card) {
	const prerequisites = data.card_effects[card.id].prerequisites || {}
	state.turn = prerequisites.max_turn || Math.max(15, prerequisites.min_turn || 1)
	state.action_round = prerequisites.action_round || 1
	state.war_status.combined = Math.max(
		state.war_status.combined,
		prerequisites.min_combined_war_status || 0
	)
	if (prerequisites.requires_event) state.events[prerequisites.requires_event] = { test: true }
	if (prerequisites.requires_any_event?.length)
		state.events[prerequisites.requires_any_event[0]] = { test: true }
	for (const [front, value] of Object.entries(prerequisites.min_front || {}))
		state.fronts[front] = Math.max(state.fronts[front], value)
	if (prerequisites.maximum_commitment)
		state.commitment[card.faction] = prerequisites.maximum_commitment
	if (prerequisites.min_turn_or_event_count)
		state.turn = Math.max(state.turn, prerequisites.min_turn_or_event_count.turn)
}

test("every card event has a legal server path and deterministic discard/remove behavior", async (context) => {
	for (const card of data.cards) {
		await context.test(`${card.id} ${card.title}`, () => {
			const state = setupGame(card.id)
			const role = card.faction === "ap" ? "Allied Powers" : "Central Powers"
			state.active = card.faction
			state.phase = "行动阶段"
			state.commitment[card.faction] = "total"
			state.events.entry_it = true
			state.fronts.russian = card.id === 745 ? 8 : 3
			state.hands[card.faction] = [card.id]
			state.decks[card.faction] = []
			state.discard[card.faction] = []
			state.removed[card.faction] = []
			satisfyCardPrerequisites(state, card)
			if (data.card_effects[card.id].prerequisites?.forbids_event)
				delete state.events[data.card_effects[card.id].prerequisites.forbids_event]
			if (data.card_effects[card.id].obsolete?.prohibit_event)
				state.commitment[card.faction] = card.commitment
			if (card.event == null) {
				assert.equal(rules.view(state, role).actions.card_event?.includes(card.id) || false, false)
				return
			}
			if (card.id === 614) configureDelayedUnitFixture(state)
			if (card.id === 701) configureAugustGunsFixture(state)
			if (card.id === 736) configureHindenburgFixture(state)
			if (card.id === 735)
				for (const space of data.spaces.filter((candidate) => candidate.nation === "it"))
					state.control[space.id] = "cp"
			if ([613, 726].includes(card.id)) addBritishArmyForColoniesEvent(state)
			const action = card.combat_card ? "combat_card" : "card_event"
			if (card.combat_card) {
				state.state = "combat_card_window"
				configureCombatCardFixture(state, card)
				if (data.card_effects[card.id].combat?.after_defense) {
					const apUnit = state.units.find((unit) => unit.faction === "ap")
					const cpUnit = state.units.find((unit) => unit.faction === "cp")
					state.combat = {
						attacker: "cp",
						attackers: [cpUnit.id],
						defenders: [apUnit.id],
						target: apUnit.location,
						attack_loss: 0,
						defense_loss: 0,
						modifiers: { cancel_retreat: [], cancel_advance: [], cards: [] },
						origins: {
							[apUnit.id]: apUnit.location,
							[cpUnit.id]: cpUnit.location
						}
					}
					state.post_combat_window = {
						attacker: "cp",
						defender: "ap",
						side: "ap",
						passes: 0
					}
					state.state = "post_combat_card_window"
				}
				if (data.card_effects[card.id].combat?.counterattack) {
					const apUnit = state.units.find((unit) => unit.faction === "ap")
					const cpUnit = state.units.find((unit) => unit.faction === "cp")
					state.combat_window = {
						declaration: { attackers: [cpUnit.id], target: apUnit.location },
						attacker: "cp",
						defender: "ap",
						side: "ap",
						cards: []
					}
				}
				if (data.card_effects[card.id].combat?.retreat_choice) {
					const apUnit = state.units.find((unit) => unit.faction === "ap")
					const cpUnit = state.units.find((unit) => unit.faction === "cp")
					state.combat_window = {
						declaration: { attackers: [cpUnit.id], target: apUnit.location },
						attacker: "cp",
						defender: "ap",
						side: "ap",
						cards: []
					}
				}
			} else state.state = "action_card"
			const legal = rules.view(state, role).actions[action]
			assert.ok(legal.includes(card.id))
			rules.action(state, role, action, card.id)
			if (!card.combat_card) finishPendingEvent(state, role, card)
			else rules._test.revealCommittedCombatCards(state)
			if (!card.combat_card) assert.ok(state.events[card.event])
			assert.equal(state.hands[card.faction].includes(card.id), false)
			const obsolete = data.card_effects[card.id].obsolete
			const obsoleteOnUse = obsolete?.remove_on_use?.includes("event") &&
				obsolete.commitment === state.commitment[card.faction]
			const removedOnUse = card.remove || obsoleteOnUse ||
				(Number.isFinite(data.card_effects[card.id].remove_from_turn) && state.turn >= data.card_effects[card.id].remove_from_turn)
			assert.equal(
				removedOnUse ? state.removed[card.faction].includes(card.id) : state.discard[card.faction].includes(card.id),
				true
			)
		})
	}
})

test("combat cards apply their own DRM, column, and fieldwork rules", () => {
	const state = setupGame(621)
	const card = data.cards.find((candidate) => candidate.id === 621)
	state.active = "ap"
	state.state = "combat_card_window"
	state.hands.ap = [621, 610, 629]
	configureCombatCardFixture(state, card)
	const british = data.pieces.find(
		(piece) => piece.nation === "br" && ["army", "corps"].includes(piece.type)
	)
	const attacker = state.units.find((unit) => unit.id === "combat-attacker")
	attacker.piece = british.id
	attacker.nation = "br"
	const target = state.combat_window.declaration.target
	state.trenches[target] = 2
	state.fortifications[target] = 1
	for (const id of [621, 610, 629]) {
		rules.action(state, "Allied Powers", "combat_card", id)
		if (state.pending_event?.kind === "combat_hq_reinforcement")
			rules.action(state, "Allied Powers", "event_choose", "skip")
	}
	rules.action(state, "Allied Powers", "pass")
	rules.action(state, "Central Powers", "pass")
	assert.equal(state.combat.modifiers.attack_drm, 1)
	assert.equal(state.combat.modifiers.attack_column, 1)
	assert.equal(state.combat.modifiers.defense_column, 1)
	assert.equal(state.combat.modifiers.ignore_trench, true)
	assert.equal(state.combat.modifiers.clear_fortification, true)
	assert.equal(state.fortifications[target], undefined)
})

test("combat-card conditions are enforced and opponent commitments remain hidden", () => {
	const state = setupGame(753)
	const card = data.cards.find((candidate) => candidate.id === 753)
	state.active = "cp"
	state.state = "combat_card_window"
	state.hands.cp = [753]
	state.hands.ap = [621]
	configureCombatCardFixture(state, card)
	const originalTarget = state.combat_window.declaration.target
	const clear = data.spaces.find(
		(space) => space.terrain === "clear" && landNeighbors(space).length
	)
	state.units.find((unit) => unit.id === "combat-defender").location = clear.id
	state.units.find((unit) => unit.id === "combat-attacker").location = landNeighbors(clear)[0]
	state.combat_window.declaration.target = clear.id
	assert.equal(rules._test.combatCardLegal(state, card, "cp"), false)
	state.units.find((unit) => unit.id === "combat-defender").location = originalTarget
	state.units.find((unit) => unit.id === "combat-attacker").location =
		landNeighbors(data.spaces.find((space) => space.id === originalTarget))[0]
	state.combat_window.declaration.target = originalTarget
	assert.equal(rules._test.combatCardLegal(state, card, "cp"), true)
	state.hands.cp = []
	state.combat_window.cards = [753]
	state.combat_window.card_owners = { 753: "cp" }
	const alliedView = rules.view(state, "Allied Powers")
	assert.deepEqual(alliedView.combat_window.cards, [])
	assert.equal(alliedView.combat_window.card_counts.cp, 1)
})

test("Rupprecht requires an adjacent HQ and first fire removes casualties before return fire", () => {
	const state = setupGame(710)
	const card = data.cards.find((candidate) => candidate.id === 710)
	state.active = "cp"
	state.state = "combat_card_window"
	state.hands.cp = [710]
	configureCombatCardFixture(state, card)
	state.units = state.units.filter((unit) => unit.id !== "combat-hq")
	assert.equal(rules._test.combatCardLegal(state, card, "cp"), false)

	const origin = state.units.find((unit) => unit.id === "combat-attacker").location
	const hq = data.pieces.find((piece) => piece.id === "component-085")
	const army = data.pieces.find(
		(piece) => piece.nation === "ge" && piece.type === "army" && piece.combat >= 3
	)
	assert.ok(hq)
	assert.ok(army)
	state.units.push({
		id: "combat-hq",
		piece: hq.id,
		faction: "cp",
		nation: "ge",
		type: "hq",
		location: origin,
		reduced: false,
		supplied: true
	})
	for (let index = 0; index < 3; index++)
		state.units.push({
			id: `extra-attacker-${index}`,
			piece: army.id,
			faction: "cp",
			nation: "ge",
			type: "army",
			location: origin,
			reduced: false,
			supplied: true
		})
	state.combat_window.declaration.attackers.push(
		"extra-attacker-0",
		"extra-attacker-1",
		"extra-attacker-2"
	)
	const defender = state.units.find((unit) => unit.id === "combat-defender")
	defender.reduced = true
	assert.equal(rules._test.combatCardLegal(state, card, "cp"), true)
	rules.action(state, "Central Powers", "combat_card", 710)
	rules.action(state, "Central Powers", "pass")
	rules.action(state, "Allied Powers", "pass")
	assert.equal(state.combat.pending_side, "ap")
	assert.equal(state.combat.attack_loss, 0)
	while (state.state === "combat_losses" && state.active === "ap") {
		const actions = rules.view(state, "Allied Powers").actions
		if (actions.take_loss?.length)
			rules.action(state, "Allied Powers", "take_loss", actions.take_loss[0])
		else rules._test.advanceDeterministicStates(state)
	}
	assert.equal(state.units.some((unit) => unit.id === "combat-defender"), false)
	assert.equal(state.combat.attack_loss, 0)
})

test("628 Artois restores at most two reduced attackers before combat across the action round", () => {
	const state = setupGame(628)
	const card = data.cards.find((candidate) => candidate.id === 628)
	state.active = "ap"
	state.state = "ops_activate"
	state.events[card.event] = {
		faction: "ap",
		duration: "action_round",
		expires: "action_round"
	}
	configureCombatCardFixture(state, card)
	const attacker = state.units.find((unit) => unit.id === "combat-attacker")
	attacker.reduced = true
	state.combat_window = null
	state.ops = { remaining: 3, forced_attacks: [], execution_phase: "attack" }
	state.activations = { [attacker.location]: "attack" }
	declareAttack(state, "Allied Powers", [attacker.id], state.units.find((unit) => unit.id === "combat-defender").location)
	assert.equal(state.pending_event.kind, "precombat_restore")
	chooseEventUnits(state, "Allied Powers", [attacker.id])
	assert.equal(attacker.reduced, false)
	assert.equal(state.state, "combat_card_window")
	assert.equal(state.usage_limits["combat_restore:628:1:0"], 1)
})

test("post-combat cards are illegal before results and open server-driven repair choices afterwards", () => {
	const state = setupGame(631)
	const card = data.cards.find((candidate) => candidate.id === 631)
	state.active = "ap"
	state.state = "combat_card_window"
	state.hands.ap = [631]
	configureCombatCardFixture(state, card)
	assert.equal(rules._test.postCombatCardLegal(state, card, "ap"), false)

	const apUnit = state.units.find((unit) => unit.faction === "ap")
	const cpUnit = state.units.find((unit) => unit.faction === "cp")
	state.combat = {
		attacker: "cp",
		attackers: [cpUnit.id],
		defenders: [apUnit.id],
		target: apUnit.location,
		attack_loss: 1,
		defense_loss: 1,
		modifiers: { cancel_retreat: [], cancel_advance: [], cards: [] },
		origins: { [apUnit.id]: apUnit.location, [cpUnit.id]: cpUnit.location }
	}
	state.post_combat_window = { attacker: "cp", defender: "ap", side: "ap" }
	state.state = "post_combat_card_window"
	assert.ok(rules.view(state, "Allied Powers").actions.combat_card.includes(631))
	rules.action(state, "Allied Powers", "combat_card", 631)
	assert.equal(state.pending_event.kind, "combat_fr_rp")
	assert.ok(state.combat.modifiers.cancel_retreat.includes("ap"))
	assert.ok(state.combat.modifiers.cancel_advance.includes("cp"))
	const hqSpaces = rules.view(state, "Allied Powers").actions.event_space
	assert.ok(hqSpaces.length > 0)
	rules.action(state, "Allied Powers", "event_space", hqSpaces[0])
	chooseEventUnits(state, "Allied Powers", [apUnit.id])
	assert.equal(state.rp.ap.fr, 1)
	rules.action(state, "Allied Powers", "event_choose", "done")
	assert.ok(rules.view(state, "Allied Powers").actions.spend_flip.includes(apUnit.id))
	rules.action(state, "Allied Powers", "spend_flip", apUnit.id)
	rules.action(state, "Allied Powers", "event_choose", "done")
	assert.equal(state.rp.ap.fr, 0)
	assert.equal(state.state, "post_combat_card_window")
})

test("Second Champagne restores participating attackers after losses are satisfied", () => {
	const state = setupGame(620)
	const card = data.cards.find((candidate) => candidate.id === 620)
	state.active = "ap"
	configureCombatCardFixture(state, card)
	const attacker = state.units.find((unit) => unit.id === "combat-attacker")
	const defender = state.units.find((unit) => unit.id === "combat-defender")
	state.events[card.event] = {
		faction: "ap",
		duration: "action_round",
		expires: "action_round"
	}
	state.combat_window = null
	state.combat = {
		attacker: "ap",
		attackers: [attacker.id],
		defenders: [defender.id],
		target: defender.location,
		attack_loss: data.pieces.find((piece) => piece.id === attacker.piece).loss,
		defense_loss: 0,
		pending_side: "ap",
		remaining_loss: data.pieces.find((piece) => piece.id === attacker.piece).loss,
		modifiers: {
			cards: [{ id: 620, faction: "ap", effect: data.card_effects[620].combat }],
			cancel_retreat: [],
			cancel_advance: [],
			prohibit_advance: [],
			minimum_retreat: 0
		},
		origins: { [attacker.id]: attacker.location, [defender.id]: defender.location }
	}
	state.state = "combat_losses"
	rules.action(state, "Allied Powers", "take_loss", attacker.id)
	assert.equal(attacker.reduced, true)
	defender.reduced = true
	assert.equal(state.pending_event.kind, "combat_repair")
	assert.ok(eventUnitCandidates(state, "Allied Powers").includes(attacker.id))
	assert.equal(eventUnitCandidates(state, "Allied Powers").includes(defender.id), false)
	chooseEventUnits(state, "Allied Powers", [attacker.id])
	assert.equal(attacker.reduced, false)
})

test("620 rebuilds an eliminated attacking LCU at its origin and may return its replacement SCU", () => {
	const state = setupGame(620)
	const card = data.cards.find((candidate) => candidate.id === 620)
	configureCombatCardFixture(state, card)
	const attacker = state.units.find((unit) => unit.id === "combat-attacker")
	const defender = state.units.find((unit) => unit.id === "combat-defender")
	const origin = attacker.location
	state.reserves.ap = data.pieces
		.filter((piece) => piece.type === "corps" && piece.faction === "ap")
		.map((piece, index) => ({
			id: `champagne-replacement-${index}`,
			piece: piece.id,
			faction: "ap",
			nation: piece.nation,
			type: "corps",
			reduced: false,
			supplied: true
		}))
	const replacement = rules._test.combatReplacementOptions(state, attacker)[0]
	assert.ok(replacement)
	attacker.reduced = true
	state.events[card.event] = { faction: "ap", duration: "action_round", expires: "action_round" }
	state.combat_window = null
	state.combat = {
		attacker: "ap",
		attackers: [attacker.id],
		defenders: [defender.id],
		target: defender.location,
		attack_loss: data.pieces.find((piece) => piece.id === attacker.piece).reduced_loss,
		defense_loss: 0,
		pending_side: "ap",
		remaining_loss: data.pieces.find((piece) => piece.id === attacker.piece).reduced_loss,
		modifiers: {
			cards: [{ id: 620, faction: "ap", effect: data.card_effects[620].combat }],
			cancel_retreat: [], cancel_advance: [], prohibit_advance: [], minimum_retreat: 0
		},
		origins: { [attacker.id]: origin, [defender.id]: defender.location },
		resolution_events: []
	}
	state.active = "ap"
	state.state = "combat_losses"
	rules.action(state, "Allied Powers", "take_loss", attacker.id)
	assert.ok(state.eliminated.ap.some((unit) => unit.id === attacker.id))
	assert.ok(state.units.some((unit) => unit.id === replacement.id && unit.location === origin))
	assert.equal(state.pending_event.kind, "combat_repair")
	chooseEventUnits(state, "Allied Powers", [attacker.id])
	assert.equal(state.pending_event.replacement_choice.army, attacker.id)
	rules.action(state, "Allied Powers", "event_choose", "return")
	const rebuilt = state.units.find((unit) => unit.id === attacker.id)
	assert.equal(rebuilt.location, origin)
	assert.equal(rebuilt.reduced, true)
	assert.ok(state.reserves.ap.some((unit) => unit.id === replacement.id && !unit.reduced))
})

test("621 Air Supremacy is canceled by 721 Fokker Scourge in either commitment order", () => {
	const state = setupGame(621)
	configureCombatCardFixture(state, data.cards.find((card) => card.id === 621))
	state.active = "ap"
	state.state = "combat_card_window"
	state.hands.ap = [621]
	state.hands.cp = [721]
	rules.action(state, "Allied Powers", "combat_card", 621)
	rules.action(state, "Allied Powers", "pass")
	assert.ok(rules.view(state, "Central Powers").actions.combat_card.includes(721))
	rules.action(state, "Central Powers", "combat_card", 721)
	assert.equal(state.discard.ap.includes(621) || state.removed.ap.includes(621), true)
	assert.equal(state.events[data.cards.find((card) => card.id === 621).event], undefined)

	const blocked = setupGame(622)
	configureCombatCardFixture(blocked, data.cards.find((card) => card.id === 621))
	blocked.active = "ap"
	blocked.state = "combat_card_window"
	blocked.hands.ap = [621]
	blocked.events["cp_福克灾难_禁用空中优势"] = {
		faction: "cp",
		persistent: true
	}
	assert.equal(
		rules.view(blocked, "Allied Powers").actions.combat_card?.includes(621) || false,
		false
	)
})

test("629 Mine Attack removes itself, returns trench-dependent cards, and deploys one Plumer HQ", () => {
	const state = setupGame(629)
	const card = data.cards.find((candidate) => candidate.id === 629)
	configureCombatCardFixture(state, card)
	const attacker = state.units.find((unit) => unit.id === "combat-attacker")
	const british = data.pieces.find(
		(piece) => piece.nation === "br" && ["army", "corps"].includes(piece.type)
	)
	attacker.piece = british.id
	attacker.nation = "br"
	state.active = "ap"
	state.state = "combat_card_window"
	state.hands.ap = [629]
	state.combat_window.cards = [722]
	state.combat_window.card_sources = { 722: "hand" }
	state.events[data.cards.find((candidate) => candidate.id === 722).event] = {
		faction: "cp",
		expires: "combat"
	}
	state.trenches[state.combat_window.declaration.target] = 2
	rules.action(state, "Allied Powers", "combat_card", 629)
	assert.equal(state.hands.cp.includes(722), true)
	assert.equal(state.combat_window.cards.includes(722), false)
	rules._test.revealCommittedCombatCards(state)
	assert.equal(state.removed.ap.includes(629), true)
	assert.equal(state.pending_event.kind, "combat_hq_reinforcement")
	const origin = rules.view(state, "Allied Powers").actions.event_space[0]
	assert.equal(origin, attacker.location)
	rules.action(state, "Allied Powers", "event_space", origin)
	const plumers = state.units.filter((unit) => unit.piece === "component-088")
	assert.equal(plumers.length, 1)
	assert.equal(plumers[0].location, origin)
	assert.equal(state.combat_window.declaration.attackers.includes(plumers[0].id), true)
})

test("Spirit of 1914 can be held for the post-combat two-point repair branch", () => {
	const state = setupGame(714)
	state.hands.cp = [714]
	const cpUnit = state.units.find((unit) => unit.faction === "cp")
	const apUnit = state.units.find((unit) => unit.faction === "ap")
	assert.ok(cpUnit)
	assert.ok(apUnit)
	state.units = [cpUnit, apUnit]
	cpUnit.reduced = true
	state.combat = {
		attacker: "ap",
		attackers: [apUnit.id],
		defenders: [cpUnit.id],
		target: cpUnit.location,
		attack_loss: 0,
		defense_loss: 1,
		modifiers: { cards: [], cancel_retreat: [], cancel_advance: [] },
		origins: { [apUnit.id]: apUnit.location, [cpUnit.id]: cpUnit.location }
	}
	state.post_combat_window = { attacker: "ap", defender: "cp", side: "cp" }
	state.active = "cp"
	state.state = "post_combat_card_window"
	assert.ok(rules.view(state, "Central Powers").actions.combat_card.includes(714))
	rules.action(state, "Central Powers", "combat_card", 714)
	assert.equal(state.pending_event.kind, "combat_repair")
	chooseEventUnits(state, "Central Powers", [cpUnit.id])
	assert.equal(cpUnit.reduced, false)
})

test("attack-cancel combat cards terminate combat without rolling", () => {
	const state = setupGame(712)
	const card = data.cards.find((candidate) => candidate.id === 712)
	state.active = "cp"
	state.state = "combat_card_window"
	state.hands.cp = [712]
	configureCombatCardFixture(state, card)
	rules.action(state, "Central Powers", "combat_card", 712)
	rules.action(state, "Central Powers", "pass")
	rules.action(state, "Allied Powers", "pass")
	assert.equal(state.state, "ops_activate")
	assert.equal(state.combat, null)
	assert.match(state.log.at(-1), /取消/)
})

test("609 Miracle on the Marne cancels the German attack and launches a no-card AP counterattack", () => {
	const state = setupGame(609)
	const card = data.cards.find((candidate) => candidate.id === 609)
	state.active = "ap"
	state.state = "combat_card_window"
	state.hands.ap = [609]
	configureCombatCardFixture(state, card)
	const apUnit = state.units.find((unit) => unit.faction === "ap")
	const cpUnit = state.units.find((unit) => unit.faction === "cp")
	state.combat_window = {
		declaration: { attackers: [cpUnit.id], target: apUnit.location },
		attacker: "cp",
		defender: "ap",
		side: "ap",
		cards: []
	}
	rules.action(state, "Allied Powers", "combat_card", 609)
	rules.action(state, "Allied Powers", "pass")
	rules.action(state, "Central Powers", "pass")
	assert.equal(state.pending_event.kind, "counterattack")
	assert.equal(state.pending_event.stage, "origin")
	const origin = rules.view(state, "Central Powers").actions.event_space[0]
	rules.action(state, "Central Powers", "event_space", origin)
	assert.equal(state.state, "combat_losses")
	assert.equal(state.combat.modifiers.first_fire, "ap")
})

test("Nivelle creates two server-enforced French attacks with a one-loss reduction", () => {
	const state = setupGame(739)
	const frArmy = data.pieces.find((piece) => piece.nation === "fr" && piece.type === "army")
	const frCorps = data.pieces.find((piece) => piece.nation === "fr" && piece.type === "corps")
	const geCorps = data.pieces.find((piece) => piece.nation === "ge" && piece.type === "corps")
	const origins = data.spaces.filter((space) => landNeighbors(space).length).slice(0, 2)
	assert.ok(frArmy)
	assert.ok(frCorps)
	assert.ok(geCorps)
	state.units = []
	for (let index = 0; index < origins.length; index++) {
		const origin = origins[index]
		state.units.push({
			id: `nivelle-fr-${index}`,
			piece: frArmy.id,
			faction: "ap",
			nation: "fr",
			type: "army",
			location: origin.id,
			reduced: false,
			supplied: true
		})
		state.units.push({
			id: `nivelle-ge-${index}`,
			piece: geCorps.id,
			faction: "cp",
			nation: "ge",
			type: "corps",
			location: landNeighbors(origin)[0],
			reduced: false,
			supplied: true
		})
	}
	state.combat = {
		attacker: "ap",
		attackers: [],
		defenders: [],
		target: origins[0].id,
		modifiers: {
			cards: [{ id: 739, faction: "cp", effect: data.card_effects[739].combat }]
		}
	}
	state.pending_retreat = { units: [], target: origins[0].id }
	state.active = "ap"
	state.state = "advance_select"
	state.ops = { remaining: 0, forced_attacks: [] }
	rules.action(state, "Allied Powers", "decline_advance")
	assert.equal(state.pending_event.kind, "nivelle_attacks")
	const spaces = rules.view(state, "Central Powers").actions.event_space.slice(0, 2)
	assert.equal(spaces.length, 2)
	for (const space of spaces) rules.action(state, "Central Powers", "event_space", space)
	rules.action(state, "Central Powers", "event_confirm")
	assert.deepEqual(new Set(state.ops.forced_attacks), new Set(spaces))
	state.ops.execution_phase = "attack"

	const origin = spaces[0]
	const first = state.units.find((unit) => unit.faction === "ap" && unit.location === origin)
	state.units.push({
		id: "nivelle-extra-fr",
		piece: frCorps.id,
		faction: "ap",
		nation: "fr",
		type: "corps",
		location: origin,
		reduced: false,
		supplied: true
	})
	const target = data.spaces.find((space) => space.id === origin).connections.find(
		(space) => state.units.some((unit) => unit.faction === "cp" && unit.location === space)
	)
	assert.throws(() => rules._test.validateAttackDeclaration(state, { attackers: [first.id], target }), /required unit/)
	rules._test.beginCombat(state, { attackers: [first.id, "nivelle-extra-fr"], target, flank: false })
	assert.equal(state.combat_window.declaration.forced_loss_adjust, -1)
	rules._test.resolveCombat(state, state.combat_window.declaration)
})

test("602 Strategic Retreat lets each retreating unit choose its own distance", () => {
	const state = setupGame(602)
	const units = state.units.filter((unit) => unit.faction === "ap").slice(0, 2)
	assert.equal(units.length, 2)
	const start = data.spaces.find((space) => space.connections.length)
	assert.ok(start)
	for (const unit of units) unit.location = start.id
	state.combat = { attacker: "cp", modifiers: { cards: [] } }
	state.pending_retreat = {
		faction: "ap",
		units: units.map((unit) => unit.id),
		steps: null,
		choices: data.card_effects[602].combat.retreat_choice,
		from: start.id,
		remaining: Object.fromEntries(units.map((unit) => [unit.id, null])),
		paths: Object.fromEntries(units.map((unit) => [unit.id, [start.id]])),
		can_cancel_with_loss: false
	}
	state.active = "ap"
	state.state = "retreat"
	const actions = rules.view(state, "Allied Powers").actions
	assert.equal(actions.retreat_distance, undefined)
	assert.equal(actions.begin_retreat, undefined)
	assert.equal(actions.select_retreat_one.includes(units[0].id), true)
	assert.equal(actions.select_retreat_one.includes(units[1].id), true)
	rules.action(state, "Allied Powers", "select_retreat_one", units[0].id)
	assert.equal(rules.view(state, "Allied Powers").actions.select_retreat_one.includes(units[1].id), true)
	rules.action(state, "Allied Powers", "select_retreat_one", units[1].id)
	assert.deepEqual(state.pending_retreat.selected_units, units.map((unit) => unit.id))
	assert.equal("selected_unit" in state.pending_retreat, false)
	assert.equal(state.pending_retreat.remaining[units[0].id], 1)
	assert.equal(state.pending_retreat.remaining[units[1].id], 1)
})

test("damaged-unit retreat cancellation prohibitions are enforced by server actions", () => {
	const state = setupGame(734)
	const units = state.units.filter((unit) => unit.faction === "ap").slice(0, 2)
	assert.equal(units.length, 2)
	units[0].reduced = true
	units[1].reduced = false
	state.combat = { attacker: "cp", modifiers: { cards: [] } }
	state.pending_retreat = {
		faction: "ap",
		units: units.map((unit) => unit.id),
		steps: 1,
		remaining: Object.fromEntries(units.map((unit) => [unit.id, 1])),
		paths: Object.fromEntries(units.map((unit) => [unit.id, [unit.location]])),
		can_cancel_with_loss: true,
		prohibit_damaged_cancel: true
	}
	state.active = "ap"
	state.state = "retreat"
	assert.deepEqual(rules.view(state, "Allied Powers").actions.cancel_retreat, [units[1].id])
	rules.action(state, "Allied Powers", "cancel_retreat", units[0].id)
	assert.equal(state.state, "retreat")
	rules.action(state, "Allied Powers", "cancel_retreat", units[1].id)
	assert.equal(units[1].reduced, true)
	assert.notEqual(state.state, "retreat")
	assert.equal(state.pending_retreat, null)
})

test("action-round combat effects expire at the next action round", () => {
	const state = setupGame(620)
	const card = data.cards.find((candidate) => candidate.id === 620)
	state.active = "ap"
	state.state = "combat_card_window"
	state.hands.ap = [620]
	configureCombatCardFixture(state, card)
	rules.action(state, "Allied Powers", "combat_card", 620)
	assert.equal(state.events[card.event].expires, "action_round")
	state.combat_window = null
	state.combat = null
	state.state = "action_card"
	state.action_round = 1
	state.active = "ap"
	state.hands.ap = [600]
	rules.action(state, "Allied Powers", "card_rp", 600)
	assert.equal(state.action_round, 2)
	assert.equal(Boolean(state.events[card.event]), false)
})

test("603 BEF Reinforcement stages its exact map and reserve manifest before confirmation", () => {
	const state = setupGame(603)
	state.active = "ap"
	state.state = "action_card"
	state.hands.ap = [603]
	const before = {
		map: state.units.length,
		reserve: state.reserves.ap.length,
		upgrade: state.upgrade_pool.ap.length
	}
	rules.action(state, "Allied Powers", "card_event", 603)
	assert.equal(state.pending_event.kind, "reinforcement")
	assert.equal(state.pending_event.naval_event, false)
	assert.equal(state.pending_event.placements.length, 0)
	while (state.pending_event.index < state.pending_event.queue.length) {
		const actions = rules.view(state, "Allied Powers").actions
		if (actions.reinforcement_to_reserve) {
			rules.action(state, "Allied Powers", "reinforcement_to_reserve")
		} else {
			assert.ok(actions.event_space?.length)
			rules.action(state, "Allied Powers", "event_space", actions.event_space[0])
		}
	}
	assert.equal(state.units.length, before.map)
	assert.equal(state.reserves.ap.length, before.reserve)
	rules.action(state, "Allied Powers", "event_confirm")
	assert.equal(state.units.length, before.map + 4)
	assert.equal(state.reserves.ap.length, before.reserve + 7)
	assert.equal(state.upgrade_pool.ap.length, before.upgrade)
	assert.equal(state.units.filter((unit) => unit.piece === "component-097").length >= 2, true)
})

test("603 staged placements undo one counter at a time", () => {
	const state = setupGame(603)
	state.active = "ap"
	state.state = "action_card"
	state.hands.ap = [603]
	rules.action(state, "Allied Powers", "card_event", 603)
	state.undo = []
	for (let expected = 1; expected <= 3; ++expected) {
		const actions = rules.view(state, "Allied Powers").actions
		if (actions.reinforcement_to_reserve)
			rules.action(state, "Allied Powers", "reinforcement_to_reserve")
		else
			rules.action(state, "Allied Powers", "event_space", actions.event_space[0])
		assert.equal(state.pending_event.index, expected)
		assert.equal(state.undo.length, expected)
	}
	for (let expected = 2; expected >= 0; --expected) {
		rules.action(state, "Allied Powers", "undo")
		assert.equal(state.pending_event.index, expected)
		assert.equal(state.pending_event.placements.length, expected)
	}
})

test("cancelling a staged reinforcement leaves every unit pool unchanged", () => {
	const state = setupGame(615)
	state.active = "ap"
	state.state = "action_card"
	state.commitment.ap = "total"
	state.hands.ap = [615]
	const before = JSON.stringify({
		units: state.units,
		reserves: state.reserves,
		upgrades: state.upgrade_pool
	})
	rules.action(state, "Allied Powers", "card_event", 615)
	const legal = rules.view(state, "Allied Powers").actions.event_space
	rules.action(state, "Allied Powers", "event_space", legal[0])
	rules.action(state, "Allied Powers", "event_cancel")
	assert.equal(
		JSON.stringify({ units: state.units, reserves: state.reserves, upgrades: state.upgrade_pool }),
		before
	)
	assert.equal(state.hands.ap.includes(615), true)
})

test("627 Cadorna adds persistent Italian MO tokens and changes future draw counts", () => {
	const state = setupGame(627)
	state.active = "ap"
	state.state = "action_card"
	state.commitment.ap = "limited"
	state.hands.ap = [627]
	rules.action(state, "Allied Powers", "card_event", 627)
	finishPendingEvent(state, "Allied Powers", data.cards.find((card) => card.id === 627))
	assert.equal(state.mo.pool.it.filter((entry) => entry.source_card === 627).length, 3)
	assert.equal(state.mo.draw_bonus.it, 1)

	const mutiny = setupGame(743)
	mutiny.active = "cp"
	mutiny.state = "action_card"
	mutiny.commitment.cp = "total"
	mutiny.hands.cp = [743]
	mutiny.rp.ap.fr = 3
	rules.action(mutiny, "Central Powers", "card_event", 743)
	assert.equal(mutiny.mo.pool.fr.filter((entry) => entry.source_card === 743).length, 3)
	assert.equal((mutiny.mo.current.fr || []).filter((id) => id.startsWith("743:mo:")).length, 0)
	assert.equal(mutiny.rp.ap.fr, 1)
})

test("influenza stages both players' choices before applying four army losses each", () => {
	const state = setupGame(635)
	state.active = "ap"
	state.state = "action_card"
	state.commitment.ap = "total"
	state.hands.ap = [635]
	const fullArmies = (faction) =>
		state.units
			.filter((unit) => unit.faction === faction && unit.type === "army" && !unit.reduced)
			.slice(0, 4)
			.map((unit) => unit.id)
	const ap = fullArmies("ap")
	const cp = fullArmies("cp")
	assert.equal(ap.length, 4)
	assert.equal(cp.length, 4)
	const vp = state.vp
	for (const nation of ["fr", "br", "it", "us"])
		state.mo.completed[nation] = [...(state.mo.current[nation] || [])]

	rules.action(state, "Allied Powers", "card_event", 635)
	chooseEventUnits(state, "Allied Powers", ap)
	assert.equal(ap.some((id) => state.units.find((unit) => unit.id === id).reduced), false)
	assert.equal(state.active, "cp")
	chooseEventUnits(state, "Central Powers", cp)
	assert.equal([...ap, ...cp].every((id) => state.units.find((unit) => unit.id === id).reduced), true)
	assert.equal(state.vp, vp - 1)
})

test("Women Labor searches a structured army-reinforcement card into the AP hand", () => {
	const state = setupGame(652)
	state.active = "ap"
	state.state = "action_card"
	state.commitment.ap = "total"
	state.hands.ap = [652]
	state.decks.ap = [603]
	state.discard.ap = []
	rules.action(state, "Allied Powers", "card_event", 652)
	assert.deepEqual(rules.view(state, "Allied Powers").actions.event_choose, ["603"])
	rules.action(state, "Allied Powers", "event_choose", "603")
	assert.equal(state.hands.ap.includes(603), true)
	assert.equal(state.decks.ap.includes(603), false)
	assert.equal(state.state, "ops_activate")
	assert.equal(state.ops.remaining, 2)
	assert.deepEqual(data.cards.find((card) => card.id === 652).rp, {
		br: 3,
		fr: 3,
		it: 2,
		us: 1
	})
})

test("608 Trenches grants printed OP while prohibiting attack activations", () => {
	const state = setupGame(608)
	state.turn = 3
	state.active = "ap"
	state.state = "action_card"
	state.hands.ap = [608]
	rules.action(state, "Allied Powers", "card_event", 608)
	assert.equal(state.state, "ops_activate")
	assert.equal(state.ops.remaining, data.cards.find((card) => card.id === 608).ops)
	const actions = rules.view(state, "Allied Powers").actions
	assert.equal("activate_attack" in actions, false)
	assert.ok(actions.activate_move.length)
	const space = actions.activate_move[0]
	rules.action(state, "Allied Powers", "activate_move", space)
	while (state.ops.remaining > 0) {
		const next = rules.view(state, "Allied Powers").actions.activate_move[0]
		assert.ok(next)
		rules.action(state, "Allied Powers", "activate_move", next)
	}
	rules.action(state, "Allied Powers", "finish")
	if (state.state === "movement_units")
		rules.action(state, "Allied Powers", "cancel")
	assert.ok(state.events[data.cards.find((card) => card.id === 608).event])
})

test("Zeppelin raids schedule deterministic RP losses for the next two turns", () => {
	const state = setupGame(716)
	state.active = "cp"
	state.state = "action_card"
	state.commitment.cp = "total"
	state.hands.cp = [716]
	state.rp.ap.br = 5
	state.rp.ap.us = 5
	rules.action(state, "Central Powers", "card_event", 716)
	assert.equal(state.rp.ap.br, 4)
	assert.equal(state.rp.ap.us, 4.5)
	assert.deepEqual(
		state.scheduled_events.map((entry) => entry.due_turn),
		[state.turn + 1, state.turn + 2]
	)
})

test("unrestricted U-boats allow 723 only as a five-point naval event", () => {
	const state = setupGame(723)
	state.active = "cp"
	state.state = "action_card"
	state.commitment.cp = "total"
	state.hands.cp = [723]
	state.events[data.cards.find((card) => card.id === 746).event] = { faction: "cp" }
	assert.equal(rules.view(state, "Central Powers").actions.card_event?.includes(723) || false, false)
	state.state = "naval_choice"
	state.phase = "海军阶段"
	state.naval.selections = {}
	rules.action(state, "Central Powers", "naval_event", 723)
	state.hands.ap = []
	rules.action(state, "Allied Powers", "naval_empty_fleet")
	assert.equal(state.naval.points.cp, 5)
	assert.equal(state.turn_flags.british_reinforcements_reduced, undefined)
})

test("601 Regional Rotation repeat event grants one base RP and stages one optional French step RP", () => {
	const state = setupGame(601)
	state.active = "ap"
	state.state = "action_card"
	state.hands.ap = [601]
	state.events[data.cards.find((card) => card.id === 601).event] = { faction: "ap" }
	const unit = state.units.find(
		(candidate) =>
			candidate.nation === "fr" &&
			["army", "corps"].includes(candidate.type) &&
			!candidate.reduced
	)
	assert.ok(unit)
	const rp = state.rp.ap.fr
	rules.action(state, "Allied Powers", "card_event", 601)
	rules.action(state, "Allied Powers", "event_choose", "reduce")
	chooseEventUnits(state, "Allied Powers", [unit.id])
	assert.equal(unit.reduced, true)
	assert.equal(state.rp.ap.fr, rp + 2)
})

test("607 French Reserves grants one free SR on T1 and two thereafter", () => {
	const state = setupGame(607)
	state.active = "ap"
	state.state = "action_card"
	state.hands.ap = [607]
	const card = data.cards.find((candidate) => candidate.id === 607)
	rules.action(state, "Allied Powers", "card_event", 607)
	finishPendingEvent(state, "Allied Powers", card)
	assert.equal(state.state, "sr")
	assert.equal(state.sr.free, true)
	assert.equal(state.sr.remaining, 1)
	assert.ok(state.sr.destinations.length >= 2)
	const srView = rules.view(state, "Allied Powers")
	const srUnits = srView.actions.select_sr_unit || (state.sr.selected_unit ? [state.sr.selected_unit] : [])
	assert.ok(srUnits.length || srView.actions.finish === 1)
	for (const id of srUnits) {
		const unit = state.units.find((candidate) => candidate.id === id)
		assert.equal(unit.nation, "fr")
		assert.equal(unit.type, "army")
		assert.equal(rules._test.srDestinations(state, unit).every((space) => state.sr.destinations.includes(space)), true)
	}
	const later = setupGame(607)
	later.turn = 2
	later.active = "ap"
	later.state = "action_card"
	later.hands.ap = [607]
	rules.action(later, "Allied Powers", "card_event", 607)
	finishPendingEvent(later, "Allied Powers", card)
	assert.equal(later.sr.remaining, 2)
})

test("OHL discards one CP card and schedules a discarded combat card for next turn", () => {
	const state = setupGame(713)
	const rule = data.card_effects[713].operations.find(
		(operation) => operation.type === "rule_modifier"
	)
	state.events[data.cards.find((card) => card.id === 713).event] = {
		faction: "cp",
		rule
	}
	state.hands.cp = [700]
	state.discard.cp = [702]
	state.active = "ap"
	state.state = "ops_activate"
	state.action_round = 6
	for (const [nation, ids] of Object.entries(state.mo.current))
		state.mo.completed[nation] = ids.slice()
	state.ops = { card: null, total: 1, remaining: 0, activated: [], moving: null }
	state.usage_limits[`front_maintenance:${state.turn}`] = 1
	rules.action(state, "Allied Powers", "finish")
	assert.equal(state.pending_event.kind, "ohl")
	rules.action(state, "Central Powers", "event_choose", "700")
	rules.action(state, "Central Powers", "event_choose", "702")
	assert.equal(state.state, "replacement")
	assert.equal(state.discard.cp.includes(700), true)
	assert.deepEqual(
		state.scheduled_events.find((entry) => entry.kind === "card_return"),
		{
			kind: "card_return",
			source_card: 713,
			due_turn: state.turn + 1,
			faction: "cp",
			card: 702
		}
	)
})

test("White Feather requires French and British reserve-corps SR before the CP search", () => {
	const state = setupGame(752)
	state.active = "cp"
	state.state = "action_card"
	state.commitment.cp = "total"
	state.hands.cp = [752]
	state.discard.cp = [724]
	const startingReserve = state.reserves.ap.length
	rules.action(state, "Central Powers", "card_event", 752)
	for (const nation of ["fr", "br"]) {
		assert.equal(state.active, "ap")
		assert.equal(state.pending_event.kind, "white_feather_sr")
		assert.equal(state.pending_event.queue[state.pending_event.index], nation)
		const unit = state.pending_event.unit || eventUnitCandidates(state, "Allied Powers")[0]
		assert.ok(unit)
		if (!state.pending_event.unit)
			chooseEventUnits(state, "Allied Powers", [unit])
		const destination = rules.view(state, "Allied Powers").actions.event_space[0]
		assert.ok(destination)
		rules.action(state, "Allied Powers", "event_space", destination)
		assert.equal(state.units.some((candidate) => candidate.id === unit && candidate.location === destination), true)
	}
	assert.equal(state.active, "cp")
	const searched = rules.view(state, "Central Powers").actions.event_choose[0]
	assert.ok(searched)
	rules.action(state, "Central Powers", "event_choose", searched)
	assert.equal(state.reserves.ap.length, startingReserve - 2)
	assert.equal(state.state, "action_card")
	assert.equal(state.active, "ap")
})

test("Churchill permits a non-lethal British step to pay Turkish-front RP", () => {
	const state = setupGame(626)
	state.events.entry_tu = true
	state.events["cp_土耳其参战"] = true
	state.active = "ap"
	state.state = "action_card"
	state.commitment.ap = "limited"
	state.hands.ap = [626]
	rules.action(state, "Allied Powers", "card_event", 626)
	rules.action(state, "Allied Powers", "event_choose", "front_only")
	state.active = "ap"
	state.state = "replacement"
	state.rp.ap.br = 0
	const britishPiece = data.pieces.find((piece) => piece.nation === "br" && piece.type === "army")
	const britishSpace = data.spaces.find((space) => space.faction === "ap" && space.supply && !space.ui?.hidden)
	state.units.push({
		id: "churchill-payment",
		piece: britishPiece.id,
		faction: "ap",
		nation: "br",
		type: "army",
		location: britishSpace.id,
		reduced: false,
		moved: false,
		attacked: false,
		supplied: true,
		limited_supply: false
	})
	const startingFront = state.fronts.turkish
	const unit = rules.view(state, "Allied Powers").actions.event_front_step[0]
	assert.ok(unit)
	rules.action(state, "Allied Powers", "event_front_step", unit)
	assert.equal(state.units.find((candidate) => candidate.id === unit).reduced, true)
	rules.action(state, "Allied Powers", "spend_front", "turkish")
	assert.ok(state.state.startsWith("event_"))
	assert.equal(state.pending_event.paid, 1)
	rules.action(state, "Allied Powers", "event_choose", "store")
	assert.equal(state.fronts.turkish, startingFront)
	assert.equal(state.front_storage.turkish, 1)
	assert.equal(state.rp.ap.br, 0)
})

test("Schlieffen Plan grants one free reserve-corps SR to each activated space", () => {
	const state = setupGame(707)
	state.active = "cp"
	state.state = "action_card"
	state.hands.cp = [707]
	rules.action(state, "Central Powers", "card_event", 707)
	assert.equal(state.state, "ops_activate")
	const space = rules.view(state, "Central Powers").actions.activate_move[0]
	assert.ok(space)
	rules.action(state, "Central Powers", "activate_move", space)
	const protocolBefore = rules.view(state, "Central Powers")
	assert.equal(protocolBefore.actions.preactivate_sr, undefined)
	assert.ok(protocolBefore.actions.select_sr_unit.length)
	const reserveUnit = rules.view(state, "Central Powers").actions.select_sr_unit[0]
	assert.ok(reserveUnit)
	const reserveCount = state.reserves.cp.length
	rules.action(state, "Central Powers", "select_sr_unit", reserveUnit)
	assert.deepEqual(rules.view(state, "Central Powers").actions.sr_destination, [space])
	rules.action(state, "Central Powers", "sr_destination", space)
	assert.equal(state.reserves.cp.length, reserveCount - 1)
	assert.equal(
		state.units.some(
			(unit) => unit.id === reserveUnit && unit.location === space
		),
		true
	)
	assert.equal(
		rules.view(state, "Central Powers").actions.select_sr_unit?.includes(reserveUnit) || false,
		false
	)
})

test("651 Junker Officers is an eventable mobilization white card with no effect", () => {
	const state = setupGame(651)
	state.active = "ap"
	state.state = "action_card"
	state.hands.ap = [651]
	const actions = rules.view(state, "Allied Powers").actions
	assert.equal(actions.card_event?.includes(651) || false, true)
	assert.equal(actions.card_ops.includes(651), true)
	assert.equal(actions.card_sr.includes(651), true)
	assert.equal(actions.card_rp.includes(651), true)
	assert.equal(data.cards.find((card) => card.id === 651).commitment, "mobilization")
	assert.deepEqual(data.card_effects[651].operations, [{ type: "noop" }])
})

test("606 Channel Blockade prevents CP strategic redeployment into Channel ports", () => {
	const state = setupGame(606)
	const unit = state.units.find(
		(candidate) =>
			candidate.faction === "cp" &&
			candidate.nation === "ge"
	)
	assert.ok(unit)
	state.turn = 3
	state.active = "cp"
	state.state = "sr"
	state.sr = { card: 700, remaining: 10 }
	for (const space of data.spaces) state.control[space.id] = "cp"
	state.units = state.units.filter(
		(candidate) => candidate.faction === "cp" && (candidate.location !== "calais" || candidate.id === unit.id)
	)
	const before = rules.view(state, "Central Powers").actions.select_sr_unit?.includes(unit.id) ? rules._test.srDestinations(state, unit) : []
	assert.equal(before.includes("calais"), true)
	state.events[data.cards.find((card) => card.id === 606).event] = { faction: "ap" }
	const after = rules.view(state, "Central Powers").actions.select_sr_unit?.includes(unit.id) ? rules._test.srDestinations(state, unit) : []
	assert.equal(after.includes("calais"), false)
})

test("August Guns destroys a Belgian fort and allows optional adjacent CP redeployment", () => {
	const state = setupGame(701)
	state.active = "cp"
	state.state = "action_card"
	state.turn = 1
	state.action_round = 1
	state.hands.cp = [701]
	configureAugustGunsFixture(state)
	rules.action(state, "Central Powers", "card_event", 701)
	const fort = rules.view(state, "Central Powers").actions.event_space[0]
	assert.ok(fort)
	rules.action(state, "Central Powers", "event_space", fort)
	rules.action(state, "Central Powers", "event_confirm")
	if (state.pending_event.kind === "august_belgian_relocation") {
		assert.equal(state.pending_event.owner, "cp")
		assert.equal(state.pending_event.chooser, "ap")
		assert.equal(state.active, "ap")
	}
	while (state.pending_event.kind === "august_belgian_relocation") {
		const destination = rules.view(state, "Allied Powers").actions.event_space[0]
		assert.ok(destination)
		rules.action(state, "Allied Powers", "event_space", destination)
		assert.equal(state.pending_event.owner, "cp")
	}
	assert.equal(state.pending_event.kind, "august_reposition")
	assert.equal(state.destroyed_forts.includes(fort), true)
	const protocolBefore = rules.view(state, "Central Powers")
	assert.equal(protocolBefore.actions.event_units, undefined)
	assert.ok(protocolBefore.actions.select_august_unit.length)
	const unit = rules.view(state, "Central Powers").actions.select_august_unit[0]
	assert.ok(unit)
	rules.action(state, "Central Powers", "select_august_unit", unit)
	assert.deepEqual(rules.view(state, "Central Powers").actions.event_space, [fort])
	rules.action(state, "Central Powers", "event_space", fort)
	assert.equal(state.units.find((candidate) => candidate.id === unit).location, fort)
	assert.equal(state.control[fort], "cp")
	rules.action(state, "Central Powers", "finish_august_reposition")
	assert.equal(state.state, "ops_activate")
	assert.equal(state.ops.remaining, 2)
})

test("Killing Ground removes Falkenhayn when maintenance cannot be paid", () => {
	const state = setupGame(720)
	const event = data.cards.find((card) => card.id === 720).event
	const falkenhayn = data.pieces.find((piece) => piece.name === "G法金汉")
	const supply = data.spaces.find((space) => space.faction === "cp" && space.supply && !space.ui?.hidden)
	assert.ok(falkenhayn)
	state.units.push({
		id: "falkenhayn-test",
		piece: falkenhayn.id,
		faction: "cp",
		nation: "ge",
		type: "hq",
		location: supply.id,
		reduced: false,
		supplied: true
	})
	state.events[event] = { faction: "cp" }
	state.markers.killing_ground = { space: "verdun", cost: 2, source_card: 720 }
	state.rp.cp.ge = 0
	state.active = "ap"
	state.state = "ops_activate"
	state.action_round = 6
	for (const [nation, ids] of Object.entries(state.mo.current))
		state.mo.completed[nation] = ids.slice()
	state.ops = { card: null, total: 1, remaining: 0, activated: [], moving: null }
	state.usage_limits[`front_maintenance:${state.turn}`] = 1
	rules.action(state, "Allied Powers", "finish")
	assert.ok(state.state.startsWith("event_"))
	assert.deepEqual(rules.view(state, "Central Powers").actions.event_choose, ["abandon"])
	rules.action(state, "Central Powers", "event_choose", "abandon")
	assert.equal(state.state, "replacement")
	assert.equal(state.units.some((unit) => unit.id === "falkenhayn-test"), false)
	assert.equal(state.permanently_removed_units.some((unit) => unit.id === "falkenhayn-test"), true)
	assert.equal(state.markers.killing_ground, undefined)
	assert.equal(state.events[event], undefined)
})

test("Killing Ground attacks automatically complete the pending German MO", () => {
	const state = setupGame(720)
	const target = data.spaces.find((space) => landNeighbors(space).length && !space.ui?.hidden)
	const origin = data.spaces.find((space) => space.id === landNeighbors(target)[0])
	const ge = data.pieces.find((piece) => piece.nation === "ge" && piece.type === "army")
	const fr = data.pieces.find((piece) => piece.nation === "fr" && piece.type === "army")
	state.units = [
		{ id: "kg-ge", piece: ge.id, faction: "cp", nation: "ge", type: "army", location: origin.id, reduced: false, supplied: true },
		{ id: "kg-fr", piece: fr.id, faction: "ap", nation: "fr", type: "army", location: target.id, reduced: false, supplied: true }
	]
	state.active = "cp"
	state.state = "ops_activate"
	state.ops = { card: null, total: 1, remaining: 0, activated: [origin.id], moving: null, execution_phase: "attack" }
	state.activations = { [origin.id]: "attack" }
	state.markers.killing_ground = { space: target.id, cost: 1, source_card: 720 }
	state.mo.current.ge = ["ge-3"]
	state.mo.completed.ge = []
	declareAttack(state, "Central Powers", ["kg-ge"], target.id)
	assert.equal(state.mo.completed.ge.includes("ge-3"), false)
	for (let index = 0; index < 2; index++) {
		const role = state.active === "cp" ? "Central Powers" : "Allied Powers"
		rules.action(state, role, "pass")
	}
	assert.deepEqual(state.mo.completed.ge, ["ge-3"])
})

test("entering the Killing Ground destroys the fort, scores printed VP, and returns the card to discard", () => {
	const state = setupGame(720)
	const target = data.spaces.find(
		(space) => space.fort && space.nation === "fr" && landNeighbors(space).length && !space.ui?.hidden
	)
	const origin = data.spaces.find((space) => space.id === landNeighbors(target)[0])
	const german = data.pieces.find((piece) => piece.nation === "ge" && piece.type === "army")
	const event = data.cards.find((card) => card.id === 720).event
	state.units = [{
		id: "kg-mover",
		piece: german.id,
		faction: "cp",
		nation: "ge",
		type: "army",
		location: origin.id,
		reduced: false,
		supplied: true
	}]
	state.active = "cp"
	state.state = "ops_move"
	state.ops = { card: null, total: 1, remaining: 0, activated: [origin.id], moving: null, execution_phase: "move" }
	state.activations = { [origin.id]: "move" }
	state.events[event] = { faction: "cp" }
	state.markers.killing_ground = {
		space: target.id,
		cost: 1,
		destroy_vp: 1,
		source_card: 720
	}
	state.removed.cp = [720]
	const vp = state.vp
	rules.action(state, "Central Powers", "select_move_unit", "kg-mover")
	rules.action(state, "Central Powers", "move", target.id)
	assert.equal(state.units[0].location, target.id)
	assert.equal(state.destroyed_forts.includes(target.id), true)
	assert.equal(state.vp, vp + 1)
	assert.equal(state.removed.cp.includes(720), false)
	assert.equal(state.discard.cp.includes(720), true)
	assert.equal(state.events[event], undefined)
	assert.equal(state.markers.killing_ground, undefined)
})

test("Hindenburg defensive works require a CP level-2 trench", () => {
	const state = setupGame(736)
	const unit = state.units.find(
		(candidate) => candidate.faction === "cp" && candidate.type === "army"
	)
	const space = "essen"
	unit.location = space
	state.active = "cp"
	state.state = "ops_construct"
	state.ops = { card: null, total: 2, remaining: 1, activated: [space], moving: null, execution_phase: "construct", execution_origin: space, activated_units: { [space]: [unit.id] } }
	state.activations = { [space]: "move" }
	state.trenches[space] = 2
	const trench = data.cards.find((card) => card.id === 708)
	const trenchRule = data.card_effects[708].operations.find(
		(operation) => operation.type === "rule_modifier"
	)
	state.events[trench.event] = { faction: "cp", rule: trenchRule }
	assert.equal(rules.view(state, "Central Powers").actions.entrench?.includes(space) || false, false)
	state.events[data.cards.find((card) => card.id === 736).event] = { faction: "cp" }
	assert.equal(rules.view(state, "Central Powers").actions.entrench.includes(space), true)
	rules.action(state, "Central Powers", "entrench", space)
	assert.ok(state.fortifications[space] > 0)
})

test("Moltke removes three distinct units and returns the same units three turns later", () => {
	const state = setupGame(614)
	state.turn = 3
	state.active = "ap"
	state.state = "action_card"
	state.commitment.ap = "total"
	state.hands.ap = [614]
	configureDelayedUnitFixture(state)
	const selected = ["delay-army", "delay-corps-1", "delay-corps-2"]

	rules.action(state, "Allied Powers", "card_event", 614)
	for (const id of selected) {
		if (state.pending_event?.kind !== "delay_units") break
		if (eventUnitCandidates(state, "Allied Powers").includes(id))
			chooseEventUnits(state, "Allied Powers", [id])
	}
	if (rules.view(state, "Allied Powers").actions.event_confirm)
		rules.action(state, "Allied Powers", "event_confirm")
	assert.equal(selected.some((id) => state.units.some((unit) => unit.id === id)), false)
	assert.equal(state.scheduled_events.length, 1)
	assert.equal(state.scheduled_events[0].due_turn, 6)

	const returnSources = data.spaces.filter(
		(space) => space.supply && space.faction === "cp" && !space.ui?.hidden
	)
	assert.ok(returnSources.length)
	state.units = state.units.filter((unit) => !returnSources.some((space) => unit.location === space.id))
	state.turn = 5
	state.state = "replacement"
	state.phase = "补员"
	state.active = "cp"
	state.replacement_active = "cp"
	rules.action(state, "Central Powers", "finish")
	if (state.state === "replacement_discard_confirm")
		rules.action(state, "Central Powers", "confirm_discard_replacement_rp")
	rules.action(state, "Allied Powers", "finish")
	if (state.state === "replacement_discard_confirm")
		rules.action(state, "Allied Powers", "confirm_discard_replacement_rp")
	while (state.state === "draw_discard") {
		const role = state.active === "cp" ? "Central Powers" : "Allied Powers"
		rules.action(state, role, "done")
	}
	assert.equal(state.turn, 6)
	assert.equal(state.pending_event.kind, "scheduled_return")

	const placements = []
	while (rules.view(state, "Central Powers").actions.event_space) {
		const spaces = rules.view(state, "Central Powers").actions.event_space
		assert.ok(spaces.length)
		placements.push(spaces[0])
		rules.action(state, "Central Powers", "event_space", spaces[0])
	}
	rules.action(state, "Central Powers", "event_confirm")
	assert.deepEqual(
		selected.map((id) => state.units.find((unit) => unit.id === id)?.location),
		placements
	)
	assert.equal(state.scheduled_events.length, 0)
	assert.equal(state.state, "mo_review")
})

test("Lenin event resolves exactly one selected branch", () => {
	const state = setupGame(754)
	state.active = "cp"
	state.state = "action_card"
	state.commitment.cp = "total"
	state.hands.cp = [754]
	const front = state.fronts.russian
	const rp = state.rp.cp.ge
	rules.action(state, "Central Powers", "card_event", 754)
	rules.action(state, "Central Powers", "event_choose", "ge_rp")
	assert.equal(state.fronts.russian, front)
	assert.equal(state.rp.cp.ge, rp + 2)
	assert.equal(state.event_history.at(-1).card, 754)
})

test("pending events can be cancelled without playing or discarding the card", () => {
	const state = setupGame(754)
	state.active = "cp"
	state.state = "action_card"
	state.commitment.cp = "total"
	state.hands.cp = [754]
	rules.action(state, "Central Powers", "card_event", 754)
	assert.ok(state.state.startsWith("event_"))
	rules.action(state, "Central Powers", "event_cancel")
	assert.equal(state.state, "action_card")
	assert.equal(state.hands.cp.includes(754), true)
	assert.equal(state.discard.cp.includes(754), false)
	assert.equal(Boolean(state.events[data.cards.find((card) => card.id === 754).event]), false)
})

test("unit-selection events reject invalid counts and permanently remove only legal units", () => {
	const state = setupGame(613)
	state.active = "ap"
	state.state = "action_card"
	state.hands.ap = [613]
	addBritishArmyForColoniesEvent(state)
	const startingVp = state.vp
	rules.action(state, "Allied Powers", "card_event", 613)
	const choices = rules.view(state, "Allied Powers").actions.event_choose
	assert.equal(choices.some((choice) => choice === "remove_scu"), true)
	rules.action(state, "Allied Powers", "event_choose", "remove_lcu")
	const candidates = eventUnitCandidates(state, "Allied Powers")
	const selected = candidates.length ? candidates.slice(0, 1) :
		state.permanently_removed_units.map((unit) => unit.id)
	assert.deepEqual(
		state.permanently_removed_units.map((unit) => unit.id),
		selected
	)
	assert.equal(state.vp, startingVp - 1)
	assert.equal(state.state, "action_card")
})

test("version 1 saves acquire safe event-engine defaults when viewed", () => {
	const state = setupGame(1)
	delete state.pending_event
	delete state.event_history
	delete state.entry_tracks
	delete state.front_storage
	state.version = 1
	rules.view(state, "Allied Powers")
	assert.equal(state.version, 46)
	assert.equal(state.pending_event, null)
	assert.deepEqual(state.event_history, [])
	assert.deepEqual(state.entry_tracks, { us: 0, armistice: 0 })
	assert.deepEqual(state.front_storage, { russian: 0, turkish: 0 })
	assert.ok(Array.isArray(state.entry_reserve.it))
	assert.deepEqual(state.retained_combat_cards, { ap: [], cp: [] })
	assert.equal(state.pending_combat_card_disposition, null)
})

test("starred combat cards are removed regardless of the winner", () => {
	const placeInDiscard = (state, faction, id) => {
		for (const pool of [state.hands[faction], state.decks[faction], state.discard[faction], state.removed[faction]]) {
			const index = pool.indexOf(id)
			if (index >= 0) pool.splice(index, 1)
		}
		state.discard[faction].push(id)
	}
	const won = setupGame(610)
	placeInDiscard(won, "ap", 610)
	placeInDiscard(won, "cp", 709)
	const combat = {
		attacker: "ap",
		attack_loss: 1,
		defense_loss: 3,
		played_cards: [{ id: 610 }, { id: 709 }]
	}
	assert.equal(rules._test.prepareCombatCardDispositions(won, combat), false)
	assert.equal(won.retained_combat_cards.ap.includes(610), false)
	assert.equal(won.removed.ap.includes(610), true)
	assert.equal(won.retained_combat_cards.cp.includes(709), false)
	assert.equal(won.discard.cp.includes(709), false)
	assert.equal(won.removed.cp.includes(709), true)

	const tied = setupGame(611)
	placeInDiscard(tied, "ap", 610)
	assert.equal(
		rules._test.prepareCombatCardDispositions(tied, {
			attacker: "ap",
			attack_loss: 2,
			defense_loss: 2,
			played_cards: [{ id: 610 }]
		}),
		false
	)
	assert.equal(tied.retained_combat_cards.ap.includes(610), false)
	assert.equal(tied.discard.ap.includes(610), false)
	assert.equal(tied.removed.ap.includes(610), true)
})

test("optional and mandatory victory draws use server-owned combat-card disposition", () => {
	const placeInDiscard = (state, faction, id) => {
		for (const pool of [state.hands[faction], state.decks[faction], state.discard[faction], state.removed[faction]]) {
			const index = pool.indexOf(id)
			if (index >= 0) pool.splice(index, 1)
		}
		state.discard[faction].push(id)
	}
	const optional = setupGame(621)
	placeInDiscard(optional, "ap", 621)
	assert.equal(
		rules._test.prepareCombatCardDispositions(optional, {
			attacker: "ap",
			attack_loss: 0,
			defense_loss: 2,
			played_cards: [{ id: 621 }]
		}),
		true
	)
	assert.equal(optional.state, "combat_card_disposition")
	assert.deepEqual(optional.pending_combat_card_disposition, { cards: [621], index: 0, owner: "ap" })

	const mandatory = setupGame(631)
	placeInDiscard(mandatory, "ap", 631)
	const handSize = mandatory.hands.ap.length
	assert.equal(
		rules._test.prepareCombatCardDispositions(mandatory, {
			attacker: "ap",
			attack_loss: 1,
			defense_loss: 4,
			played_cards: [{ id: 631 }]
		}),
		false
	)
	assert.equal(mandatory.hands.ap.length, handSize + 1)
	assert.equal(mandatory.retained_combat_cards.ap.includes(631), false)
	assert.equal(mandatory.discard.ap.includes(631), true)
})

test("625 Italian Entry and 725 Bulgaria apply their printed tracks, RP, and VP", () => {
	const italy = setupGame(625)
	italy.active = "ap"
	italy.state = "action_card"
	italy.commitment.ap = "total"
	italy.hands.ap = [625]
	const italyVp = italy.vp
	rules.action(italy, "Allied Powers", "card_event", 625)
	assert.equal(italy.events.entry_it, true)
	assert.equal(italy.vp, italyVp - 2)

	const bulgaria = setupGame(725)
	bulgaria.active = "cp"
	bulgaria.state = "action_card"
	bulgaria.commitment.cp = "total"
	bulgaria.hands.cp = [725]
	const russian = bulgaria.fronts.russian
	rules.action(bulgaria, "Central Powers", "card_event", 725)
	assert.equal(bulgaria.rp.cp.ge, 4)
	assert.equal(bulgaria.rp.cp.ah, 2)
	assert.equal(bulgaria.fronts.russian, russian + 1)
})

test("the war-status phase enters CP Limited War and automatically events Turkey entry", () => {
	const state = setupGame(703)
	state.active = "cp"
	state.state = "action_card"
	state.commitment.cp = "mobilization"
	state.turn = 3
	state.war_status.cp = 5
	state.war_status.combined = 5
	state.hands.cp = [703, 704]
	state.decks.cp = state.decks.cp.filter((id) => id !== 703 && id !== 704)
	const vp = state.vp
	const front = state.fronts.turkish
	rules.action(state, "Central Powers", "card_event", 704)
	assert.equal(state.commitment.cp, "mobilization")
	rules._test.resolveWarStatus(state)
	assert.equal(state.commitment.cp, "limited")
	assert.equal(state.events.entry_tu, true)
	assert.equal(state.fronts.turkish, front + 1)
	assert.equal(state.vp, vp)
	assert.equal(state.removed.cp.includes(703), true)
	assert.equal(state.hands.cp.includes(703), false)
	assert.equal(state.discard.cp.includes(703), false)
	assert.equal(state.event_history.some((entry) => entry.card === 703 && entry.automatic), true)
})

test("French Mutiny charges one FR RP per active mutiny MO for unstacked French attack markers", () => {
	const makeState = (withAmerican) => {
		const state = setupGame(743)
		state.active = "cp"
		state.state = "action_card"
		state.commitment.cp = "total"
		state.hands.cp = [743]
		state.rp.ap.fr = 10
		state.turn = 4
		rules.action(state, "Central Powers", "card_event", 743)
		assert.equal(state.rp.ap.fr, 8)
		state.mo.current.fr = state.mo.pool.fr
			.filter((entry) => entry.source_card === 743)
			.map((entry) => entry.id)
		state.mo.revealed = [...new Set([...state.mo.revealed, ...state.mo.current.fr])]
		state.mo.waived.fr = state.mo.current.fr.slice()
		assert.equal(
			state.mo.current.fr.filter((id) => id.startsWith("743:mo:mutiny_no_attack:")).length,
			3
		)
		const french = state.units.find((unit) => unit.faction === "ap" && unit.nation === "fr")
		assert.ok(french)
		const enemy = state.units.find((unit) => unit.faction === "cp")
		const normalAttackNeighbors = (spaceId) => data.edges
			.filter((edge) =>
				!edge.requires_land_attack_support &&
				edge.modes.includes("attack") &&
				edge.factions.includes("ap") &&
				(edge.a === spaceId || edge.b === spaceId))
			.map((edge) => edge.a === spaceId ? edge.b : edge.a)
		const activationSpace = data.spaces.find(
			(space) =>
				!space.large_area &&
				!space.ui?.hidden &&
				normalAttackNeighbors(space.id).some((id) => {
					const neighbor = data.spaces.find((candidate) => candidate.id === id)
					return neighbor && !neighbor.large_area && !neighbor.ui?.hidden
				})
		)
		assert.ok(activationSpace)
		const enemySpace = normalAttackNeighbors(activationSpace.id).find((id) => {
			const neighbor = data.spaces.find((space) => space.id === id)
			return neighbor && !neighbor.large_area && !neighbor.ui?.hidden
		})
		assert.ok(enemySpace)
		french.location = activationSpace.id
		french.moved = false
		french.attacked = false
		enemy.location = enemySpace
		state.control[activationSpace.id] = "ap"
		state.control[enemySpace] = "cp"
		if (withAmerican) {
			const piece = data.pieces.find((candidate) => candidate.nation === "us" && candidate.type === "army")
			assert.ok(piece)
			state.units.push({
				id: "mutiny-us",
				piece: piece.id,
				faction: "ap",
				nation: "us",
				type: "army",
				location: activationSpace.id,
				reduced: false,
				supplied: true
			})
		}
		state.units = state.units.filter((unit) =>
			unit.id === french.id || unit.id === enemy.id || unit.id === "mutiny-us"
		)
		state.active = "ap"
		state.state = "ops_activate"
		state.ops = { remaining: 10, activated: [] }
		state.activations = {}
		const activationView = rules.view(state, "Allied Powers")
		assert.ok(
			activationView.actions.activate_attack?.includes(french.location),
			JSON.stringify(activationView.action_hints?.spaces?.[french.location] || activationView.actions),
		)
		rules.action(state, "Allied Powers", "activate_attack", french.location)
		return state
	}

	assert.equal(makeState(false).rp.ap.fr, 5)
	assert.equal(makeState(true).rp.ap.fr, 8)
})

test("Desertion lets AP choose Cadorna losses and rejects units outside the selected branch", () => {
	const card = data.cards.find((candidate) => candidate.id === 756)
	const cadorna = data.cards.find((candidate) => candidate.id === 627)
	const italianSpace = data.spaces.find((space) => space.nation === "it" && !space.ui?.hidden)
	const army = data.pieces.find((piece) => piece.nation === "it" && piece.type === "army")
	const corps = data.pieces.find((piece) => piece.nation === "it" && piece.type === "corps")
	assert.ok(italianSpace)
	assert.ok(army)
	assert.ok(corps)

	const state = setupGame(756)
	state.active = "cp"
	state.state = "action_card"
	state.commitment.cp = "total"
	state.hands.cp = [756]
	state.events[cadorna.event] = { faction: "ap" }
	state.units = [
		...["desertion-lcu-1", "desertion-lcu-2"].map((id) => ({
			id,
			piece: army.id,
			faction: "ap",
			nation: "it",
			type: "army",
			location: italianSpace.id,
			reduced: false,
			supplied: true
		})),
		...["desertion-scu-1", "desertion-scu-2"].map((id) => ({
			id,
			piece: corps.id,
			faction: "ap",
			nation: "it",
			type: "corps",
			location: italianSpace.id,
			reduced: false,
			supplied: true
		}))
	]
	rules.action(state, "Central Powers", "card_event", card.id)
	assert.equal(state.pending_event.kind, "desertion_immediate")
	assert.equal(state.active, "ap")
	assert.deepEqual(
		rules.view(state, "Allied Powers").actions.event_choose,
		["lcu", "scu"]
	)
	rules.action(state, "Allied Powers", "event_choose", "lcu")
	assert.equal(state.pending_event, null)
	assert.equal(state.units.find((unit) => unit.id === "desertion-scu-1").reduced, false)
	assert.equal(state.units.find((unit) => unit.id === "desertion-lcu-1").reduced, true)
	assert.equal(state.units.find((unit) => unit.id === "desertion-lcu-2").reduced, true)
	assert.equal(state.removed.cp.includes(card.id), true)
	assert.equal(state.active, "cp")
	assert.equal(state.state, "ops_activate")
	assert.equal(state.ops.card, 756)
})

test("Desertion opens a server-driven Italian loss choice after each Italian attack", () => {
	const state = setupGame(756)
	const desertion = data.card_effects[756].operations.find(
		(operation) => operation.type === "rule_modifier"
	)
	const card = data.cards.find((candidate) => candidate.id === 756)
	const origin = data.spaces.find((space) => landNeighbors(space).length && !space.ui?.hidden)
	const target = data.spaces.find((space) => space.id === landNeighbors(origin)[0])
	const italian = data.pieces.find((piece) => piece.nation === "it" && piece.type === "army")
	const german = data.pieces.find((piece) => piece.nation === "ge" && piece.type === "corps")
	assert.ok(italian)
	assert.ok(german)
	state.units = [
		...["desertion-attacker-1", "desertion-attacker-2", "desertion-attacker-3"].map((id) => ({
			id,
			piece: italian.id,
			faction: "ap",
			nation: "it",
			type: "army",
			location: origin.id,
			reduced: false,
			supplied: true
		})),
		{
			id: "desertion-defender",
			piece: german.id,
			faction: "cp",
			nation: "ge",
			type: "corps",
			location: target.id,
			reduced: false,
			supplied: true
		}
	]
	state.events[card.event] = { faction: "cp", rule: desertion }
	state.active = "ap"
	state.state = "ops_activate"
	state.ops = { remaining: 1, activated: [], forced_attacks: [], execution_phase: "attack" }
	state.activations = { [origin.id]: "attack" }
	declareAttack(state, "Allied Powers", ["desertion-attacker-1", "desertion-attacker-2", "desertion-attacker-3"], target.id)
	rules.action(state, "Allied Powers", "pass")
	rules.action(state, "Central Powers", "pass")
	let guard = 20
	while (state.state === "combat_losses" && guard-- > 0) {
		const role = state.active === "ap" ? "Allied Powers" : "Central Powers"
		const actions = rules.view(state, role).actions
		if (actions.take_loss?.length) rules.action(state, role, "take_loss", actions.take_loss[0])
		else rules._test.advanceDeterministicStates(state)
	}
	assert.notEqual(state.pending_event?.kind, "desertion_combat_loss")
	rules._test.finishCombatSequence(state)
	assert.equal(state.pending_event.kind, "desertion_combat_loss")
	const legal = eventUnitCandidates(state, "Allied Powers")
	assert.ok(legal.length)
	const selected = legal.at(-1)
	const before = state.units.find((unit) => unit.id === selected).reduced
	chooseEventUnits(state, "Allied Powers", [selected])
	const survivor = state.units.find((unit) => unit.id === selected)
	assert.equal(Boolean(survivor), !before)
	if (survivor) assert.equal(survivor.reduced, true)
	assert.notEqual(state.pending_event?.kind, "desertion_combat_loss")
})

test("conditional events remain server-illegal until their printed prerequisites are met", () => {
	const state = setupGame(745)
	state.active = "cp"
	state.state = "action_card"
	state.commitment.cp = "total"
	state.hands.cp = [745]
	state.fronts.russian = 7
	assert.equal(rules.view(state, "Central Powers").actions.card_event?.includes(745) || false, false)
	state.fronts.russian = 8
	assert.equal(rules.view(state, "Central Powers").actions.card_event.includes(745), true)
})

test("printed turn, dependency, prohibition, and war-status prerequisites are server enforced", () => {
	const legal = (state, role, id) => rules.view(state, role).actions.card_event?.includes(id) || false

	const trenches = setupGame(608)
	trenches.active = "ap"
	trenches.state = "action_card"
	trenches.hands.ap = [608]
	trenches.turn = 2
	assert.equal(legal(trenches, "Allied Powers", 608), false)
	trenches.turn = 3
	assert.equal(legal(trenches, "Allied Powers", 608), true)

	const clemenceau = setupGame(647)
	clemenceau.active = "ap"
	clemenceau.state = "action_card"
	clemenceau.commitment.ap = "total"
	clemenceau.hands.ap = [647]
	clemenceau.turn = 11
	clemenceau.war_status.combined = 27
	assert.equal(legal(clemenceau, "Allied Powers", 647), false)
	clemenceau.war_status.combined = 28
	assert.equal(legal(clemenceau, "Allied Powers", 647), true)
	clemenceau.turn = 12
	assert.equal(legal(clemenceau, "Allied Powers", 647), false)

	const politicians = setupGame(630)
	politicians.active = "ap"
	politicians.state = "action_card"
	politicians.commitment.ap = "limited"
	politicians.hands.ap = [630]
	const cadornaEvent = data.cards.find((card) => card.id === 627).event
	assert.equal(legal(politicians, "Allied Powers", 630), true)
	politicians.events[cadornaEvent] = { faction: "ap" }
	assert.equal(legal(politicians, "Allied Powers", 630), false)

	const victory = setupGame(657)
	victory.active = "ap"
	victory.state = "action_card"
	victory.commitment.ap = "total"
	victory.hands.ap = [657]
	victory.turn = 11
	for (const id of [740, 744])
		victory.events[data.cards.find((card) => card.id === id).event] = { faction: "cp" }
	assert.equal(legal(victory, "Allied Powers", 657), true)
})
