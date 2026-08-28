import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const require = createRequire(import.meta.url)
const data = require(path.join(root, "data.js"))
const ConnectionData = require(path.join(root, "connection-data.js"))

ConnectionData.validateConnections(
	data.edges,
	data.spaces.map((space) => space.id)
)
const index = ConnectionData.buildConnectionIndex(data.edges)
const spaceIds = new Set(data.spaces.map((space) => space.id))

function assertGeneratedIndex() {
	for (const space of data.spaces) {
		const expected = ConnectionData.generatedConnectionsByMode(index, space.id)
		if (JSON.stringify(space.connections_by_mode) !== JSON.stringify(expected))
			throw new Error(`Generated connection index differs at ${space.id}`)
	}
}

function modeSummary() {
	return Object.fromEntries(
		ConnectionData.CONNECTION_MODES.map((mode) => [
			mode,
			Object.fromEntries(
				ConnectionData.CONNECTION_FACTIONS.map((faction) => [
					faction,
					data.edges.filter(
						(edge) => edge.modes.includes(mode) && edge.factions.includes(faction)
					).length
				])
			)
		])
	)
}

function inspectSpace(space) {
	if (!spaceIds.has(space)) throw new Error(`Unknown space ${space}`)
	return {
		space,
		land: ConnectionData.landNeighbors(index, space),
		modes: ConnectionData.generatedConnectionsByMode(index, space)
	}
}

function inspectEdge(a, b) {
	if (!spaceIds.has(a)) throw new Error(`Unknown space ${a}`)
	if (!spaceIds.has(b)) throw new Error(`Unknown space ${b}`)
	const edge = ConnectionData.connectionBetween(index, a, b)
	return {
		from: a,
		to: b,
		connected: Boolean(edge),
		edge,
		allowed: edge
			? Object.fromEntries(
					ConnectionData.CONNECTION_MODES.map((mode) => [
						mode,
						Object.fromEntries(
							ConnectionData.CONNECTION_FACTIONS.map((faction) => [
								faction,
								ConnectionData.connectionAllows(index, a, b, mode, faction)
							])
						)
					])
				)
			: null
	}
}

assertGeneratedIndex()
const [a, b, ...extra] = process.argv.slice(2)
if (extra.length) throw new Error("Usage: npm run audit:connections -- [space] [neighbor]")

let report
if (a && b) report = inspectEdge(a, b)
else if (a) report = inspectSpace(a)
else
	report = {
		schema: data.schema,
		spaces: data.spaces.length,
		edges: data.edges.length,
		types: Object.fromEntries(
			[...new Set(data.edges.map((edge) => edge.type))].map((type) => [
				type,
				data.edges.filter((edge) => edge.type === type).length
			])
		),
		modes: modeSummary(),
		generated_index: "valid"
	}

console.log(JSON.stringify(report, null, 2))
