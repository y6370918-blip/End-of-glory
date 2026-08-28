import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const sourceDir = process.env.EOG_DATA_SOURCE_DIR
	? path.resolve(process.env.EOG_DATA_SOURCE_DIR)
	: path.join(root, "data", "source")
const generatedDir = path.join(root, "data", "generated")
const outputFile = process.env.EOG_DATA_OUTPUT
	? path.resolve(process.env.EOG_DATA_OUTPUT)
	: path.join(root, "data.js")
const require = createRequire(import.meta.url)
const ConnectionData = require(path.join(root, "connection-data.js"))

function readJson(file) {
	return JSON.parse(fs.readFileSync(file, "utf8"))
}

function optional(file, fallback) {
	return fs.existsSync(file) ? readJson(file) : fallback
}

const data = {
	schema: 2,
	connection_modes: ConnectionData.CONNECTION_MODES,
	title: optional(path.join(sourceDir, "title.json"), {}),
	cards: optional(path.join(sourceDir, "cards.json"), []),
	card_effects: optional(path.join(sourceDir, "card_effects.json"), {}),
	mo: optional(path.join(sourceDir, "mo.json"), {}),
	crt: optional(path.join(sourceDir, "crt.json"), {}),
	spaces: optional(path.join(sourceDir, "spaces.json"), []),
	edges: optional(path.join(sourceDir, "edges.json"), []),
	edge_rules: optional(path.join(sourceDir, "edge_rules.json"), {}),
	pieces: optional(path.join(sourceDir, "pieces.json"), []),
	setup: optional(path.join(sourceDir, "setup.json"), {}),
	ui: optional(path.join(sourceDir, "ui.json"), {}),
	events: optional(path.join(sourceDir, "events.json"), {}),
	assets: optional(path.join(generatedDir, "asset-manifest.json"), {})
}

const pieceRules = optional(path.join(sourceDir, "piece_rules.json"), {})
const pieceRuleProperties = new Set(["accepts_replacement_points", "permanent_on_elimination"])
for (const [id, rule] of Object.entries(pieceRules)) {
	const piece = data.pieces.find((candidate) => candidate.id === id)
	if (!piece) throw new Error(`Piece rule references missing piece ${id}`)
	for (const property of Object.keys(rule))
		if (!pieceRuleProperties.has(property)) throw new Error(`Piece ${id} uses unknown rule ${property}`)
	if (typeof rule.accepts_replacement_points !== "boolean" || typeof rule.permanent_on_elimination !== "boolean")
		throw new Error(`Piece ${id} has incomplete replacement rules`)
	Object.assign(piece, rule)
}
for (const piece of data.pieces.filter((candidate) => ["army", "corps"].includes(candidate.type))) {
	piece.accepts_replacement_points ??= true
	piece.permanent_on_elimination ??= false
	if (piece.cavalry && (!piece.accepts_replacement_points || !piece.permanent_on_elimination))
		throw new Error(`Cavalry piece ${piece.id} must accept RP and be permanent when eliminated`)
}

const assetBySource = Object.fromEntries(
	(data.assets.pieces || []).map((asset) => [String(asset.source).replaceAll("\\", "/"), asset.image])
)
const moKinds = new Set(["task", "none", "passive", "prohibition"])
for (const mo of Object.values(data.mo).flat()) {
	if (!moKinds.has(mo.kind)) throw new Error(`MO ${mo.id} has invalid kind ${mo.kind}`)
	if (mo.kind === "task" && !(mo.attacks > 0 || mo.requirement))
		throw new Error(`Task MO ${mo.id} has no completion condition`)
	if (mo.attack_drm_uses > 0 && !Number.isFinite(mo.attack_drm))
		throw new Error(`MO ${mo.id} has DRM uses without an explicit attack_drm`)
	if (mo.attack_column_uses > 0 && !Number.isFinite(mo.attack_column))
		throw new Error(`MO ${mo.id} has column uses without an explicit attack_column`)
	const source = String(mo.image_source || "").replaceAll("\\", "/")
	mo.image = assetBySource[source] || null
	if (!mo.image) throw new Error(`MO ${mo.id} has no generated image for ${mo.image_source}`)
}

