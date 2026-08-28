"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")

const rules = require("../rules.js")
const { setupGame } = require("./setup_game.js")
const data = require("../data.js")

const AP_ROLE = "Allied Powers"
const CP_ROLE = "Central Powers"
const protocolView = rules.protocolView || rules.view
const protocolAction = rules.protocolAction || rules.action

function installMo(state, nation, definitions) {
	state.mo.pool[nation] = definitions
	state.mo.current[nation] = definitions.map((entry) => entry.id)
	state.mo.completed[nation] = []
	state.mo.waived[nation] = []
	state.mo.penalized[nation] = []
	state.mo.progress[nation] = Object.fromEntries(definitions.map((entry) => [entry.id, 0]))
	state.mo.drm_used[nation] = Object.fromEntries(definitions.map((entry) => [entry.id, 0]))
}

test("MO draws are without replacement and initialize per-token progress", () => {
	for (let seed = 1; seed <= 25; seed++) {
		const state = setupGame(seed)
		for (const [nation, ids] of Object.entries(state.mo.current)) {
			assert.equal(new Set(ids).size, ids.length, `${nation} duplicated for seed ${seed}`)
			assert.deepEqual(Object.keys(state.mo.progress[nation]).sort(), ids.slice().sort())
		}
	}
})

test("a two-attack MO completes only after two separate attack records", () => {
	const state = setupGame(201)
	installMo(state, "fr", [{ id: "test-fr-two", nation: "fr", attacks: 2 }])
	state.units = [{ id: "fr-a", faction: "ap", nation: "fr", type: "army", location: "saint_mihiel" }]
	state.activations = { saint_mihiel: "attack" }
	rules._test.markMoForAttack(state, "fr", null, { attackers: ["fr-a"], target: "metz" })
	assert.equal(state.mo.progress.fr["test-fr-two"], 1)
	assert.deepEqual(state.mo.completed.fr, [])
	rules._test.markMoForAttack(state, "fr", null, { attackers: ["fr-a"], target: "verdun" })
	assert.equal(state.mo.progress.fr["test-fr-two"], 2)
	assert.deepEqual(state.mo.completed.fr, ["test-fr-two"])
})

test("conditional MO requirements award their structured RP only on completion", () => {
	const state = setupGame(202)
	installMo(state, "us", [
		{
			id: "test-us-win",
			nation: "us",
			attacks: 1,
			requirement: "attack_win",
			reward_rp: 1
		}
	])
	assert.equal(state.rp.ap.us, 0)
	rules._test.markMoForAttack(state, "us")
	assert.deepEqual(state.mo.completed.us, [])
	rules._test.markMoRequirement(state, "us", "attack_win")
	assert.deepEqual(state.mo.completed.us, ["test-us-win"])
	assert.equal(state.rp.ap.us, 1)
})

test("a national completion limit queues only the required number of unfinished MO", () => {
	const completed = setupGame(203)
	installMo(completed, "ge", [
		{ id: "test-ge-a", nation: "ge", attacks: 1 },
		{ id: "test-ge-b", nation: "ge", attacks: 1 }
	])
	completed.mo.completion_required.ge = 1
	completed.mo.completed.ge.push("test-ge-a")
	assert.deepEqual(
		rules._test.unfulfilledMoObligations(completed).filter((entry) => entry.nation === "ge"),
		[]
	)

	const missed = setupGame(204)
	installMo(missed, "ge", [
		{ id: "test-ge-a", nation: "ge", attacks: 1 },
		{ id: "test-ge-b", nation: "ge", attacks: 1 }
	])
	missed.mo.completion_required.ge = 1
	assert.deepEqual(
		rules._test.unfulfilledMoObligations(missed).filter((entry) => entry.nation === "ge"),
		[{ faction: "cp", nation: "ge", id: "test-ge-a" }]
	)
})

test("MO review is private and requires CP then AP confirmation", () => {
	const state = setupGame(205)
	const cp = protocolView(state, CP_ROLE)
	const ap = protocolView(state, AP_ROLE)
	const observer = protocolView(state, "Observer")
	assert.ok(cp.mo.own.every((entry) => ["ge", "ah"].includes(entry.nation)))
	assert.ok(ap.mo.own.every((entry) => ["fr", "br", "it", "us"].includes(entry.nation)))
	assert.deepEqual(observer.mo.own, [])
	assert.equal("current" in cp.mo, false)
	assert.equal("bag" in cp.mo, false)
	assert.equal(JSON.stringify(ap.mo).includes(state.mo.current.ge[0]), false)

	protocolAction(state, CP_ROLE, "confirm_mo")
	assert.equal(state.state, "mo_review")
	assert.equal(state.active, "ap")
	assert.deepEqual(state.mo.review.confirmed, ["cp"])
	protocolAction(state, AP_ROLE, "confirm_mo")
	assert.equal(state.state, "naval_choice")
	assert.deepEqual(state.mo.review.confirmed, ["cp", "ap"])
})

