"use strict"

const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const assert = require("node:assert/strict")

const data = require("../data.js")

const EVENT_IDS = [
	...Array.from({ length: 59 }, (_, index) => 600 + index),
	...Array.from({ length: 59 }, (_, index) => 700 + index),
]

function semanticTestTitles() {
	const directory = __dirname
	const titles = []
	const pattern = /\btest\(\s*(?:"([^"\r\n]+)"|'([^'\r\n]+)')/g
	for (const file of fs.readdirSync(directory).filter((entry) =>
		entry.endsWith(".test.js") && entry !== "event_coverage.test.js")) {
		const source = fs.readFileSync(path.join(directory, file), "utf8")
		for (const match of source.matchAll(pattern))
			titles.push(match[1] || match[2])
	}
	return titles
}

test("all 118 event cards have curated display text and structured rules", () => {
	assert.deepEqual(data.cards.map((card) => card.id).sort((a, b) => a - b), EVENT_IDS)
	assert.equal(Object.keys(data.card_effects).length, EVENT_IDS.length)
	for (const card of data.cards) {
		assert.equal(typeof card.title, "string", `${card.id}: title`)
		assert.ok(card.title.trim(), `${card.id}: title`)
		assert.equal(typeof card.effect, "string", `${card.id}: effect`)
		assert.ok(card.effect.trim(), `${card.id}: effect`)
		assert.notEqual(card.effect, card.ocr_text, `${card.id}: OCR fallback`)
		assert.doesNotMatch(card.effect, /\uFFFD/, `${card.id}: mojibake`)
		assert.equal(card.effect.includes("\u0000"), false, `${card.id}: NUL`)
		assert.ok(data.card_effects[card.id], `${card.id}: card_effects`)
		assert.ok(Array.isArray(data.card_effects[card.id].operations), `${card.id}: operations`)
	}
})

test("every event card number appears in a named semantic test", () => {
	const titles = semanticTestTitles()
	const missing = EVENT_IDS.filter((id) =>
		!titles.some((title) => new RegExp(`(?:^|\\D)${id}(?:\\D|$)`).test(title)))
	assert.deepEqual(missing, [])
})