const combatCardDispositions = optional(path.join(sourceDir, "combat_card_dispositions.json"), {})
for (const card of data.cards.filter((candidate) => candidate.combat_card)) {
	const disposition = combatCardDispositions[String(card.id)]
	if (!disposition) throw new Error(`Combat card ${card.id} has no explicit disposition`)
	const spec = data.card_effects[String(card.id)]
	if (!spec?.combat) throw new Error(`Combat card ${card.id} has no combat effect specification`)
	spec.combat.disposition = disposition
}
for (const id of Object.keys(combatCardDispositions)) {
	const card = data.cards.find((candidate) => String(candidate.id) === id)
	if (!card?.combat_card) throw new Error(`Orphan combat-card disposition ${id}`)
}

const pieceValues = optional(path.join(sourceDir, "piece_values.json"), {})
const combatPieces = data.pieces.filter((piece) => ["army", "corps"].includes(piece.type))
if (Object.keys(pieceValues).length !== combatPieces.length)
	throw new Error(`Expected ${combatPieces.length} combat piece value records, found ${Object.keys(pieceValues).length}`)
for (const piece of combatPieces) {
	const values = pieceValues[piece.id]
	if (!values) throw new Error(`Missing printed values for ${piece.id}`)
	if (values.type !== piece.type) throw new Error(`Printed type mismatch for ${piece.id}`)
	if (![values.full, values.reduced].every((side) => Array.isArray(side) && side.length === 3 && side.every(Number.isInteger)))
		throw new Error(`Invalid printed values for ${piece.id}`)
	;[piece.combat, piece.loss, piece.movement] = values.full
	;[piece.reduced_combat, piece.reduced_loss, piece.reduced_movement] = values.reduced
	piece.image_back = `pieces/${piece.back_hash.slice(0, 16)}.webp`
}

const hqValues = optional(path.join(sourceDir, "hq_values.json"), {})
const hqPieces = data.pieces.filter((piece) => piece.type === "hq")
if (Object.keys(hqValues).length !== hqPieces.length)
	throw new Error(`Expected ${hqPieces.length} HQ value records, found ${Object.keys(hqValues).length}`)
for (const piece of hqPieces) {
	const values = hqValues[piece.id]
	if (!Array.isArray(values) || values.length !== 3 || !values.every(Number.isInteger))
		throw new Error(`Invalid printed HQ values for ${piece.id}`)
	;[piece.attack_drm, piece.defense_drm, piece.movement] = values
}

const bySpace = Object.fromEntries(data.spaces.map((space, index) => [space.id, index]))
for (const [key, rules] of Object.entries(data.edge_rules)) {
	const [a, b] = key.split("|")
	const edge = data.edges.find(
		(candidate) =>
			(candidate.a === a && candidate.b === b) ||
			(candidate.a === b && candidate.b === a)
	)
	if (!edge) throw new Error(`Edge rule references missing edge ${key}`)
	Object.assign(edge, rules)
}
delete data.edge_rules

const connectionIndex = ConnectionData.buildConnectionIndex(data.edges, Object.keys(bySpace))
for (const space of data.spaces) space.connections = []
for (const edge of data.edges) {
	const a = data.spaces[bySpace[edge.a]]
	const b = data.spaces[bySpace[edge.b]]
	if (!a || !b) throw new Error(`Orphan edge ${edge.a}-${edge.b}`)
	a.connections.push(edge.b)
	b.connections.push(edge.a)
}
for (const space of data.spaces) {
	space.connections.sort()
	space.connections_by_mode = ConnectionData.generatedConnectionsByMode(connectionIndex, space.id)
}