test("Italy draws MO only from the MO phase after entry", () => {
	const state = setupGame(206)
	state.turn = 2
	rules._test.drawMo(state)
	assert.equal(state.mo.current.it.length, 0)
	state.events.entry_it = true
	rules._test.drawMo(state)
	assert.equal(state.mo.current.it.length, 1)
})

test("each attacking nation explicitly chooses one eligible MO or none", () => {
	const state = setupGame(207)
	const attacker = state.units.find((unit) => unit.nation === "fr" && unit.type === "army")
	const defender = state.units.find((unit) => unit.nation === "ge" && unit.type === "army")
	attacker.location = "saint_mihiel"
	defender.location = "metz"
	state.units = [attacker, defender]
	state.active = "ap"
	state.version = 36
	state.state = "confirm_attack"
	state.ops = {
		pending_attack: {
			attackers: [attacker.id],
			target: "metz",
			flank: false,
			mo_assignments: {},
			mo_decisions: {}
		}
	}
	state.activations = { saint_mihiel: "attack" }
	installMo(state, "fr", [
		{ id: "test-fr-a", nation: "fr", name: "A", attacks: 1 },
		{ id: "test-fr-b", nation: "fr", name: "B", attacks: 1 }
	])
	let own = protocolView(state, AP_ROLE)
	assert.equal(state.version, 42)
	assert.equal(state.state, "attack_mo")
	assert.deepEqual(new Set(own.actions.select_attack_mo), new Set([
		"mo:fr:test-fr-a",
		"mo:fr:test-fr-b",
		"mo:fr:none"
	]))
	assert.equal(own.actions.confirm_attack, undefined)
	assert.match(own.prompt, /选择MO/)
	const opponentBefore = JSON.stringify(protocolView(state, CP_ROLE))
	assert.equal(opponentBefore.includes("test-fr-a"), false)
	protocolAction(state, AP_ROLE, "select_attack_mo", "mo:fr:test-fr-b")
	own = protocolView(state, AP_ROLE)
	assert.equal(own.actions.confirm_attack, undefined)
	assert.equal(state.combat_window.declaration.mo_assignments.fr, "test-fr-b")
	const opponentAfter = JSON.stringify(protocolView(state, CP_ROLE))
	assert.equal(opponentAfter.includes("test-fr-b"), false)
})

test("MO non-lethal penalty selects full units worth two RP and grants no RP", () => {
	const state = setupGame(208)
	const candidates = state.units.filter(
		(unit) => unit.nation === "fr" && ["army", "corps"].includes(unit.type) && !unit.reduced
	).slice(0, 2)
	assert.equal(candidates.length, 2)
	state.state = "event"
	state.active = "cp"
	state.pending_event = {
		kind: "mo_penalty",
		owner: "cp",
		chooser: "cp",
		penalized: "ap",
		nation: "fr",
		mo: "fr-6",
		stage: "loss",
		selected_units: [],
		loss_required: 2
	}
	const rp = state.rp.ap.fr
	for (const unit of candidates)
		protocolAction(state, CP_ROLE, "select_mo_penalty_unit", unit.id)
	assert.equal(protocolView(state, CP_ROLE).actions.confirm_mo_penalty_loss, 1)
	protocolAction(state, CP_ROLE, "confirm_mo_penalty_loss")
	assert.ok(candidates.every((unit) => unit.reduced))
	assert.equal(state.rp.ap.fr, rp)
})

test("all printed MO have generated art and dynamic MO have explicit names", () => {
	const printed = new Map(Object.values(data.mo).flat().map((mo) => [mo.id, mo]))
	for (const mo of printed.values()) assert.ok(mo.image, mo.id)
	for (const [card, spec] of Object.entries(data.card_effects))
		for (const operation of spec.operations.filter((entry) => entry.type === "mo_modify"))
			for (const addition of operation.add || []) {
				assert.ok(addition.name, `${card}:${addition.key}`)
				assert.ok(addition.template_id, `${card}:${addition.key}:template`)
				assert.ok(printed.has(addition.template_id), `${card}:${addition.key}:${addition.template_id}`)
			}
	const hindenburgLine = data.card_effects["736"].operations
		.find((entry) => entry.add_mo)?.add_mo
	assert.equal(hindenburgLine.template_id, "ge-7")
	const doctrine = data.card_effects["705"].operations
		.find((entry) => entry.type === "mo_modify").add[0]
	assert.equal(doctrine.attacks, 1)
})

test("a combined attack counts each independently qualifying national origin", () => {
	const state = setupGame(209)
	installMo(state, "fr", [
		{ id: "test-fr-markers", kind: "task", nation: "fr", attacks: 2 }
	])
	state.units = [
		{ id: "fr-a", faction: "ap", nation: "fr", type: "army", location: "ardennes" },
		{ id: "fr-b", faction: "ap", nation: "fr", type: "army", location: "saint_mihiel" }
	]
	state.activations = { ardennes: "attack", saint_mihiel: "attack" }
	const declaration = { attackers: ["fr-a", "fr-b"], target: "metz" }
	assert.deepEqual(rules._test.computeMoMarkerOrigins(state, declaration), {
		fr: ["ardennes", "saint_mihiel"]
	})
	rules._test.markMoForAttack(state, "fr", "test-fr-markers", declaration)
	assert.equal(state.mo.progress.fr["test-fr-markers"], 2)
	assert.deepEqual(state.mo.completed.fr, ["test-fr-markers"])
})

test("an origin with fewer than three corps does not count as an MO attack marker", () => {
	const state = setupGame(210)
	installMo(state, "fr", [
		{ id: "test-fr-markers", kind: "task", nation: "fr", attacks: 2 }
	])
	state.units = [
		{ id: "fr-a", faction: "ap", nation: "fr", type: "army", location: "ardennes" },
		{ id: "fr-c1", faction: "ap", nation: "fr", type: "corps", location: "saint_mihiel" },
		{ id: "fr-c2", faction: "ap", nation: "fr", type: "corps", location: "saint_mihiel" }
	]
	state.activations = { ardennes: "attack", saint_mihiel: "attack" }
	const declaration = { attackers: state.units.map((unit) => unit.id), target: "metz" }
	rules._test.markMoForAttack(state, "fr", "test-fr-markers", declaration)
	assert.equal(state.mo.progress.fr["test-fr-markers"], 1)
	assert.deepEqual(state.mo.completed.fr, [])
})

test("a distinct-target MO counts a combined attack on one target only once", () => {
	const state = setupGame(211)
	installMo(state, "ge", [
		{ id: "test-ge-distinct", kind: "task", nation: "ge", attacks: 2, distinct_targets: true }
	])
	state.units = [
		{ id: "ge-a", faction: "cp", nation: "ge", type: "army", location: "metz" },
		{ id: "ge-b", faction: "cp", nation: "ge", type: "army", location: "luxembourg" }
	]
	state.activations = { metz: "attack", luxembourg: "attack" }
	const declaration = { attackers: ["ge-a", "ge-b"], target: "ardennes" }
	rules._test.markMoForAttack(state, "ge", "test-ge-distinct", declaration)
	assert.equal(state.mo.progress.ge["test-ge-distinct"], 1)
	rules._test.markMoForAttack(state, "ge", "test-ge-distinct", declaration)
	assert.equal(state.mo.progress.ge["test-ge-distinct"], 1)
})