if (data.cards.length !== 118) throw new Error(`Expected 118 cards, found ${data.cards.length}`)
const cardIds = new Set(data.cards.map((card) => String(card.id)))
const effectIds = new Set(Object.keys(data.card_effects))
if (effectIds.size !== 118) throw new Error(`Expected 118 card effect specs, found ${effectIds.size}`)
for (const id of cardIds) if (!effectIds.has(id)) throw new Error(`Missing effect spec for card ${id}`)
for (const id of effectIds) if (!cardIds.has(id)) throw new Error(`Orphan effect spec for card ${id}`)
const operationTypes = new Set([
	"noop",
	"vp",
	"rp",
	"front",
	"entry",
	"entry_track",
	"event_cost",
	"war_status",
	"step_loss",
	"cancel_event",
	"replacement_bonus",
	"end_vp",
	"recurring_rp_loss",
	"reinforcement",
	"combat_modifier",
	"mo_modify",
	"mo_unlock",
	"delay_units",
	"rule_modifier",
	"choice_resolution"
])
for (const [id, spec] of Object.entries(data.card_effects)) {
	const card = data.cards.find((candidate) => String(candidate.id) === id)
	const expectedDisposition = card?.remove ? "remove" : "discard"
	if (spec.disposition !== expectedDisposition)
		throw new Error(`Card ${id} disposition ${spec.disposition} does not match remove=${Boolean(card?.remove)}`)
	if (card?.combat_card) {
		const disposition = spec.combat?.disposition
		if (!disposition) throw new Error(`Combat card ${id} has no merged disposition`)
		if (card.remove && (
			disposition.after_combat !== "remove" ||
			disposition.retain_on_win !== false ||
			disposition.win_draw !== null ||
			disposition.retained_after_use !== "remove"
		)) throw new Error(`Starred combat card ${id} must be removed after use`)
		if (!card.remove && disposition.after_combat === "remove")
			throw new Error(`Unstarred combat card ${id} cannot use unconditional removal`)
	}
	const plainCard = card?.event == null
	if (!Array.isArray(spec.timing) || (!plainCard && spec.timing.length === 0)) throw new Error(`Card ${id} has no timing`)
	if (!Array.isArray(spec.operations) || (!plainCard && spec.operations.length === 0)) throw new Error(`Card ${id} has no operations`)
	if (plainCard && (spec.timing.length || spec.operations.length)) throw new Error(`Plain card ${id} defines an event flow`)
	for (const operation of spec.operations)
		if (!operationTypes.has(operation.type)) throw new Error(`Card ${id} uses unknown operation ${operation.type}`)
	if (spec.operations.some((operation) => operation.type === "rule"))
		throw new Error(`Card ${id} still uses the forbidden generic rule fallback`)
	for (const operation of spec.operations.filter((candidate) => candidate.type === "rule_modifier"))
		if (!operation.key) throw new Error(`Card ${id} has an unkeyed rule modifier`)
	for (const operation of spec.operations.filter((candidate) => candidate.type === "reinforcement")) {
		for (const unit of operation.units || []) {
			if (!data.pieces.some((piece) => piece.id === unit.piece))
				throw new Error(`Card ${id} reinforcement references missing piece ${unit.piece}`)
			if (!Number.isInteger(unit.count) || unit.count < 1)
				throw new Error(`Card ${id} reinforcement has invalid count for ${unit.piece}`)
			if (!["map", "reserve", "upgrade", "eliminated"].includes(unit.to))
				throw new Error(`Card ${id} reinforcement has invalid destination ${unit.to}`)
		}
	}
	for (const operation of spec.operations.filter((candidate) => candidate.type === "mo_modify")) {
		if (!data.mo[operation.nation]) throw new Error(`Card ${id} modifies unknown MO nation ${operation.nation}`)
		for (const addition of operation.add || []) {
			if (!addition.key || !addition.name || !Number.isInteger(addition.count) || addition.count < 1)
				throw new Error(`Card ${id} has invalid MO addition`)
			if (!moKinds.has(addition.kind) || !["turn", "game"].includes(addition.duration))
				throw new Error(`Card ${id} MO ${addition.key} has invalid kind or duration`)
			if (addition.kind === "task" && !(addition.attacks > 0 || addition.requirement))
				throw new Error(`Card ${id} task MO ${addition.key} has no completion condition`)
			if (addition.attack_drm_uses > 0 && !Number.isFinite(addition.attack_drm))
				throw new Error(`Card ${id} MO ${addition.key} has no explicit attack_drm`)
			if (addition.attack_column_uses > 0 && !Number.isFinite(addition.attack_column))
				throw new Error(`Card ${id} MO ${addition.key} has no explicit attack_column`)
		}
	}
	for (const operation of spec.operations.filter((candidate) => candidate.type === "delay_units")) {
		if (!operation.groups?.length || !Number.isInteger(operation.return_after_turns))
			throw new Error(`Card ${id} has invalid delayed-unit definition`)
	}
	if (spec.duration !== "instant" && !spec.cleanup && spec.duration !== "game")
		throw new Error(`Card ${id} duration ${spec.duration} has no cleanup`)
}

function requireEventRule(id, predicate, message) {
	const spec = data.card_effects[String(id)]
	if (!spec || !predicate(spec)) throw new Error(`Card ${id} event audit failed: ${message}`)
	const card = data.cards.find((candidate) => candidate.id === id)
	if (!card || card.effect !== spec.source_text)
		throw new Error(`Card ${id} event audit failed: cards.json effect and source_text differ`)
}