test("two nations assigned matching destroy-LCU MOs both complete in one combined attack", () => {
	const state = setupGame(214)
	installMo(state, "fr", [{
		id: "test-fr-destroy-ge",
		kind: "task",
		nation: "fr",
		attacks: 1,
		requirement: "destroy_enemy_army",
		target: "ge"
	}])
	installMo(state, "br", [{
		id: "test-br-destroy-ge",
		kind: "task",
		nation: "br",
		attacks: 1,
		requirement: "destroy_enemy_army",
		target: "ge"
	}])
	state.units = [
		{ id: "fr-attacker", faction: "ap", nation: "fr", type: "army", location: "verdun" },
		{ id: "br-attacker", faction: "ap", nation: "br", type: "army", location: "luxembourg" },
		{ id: "ge-defender", faction: "cp", nation: "ge", type: "army", location: "metz" }
	]
	state.combat = {
		attacker: "ap",
		attackers: ["fr-attacker", "br-attacker"],
		mo_assignments: {
			fr: "test-fr-destroy-ge",
			br: "test-br-destroy-ge"
		},
		mo_marker_origins: { fr: ["verdun"], br: ["luxembourg"] },
		participant_units: state.units.map((unit) => ({ ...unit })),
		origins: {
			"fr-attacker": "verdun",
			"br-attacker": "luxembourg",
			"ge-defender": "metz"
		}
	}

	rules._test.eliminateUnit(state, "ge-defender", "测试伤亡")

	assert.deepEqual(state.mo.completed.fr, ["test-fr-destroy-ge"])
	assert.deepEqual(state.mo.completed.br, ["test-br-destroy-ge"])
})

test("destroy-LCU MO requires that nation's real attack-marker origin", () => {
	const state = setupGame(215)
	installMo(state, "fr", [{
		id: "test-fr-no-marker",
		kind: "task",
		nation: "fr",
		attacks: 1,
		requirement: "destroy_enemy_army",
		target: "ge"
	}])
	installMo(state, "br", [{
		id: "test-br-real-marker",
		kind: "task",
		nation: "br",
		attacks: 1,
		requirement: "destroy_enemy_army",
		target: "ge"
	}])
	state.units = [
		{ id: "fr-move-attacker", faction: "ap", nation: "fr", type: "army", location: "verdun" },
		{ id: "br-attacker", faction: "ap", nation: "br", type: "army", location: "luxembourg" },
		{ id: "ge-defender", faction: "cp", nation: "ge", type: "army", location: "metz" }
	]
	state.combat = {
		attacker: "ap",
		attackers: ["fr-move-attacker", "br-attacker"],
		mo_assignments: {
			fr: "test-fr-no-marker",
			br: "test-br-real-marker"
		},
		mo_marker_origins: { br: ["luxembourg"] },
		participant_units: state.units.map((unit) => ({ ...unit })),
		origins: {
			"fr-move-attacker": "verdun",
			"br-attacker": "luxembourg",
			"ge-defender": "metz"
		}
	}

	rules._test.eliminateUnit(state, "ge-defender", "测试伤亡")

	assert.deepEqual(state.mo.completed.fr, [])
	assert.deepEqual(state.mo.completed.br, ["test-br-real-marker"])
})

test("the defender privately selects at most one result MO before combat cards", () => {
	const state = setupGame(212)
	installMo(state, "ge", [
		{ id: "test-ge-defense", kind: "task", nation: "ge", attacks: 0, requirement: "defense_win" },
		{ id: "test-ge-combat", kind: "task", nation: "ge", attacks: 0, requirement: "combat_win" }
	])
	state.units = [
		{ id: "fr-a", piece: "component-014", faction: "ap", nation: "fr", type: "army", location: "saint_mihiel", supplied: true },
		{ id: "ge-a", piece: "component-043", faction: "cp", nation: "ge", type: "army", location: "metz", supplied: true }
	]
	state.active = "ap"
	state.ops = { remaining: 0, activated: ["saint_mihiel"], forced_attacks: [] }
	state.activations = { saint_mihiel: "attack" }
	rules._test.beginCombat(state, {
		attackers: ["fr-a"],
		target: "metz",
		flank: false,
		mo_assignments: {},
		mo_marker_origins: { fr: ["saint_mihiel"] }
	})
	assert.equal(state.state, "defense_mo")
	const defender = protocolView(state, CP_ROLE)
	assert.deepEqual(new Set(defender.actions.select_defense_mo), new Set([
		"mo:ge:test-ge-defense",
		"mo:ge:test-ge-combat",
		"mo:ge:none"
	]))
	assert.equal(JSON.stringify(protocolView(state, AP_ROLE)).includes("test-ge-defense"), false)
	protocolAction(state, CP_ROLE, "select_defense_mo", "mo:ge:test-ge-defense")
	assert.equal(state.state, "combat_card_window")
	assert.equal(state.combat_window.declaration.defense_mo_assignments.ge, "test-ge-defense")
	assert.equal(JSON.stringify(protocolView(state, AP_ROLE)).includes("test-ge-defense"), false)
})

test("dynamic positive DRM MO data are explicit and correctly signed", () => {
	for (const card of [615, 616, 618, 619]) {
		const addition = data.card_effects[String(card)].operations
			.find((entry) => entry.type === "mo_modify").add[0]
		assert.equal(addition.kind, "task")
		assert.equal(addition.attack_drm_uses, 1)
		assert.equal(addition.attack_drm, 1)
		assert.match(addition.name, /\+1 DRM/)
	}
	const hindenburg = data.card_effects["737"].operations
		.find((entry) => entry.type === "mo_modify").add[0]
	assert.equal(hindenburg.kind, "passive")
	assert.equal(hindenburg.drm, 1)
})

test("owners review none, passive, and prohibition counters before they become public effects", () => {
	const review = setupGame(213)
	const noneId = "test-ah-none"
	const passiveId = "test-ge-passive"
	for (const nation of Object.keys(review.mo.current)) review.mo.current[nation] = []
	review.mo.pool.ah = [{ id: noneId, nation: "ah", kind: "none", name: "无强制进攻" }]
	review.mo.pool.ge = [{
		id: passiveId,
		nation: "ge",
		kind: "passive",
		name: "德国进攻 +1 DRM",
		passive: "national_attack_drm",
		drm: 1
	}]
	review.mo.current.ah = [noneId]
	review.mo.current.ge = [passiveId]
	review.mo.completed.ah = []
	review.mo.completed.ge = []
	review.mo.waived.ah = []
	review.mo.waived.ge = []
	review.state = "mo_review"
	review.active = "cp"
	let cpReview = protocolView(review, CP_ROLE)
	assert.ok(cpReview.mo.own.some((entry) => entry.id === noneId && entry.kind === "none"))
	assert.ok(cpReview.mo.own.some((entry) => entry.id === passiveId && entry.kind === "passive"))
	assert.equal(protocolView(review, AP_ROLE).mo.active_effects.length, 0)
	protocolAction(review, CP_ROLE, "confirm_mo")
	assert.ok(review.mo.history.some((entry) => entry.id === noneId && entry.outcome === "none"))
	assert.ok(review.mo.history.some((entry) => entry.id === passiveId && entry.outcome === "passive"))
	assert.deepEqual(protocolView(review, CP_ROLE).mo.own, [])
	assert.ok(protocolView(review, AP_ROLE).mo.active_effects.some((entry) => entry.id === passiveId))

	const mutiny = setupGame(214)
	const id = "743:mo:mutiny_no_attack:1"
	mutiny.mo.pool.fr = [{ id, nation: "fr", kind: "prohibition", name: "法军兵变", prohibition: "attack" }]
	mutiny.mo.current.fr = [id]
	mutiny.mo.waived.fr = []
	mutiny.mo.penalized.fr = []
	mutiny.mo.revealed = []
	mutiny.mo.review.confirmed = ["cp"]
	mutiny.state = "mo_review"
	mutiny.active = "ap"
	assert.equal(protocolView(mutiny, AP_ROLE).mo.own.some((entry) => entry.id === id), true)
	assert.equal(protocolView(mutiny, CP_ROLE).mo.opponent_counts.fr, 0)
	assert.equal(protocolView(mutiny, CP_ROLE).mo.active_effects.some((entry) => entry.id === id), false)
	protocolAction(mutiny, AP_ROLE, "confirm_mo")
	assert.equal(protocolView(mutiny, AP_ROLE).mo.own.some((entry) => entry.id === id), false)
	assert.ok(protocolView(mutiny, CP_ROLE).mo.active_effects.some((entry) => entry.id === id))
	assert.ok(mutiny.mo.history.some((entry) => entry.id === id && entry.outcome === "prohibition"))
})

test("unrebuildable BEF units remain legal non-lethal MO penalty choices", () => {
	const state = setupGame(215)
	state.units = []
	state.reserves.ap = [
		{ id: "bef-army", piece: "component-097", faction: "ap", nation: "br", type: "army", reduced: false },
		{ id: "bef-corps", piece: "component-098", faction: "ap", nation: "br", type: "corps", reduced: false }
	]
	assert.deepEqual(
		new Set(rules._test.moPenaltyLossCandidates(state, "ap", "br")),
		new Set(["bef-army", "bef-corps"])
	)
	assert.equal(rules._test.moPenaltyLossValue(state, "bef-army"), 1)
})