requireEventRule(601, (spec) => spec.operations.some((operation) =>
	operation.key === "regional_rotation" && operation.immediate_rp && operation.first_rp === 2
), "regional rotation must grant immediate RP")
requireEventRule(607, (spec) => spec.operations.some((operation) =>
	operation.type === "reinforcement" && operation.free_sr?.turn_one_count === 1 && operation.free_sr?.count === 2
), "turn-one free SR must be one, otherwise two")
requireEventRule(611, (spec) => spec.operations.some((operation) =>
	operation.key === "sack_belgium" && operation.remove_count === 2 && operation.place_eliminated_piece
), "Belgian SCU removal and LCU placement are required")
requireEventRule(637, (spec) => spec.operations.some((operation) =>
	operation.type === "reinforcement" && operation.exchange?.maximum === 2 && operation.exchange?.incoming_pieces?.length === 2
), "Piave exchange must cover the British and French armies")
requireEventRule(643, (spec) => spec.operations.some((operation) =>
	operation.type === "cancel_event" && operation.prohibit_future && operation.prohibit_card === 723
), "Convoy must cancel and prohibit card 723")
requireEventRule(645, (spec) => spec.operations.some((operation) =>
	operation.prohibits_card === 731
), "British reserves must prohibit card 731")
requireEventRule(710, (spec) => spec.combat?.required_hq_piece === "component-085" &&
	spec.combat?.first_fire === "cp" && spec.combat?.extra_enemy_loss === 1,
"Rupprecht HQ, first fire, and extra loss must be explicit")
for (const id of [715, 717])
	requireEventRule(id, (spec) => spec.operations.some((operation) =>
		operation.type === "rp" && operation.nation === "ge" && operation.immediate_choice
	), "German reinforcement RP must offer immediate use")
requireEventRule(720, (spec) => spec.operations.some((operation) =>
	operation.key === "killing_ground" && operation.immediate_sr === 2 && operation.fort_fire === 0 &&
	operation.maintenance_optional && operation.automatic_attack_mo
), "Killing Ground must define SR, fort fire, maintenance, and MO timing")
requireEventRule(724, (spec) => spec.operations.some((operation) =>
	operation.type === "replacement_bonus" && operation.immediate_if_commitment?.level === "total"
), "German War Industry must grant its immediate total-war RP")
requireEventRule(725, (spec) => ["ge", "ah"].every((nation) => spec.operations.some((operation) =>
	operation.type === "rp" && operation.nation === nation && operation.immediate
)), "Bulgaria must grant both immediate RP pools")
requireEventRule(735, (spec) => spec.operations.some((operation) =>
	operation.type === "reinforcement" && operation.rebuild_theater === "italian" &&
	operation.restriction_scope === "generated_army_hq"
), "Below reinforcements must retain the Italian-theater restriction")
requireEventRule(736, (spec) => spec.prerequisites?.requires_event === "cp_兴登堡_鲁登道夫" &&
	spec.operations.some((operation) => operation.key === "hindenburg_line" && operation.marker_count === 2 &&
		operation.retreat_stack && operation.add_mo?.defense_drm === 1),
"Hindenburg Line prerequisite, retreat, markers, and MO are required")
requireEventRule(739, (spec) => spec.combat?.remove_piece_before_combat === "component-011" &&
	spec.combat?.excluded_hq_piece === "component-001",
"Nivelle removal and Petain-only exclusion must be explicit")
requireEventRule(754, (spec) => spec.choices.some((choice) => choice.id === "ge_rp" &&
	choice.effects?.some((operation) => operation.type === "rp" && operation.immediate)
), "Lenin RP choice must be immediately usable")

const banner = "/* Generated by tools/build_data.mjs. Do not edit by hand. */\n"
const body = `const data = ${JSON.stringify(data, null, "\t")}\n\n`
const footer =
	'if (typeof module !== "undefined") module.exports = data\nif (typeof window !== "undefined") window.eog_data = data\n'
fs.writeFileSync(outputFile, banner + body + footer)
console.log(
	JSON.stringify({
		cards: data.cards.length,
		mo: Object.values(data.mo).flat().length,
		spaces: data.spaces.length,
		edges: data.edges.length,
		pieces: data.pieces.length
	})
)