test("an unfulfilled MO never downgrades two forced markers to one", () => {
	const state = setupGame(216)
	for (const nation of Object.keys(state.mo.current)) state.mo.current[nation] = []
	installMo(state, "fr", [{ id: "test-fr-missed", kind: "task", nation: "fr", attacks: 1 }])
	state.units = [
		{ id: "fr-a", piece: "component-014", faction: "ap", nation: "fr", type: "army", location: "saint_mihiel", reduced: false, supplied: true },
		{ id: "ge-a", piece: "component-043", faction: "cp", nation: "ge", type: "army", location: "metz", reduced: false, supplied: true }
	]
	assert.equal(rules._test.beginMoPenaltyResolution(state), true)
	assert.equal(state.pending_event.required, 0)
	assert.equal((protocolView(state, CP_ROLE).actions.event_choose || []).includes("attack"), false)
})

test("two legal forced-attack origins require exactly two separate markers", () => {
	const state = setupGame(217)
	for (const nation of Object.keys(state.mo.current)) state.mo.current[nation] = []
	installMo(state, "fr", [{ id: "test-fr-missed", kind: "task", nation: "fr", attacks: 1 }])
	state.units = [
		{ id: "fr-a", piece: "component-014", faction: "ap", nation: "fr", type: "army", location: "ardennes", reduced: false, supplied: true },
		{ id: "fr-b", piece: "component-014", faction: "ap", nation: "fr", type: "army", location: "saint_mihiel", reduced: false, supplied: true },
		{ id: "ge-a", piece: "component-043", faction: "cp", nation: "ge", type: "army", location: "metz", reduced: false, supplied: true },
		{ id: "ge-b", piece: "component-043", faction: "cp", nation: "ge", type: "army", location: "luxembourg", reduced: false, supplied: true }
	]
	assert.equal(rules._test.beginMoPenaltyResolution(state), true)
	assert.equal(state.pending_event.required, 2)
	assert.ok(protocolView(state, CP_ROLE).actions.event_choose.includes("attack"))
})

test("MO penalty places two source markers and restores the second attack with its own target", () => {
	const state = setupGame(222)
	for (const nation of Object.keys(state.mo.current)) state.mo.current[nation] = []
	state.units = [
		{ id: "fr-west", piece: "component-014", faction: "ap", nation: "fr", type: "army", location: "ardennes", reduced: false, supplied: true },
		{ id: "fr-east", piece: "component-014", faction: "ap", nation: "fr", type: "army", location: "saint_mihiel", reduced: false, supplied: true },
		{ id: "ge-west", piece: "component-043", faction: "cp", nation: "ge", type: "army", location: "luxembourg", reduced: false, supplied: true },
		{ id: "ge-east", piece: "component-043", faction: "cp", nation: "ge", type: "army", location: "toul", reduced: false, supplied: true },
	]
	state.state = "event"
	state.active = "cp"
	state.pending_event = {
		kind: "mo_penalty",
		owner: "cp",
		chooser: "cp",
		penalized: "ap",
		nation: "fr",
		mo: "test-fr-missed",
		stage: "mode",
		selected: [],
		required: 2,
		loss_required: 0,
		forward_available: false,
	}

	protocolAction(state, CP_ROLE, "event_choose", "attack")
	assert.deepEqual(new Set(protocolView(state, CP_ROLE).actions.event_space), new Set(["ardennes", "saint_mihiel"]))
	protocolAction(state, CP_ROLE, "event_space", "ardennes")
	assert.deepEqual(protocolView(state, CP_ROLE).actions.event_space, ["saint_mihiel"])
	protocolAction(state, CP_ROLE, "event_space", "saint_mihiel")
	assert.deepEqual(state.pending_event.selected, ["ardennes", "saint_mihiel"])
	assert.equal(state.pending_event.forced_targets, undefined)
	protocolAction(state, CP_ROLE, "event_confirm")

	assert.equal(state.active, "ap")
	assert.equal(state.state, "ops_attack")
	assert.deepEqual(new Set(state.ops.forced_attacks), new Set(["ardennes", "saint_mihiel"]))
	assert.equal(state.ops.forced_targets, undefined)
	let view = protocolView(state, AP_ROLE)
	const firstAttacker = state.units.find((unit) => unit.id === state.ops.attack_selection[0])
	const firstTarget = firstAttacker.location === "ardennes" ? "luxembourg" : "toul"
	assert.ok(view.actions.declare_attack.includes(firstTarget))

	state.ops.forced_attacks = state.ops.forced_attacks.filter((space) => space !== firstAttacker.location)
	state.combat = {
		attacker: "ap",
		defender: "cp",
		attackers: state.ops.attack_selection.slice(),
		defenders: state.units.filter((unit) => unit.location === firstTarget && unit.faction === "cp").map((unit) => unit.id),
		target: firstTarget,
		modifiers: { cards: [] },
	}
	rules._test.finishCombatSequence(state)

	view = protocolView(state, AP_ROLE)
	const secondAttacker = state.units.find((unit) => unit.id === state.ops.attack_selection[0])
	const secondTarget = secondAttacker.location === "ardennes" ? "luxembourg" : "toul"
	assert.notEqual(secondTarget, firstTarget)
	assert.ok(view.actions.declare_attack.includes(secondTarget))
})

test("one combat may consume two MO-penalty markers that attack the same target", () => {
	const state = setupGame(223)
	for (const nation of Object.keys(state.mo.current)) state.mo.current[nation] = []
	state.units = [
		{ id: "fr-west", piece: "component-014", faction: "ap", nation: "fr", type: "army", location: "ardennes", reduced: false, supplied: true },
		{ id: "fr-east", piece: "component-014", faction: "ap", nation: "fr", type: "army", location: "saint_mihiel", reduced: false, supplied: true },
		{ id: "ge-target", piece: "component-043", faction: "cp", nation: "ge", type: "army", location: "metz", reduced: false, supplied: true },
	]
	state.state = "event"
	state.active = "cp"
	state.pending_event = {
		kind: "mo_penalty",
		owner: "cp",
		chooser: "cp",
		penalized: "ap",
		nation: "fr",
		mo: "test-fr-missed",
		stage: "origin",
		selected: [],
		required: 2,
		loss_required: 0,
		forward_available: false,
	}
	protocolAction(state, CP_ROLE, "event_space", "ardennes")
	protocolAction(state, CP_ROLE, "event_space", "saint_mihiel")
	protocolAction(state, CP_ROLE, "event_confirm")

	let view = protocolView(state, AP_ROLE)
	const second = ["fr-west", "fr-east"].find((id) => !state.ops.attack_selection.includes(id))
	assert.ok(view.actions.select_attacker.includes(second))
	protocolAction(state, AP_ROLE, "select_attacker", second)
	view = protocolView(state, AP_ROLE)
	assert.deepEqual(view.actions.declare_attack, ["metz"])
	protocolAction(state, AP_ROLE, "declare_attack", "metz")
	while (state.state === "combat_card_window")
		protocolAction(state, state.active === "ap" ? AP_ROLE : CP_ROLE, "pass")
	assert.deepEqual(state.ops.forced_attacks, [])
})

test("version 38 MO-penalty target selections migrate to source-only markers", () => {
	const state = setupGame(224)
	state.version = 38
	state.state = "event"
	state.active = "cp"
	state.ops = { forced_attacks: [], forced_targets: { ardennes: "luxembourg" } }
	state.pending_event = {
		kind: "mo_penalty",
		owner: "cp",
		chooser: "cp",
		penalized: "ap",
		stage: "target",
		origin: "saint_mihiel",
		selected: [{ origin: "ardennes", target: "luxembourg" }],
		required: 2,
	}
	protocolView(state, CP_ROLE)
	assert.equal(state.version, 42)
	assert.deepEqual(state.pending_event.selected, ["ardennes", "saint_mihiel"])
	assert.equal(state.pending_event.stage, "confirm")
	assert.equal(state.pending_event.origin, undefined)
	assert.equal(state.ops.forced_targets, undefined)
})

test("a resolved front MO cannot later be completed a second time", () => {
	const state = setupGame(219)
	for (const nation of Object.keys(state.mo.current)) state.mo.current[nation] = []
	state.events["cp_坦能堡的英雄"] = true
	state.events["cp_布列斯特_立托夫斯克条约"] = true
	state.mo.current.ge = ["ge-10"]
	state.mo.completed.ge = []
	state.mo.waived.ge = []
	state.mo.penalized.ge = []
	state.mo.review.confirmed = []
	state.state = "mo_review"
	state.active = "cp"
	protocolAction(state, CP_ROLE, "confirm_mo")
	assert.deepEqual(state.mo.waived.ge, ["ge-10"])
	state.state = "replacement"
	state.active = "cp"
	state.replacement_active = "cp"
	rules._test.finishReplacement(state)
	assert.deepEqual(state.mo.completed.ge, [])
	assert.equal(state.mo.history.filter((entry) => entry.id === "ge-10").length, 1)
})

test("movement-after-attack units cannot supply MO attack conditions", () => {
	const state = setupGame(220)
	installMo(state, "br", [{
		id: "test-br-mixed",
		kind: "task",
		nation: "br",
		attacks: 1,
		attack_condition: { mixed_with: "fr", mixed_type: "army" }
	}])
	const attackers = [
		{ id: "br-a", faction: "ap", nation: "br", type: "army", location: "ardennes" },
		{ id: "fr-a", faction: "ap", nation: "fr", type: "army", location: "saint_mihiel", moved: true, attack_eligible: true }
	]
	state.units = attackers
	state.activations = { ardennes: "attack", saint_mihiel: "move" }
	const declaration = { attackers: attackers.map((unit) => unit.id), target: "metz" }
	assert.equal(rules._test.moAttackEffect(state, "br", attackers, declaration), null)
	state.activations.saint_mihiel = "attack"
	assert.equal(rules._test.moAttackEffect(state, "br", attackers, declaration).id, "test-br-mixed")
})

test("influenza MO choice remains private until completion", () => {
	const state = setupGame(221)
	state.state = "event"
	state.active = "ap"
	state.pending_event = {
		kind: "mass_attrition",
		card: 635,
		owner: "ap",
		chooser: "ap",
		stage: "losses",
		selections: { ap: [], cp: [] },
		initial: { ap: { full: [], reduced: [] }, cp: { full: [], reduced: [] } },
		operation: { full_armies_per_faction: 4 },
		mo_selection: { nation: "fr", mo: "fr-9" }
	}
	assert.deepEqual(protocolView(state, AP_ROLE).pending_event.mo_selection, { nation: "fr", mo: "fr-9" })
	assert.equal(protocolView(state, CP_ROLE).pending_event.mo_selection, undefined)
	assert.equal(protocolView(state, "Observer").pending_event.mo_selection, undefined)
})

test("event-added MO declare explicit printed counter artwork", () => {
	const operation = data.card_effects["615"].operations.find((entry) => entry.type === "mo_modify")
	const printed = data.mo.fr.find((entry) => entry.id === "fr-6")
	assert.equal(operation.add[0].template_id, "fr-6")
	assert.ok(printed.image)
})

test("an impossible front MO is exhausted without completion or reward", () => {
	const state = setupGame(218)
	state.events["cp_坦能堡的英雄"] = true
	for (const nation of Object.keys(state.mo.current)) state.mo.current[nation] = []
	state.mo.current.ge = ["ge-10"]
	state.mo.completed.ge = []
	state.mo.waived.ge = []
	state.units = []
	state.reserves.cp = []
	state.rp.cp = { ge: 0, ah: 0, east: 0 }
	state.active = "cp"
	state.replacement_active = "cp"
	state.state = "replacement"
	rules._test.finishReplacement(state)
	assert.deepEqual(state.mo.completed.ge, [])
	assert.deepEqual(state.mo.waived.ge, ["ge-10"])
	assert.ok(state.mo.history.some((entry) => entry.id === "ge-10" && entry.outcome === "exhausted"))
})

test("an MO-penalty marker that loses every legal target is removed without stalling combat losses", () => {
	const state = setupGame(219)
	state.units = [
		{ id: "fr-forced", piece: "component-014", faction: "ap", nation: "fr", type: "army", location: "hillesheim", reduced: true, supplied: true },
	]
	state.active = "ap"
	state.state = "combat_losses"
	state.combat = null
	state.activations = { hillesheim: "attack" }
	state.ops = {
		card: null,
		total: 0,
		remaining: 0,
		source: "mo_penalty",
		source_id: "fr-test",
		activated: ["hillesheim"],
		forced_attacks: ["hillesheim"],
		required_attackers: { hillesheim: ["fr-forced"] },
		return_after_forced: "mo_penalty",
		execution_phase: "attack",
		attack_selection: [],
		activated_units: {},
		region_activations: { move: {}, attack: {}, construct: {} },
	}

	assert.doesNotThrow(() => rules._test.finishCombatSequence(state))
	assert.deepEqual(state.ops.forced_attacks, [])
	assert.notEqual(state.state, "combat_losses")
	assert.ok(state.log.some((entry) => entry.includes("强制进攻已无合法目标")))
})

