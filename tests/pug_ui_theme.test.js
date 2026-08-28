"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const root = path.join(__dirname, "..")
const css = fs.readFileSync(path.join(root, "play.css"), "utf8")
const client = fs.readFileSync(path.join(root, "play.js"), "utf8")
const html = fs.readFileSync(path.join(root, "play.html"), "utf8")

test("PUG theme uses AP red, CP blue, and the high-contrast shell", () => {
	assert.match(css, /--eog-ap:\s*#8b1f26/)
	assert.match(css, /--eog-ap-bg:\s*lightcoral/)
	assert.match(css, /--eog-cp:\s*#174f8a/)
	assert.match(css, /--eog-cp-bg:\s*lightsteelblue/)
	assert.match(css, /body\.eog\s*\{[^}]*background:\s*slategray/s)
	assert.match(css, /body\.eog #log\s*\{[^}]*background:\s*whitesmoke/s)
	assert.doesNotMatch(css, /--eog-ap:\s*#173c9c|--eog-cp:\s*#b31d2d/)
})

test("the removed combat dashboard does not leave boxed EOG statistics", () => {
	assert.doesNotMatch(css, /\.combat-stat\b/)
	assert.doesNotMatch(client, /function combatStat\b|className = "combat-stat"/)
	assert.doesNotMatch(html, /id="combat-panel"|id="combat-detail"/)
	assert.doesNotMatch(client, /function renderCombat\b|combatReference\(/)
	assert.match(html, /id="combat-card-zones"/)
})

test("combat and log dice use the PUG sprite and faction faces", () => {
	assert.match(css, /\.die\s*\{[^}]*width:\s*11px[^}]*height:\s*11px[^}]*die_black_pips\.svg[^}]*background-size:\s*600% 100%/s)
	assert.match(css, /\.die\.ap\s*\{[^}]*background-color:\s*pink/s)
	assert.match(css, /\.die\.cp\s*\{[^}]*background-color:\s*lightblue/s)
	for (let face = 1; face <= 6; face++) assert.match(css, new RegExp(`\\.die\\.d${face}\\s*\\{`))
	assert.match(client, /function dieElement\(faction, value\)/)
	assert.doesNotMatch(css, /\.log-die\b/)
})

test("cards, panels, and information windows expose the PUG visual structure", () => {
	assert.match(html, /<div id="hand-title" class="panel-head">手牌<\/div>/)
	assert.doesNotMatch(html, /<div class="panel-head">战斗<\/div>/)
	assert.match(css, /\.card-thumb\s*\{[^}]*width:\s*250px[^}]*height:\s*340px[^}]*border-radius:\s*16px/s)
	assert.match(css, /\.info-window-header\s*\{[^}]*background:\s*var\(--eog-dialog-head\)/s)
	assert.match(css, /\.info-window-close\s*\{[^}]*background:\s*var\(--eog-dialog-close\)/s)
})

test("map feedback remains explicit and is not color-only", () => {
	assert.match(css, /\.space\.legal\s*\{[^}]*border:\s*4px solid yellow/s)
	assert.match(css, /\.space\.blocked\s*\{[^}]*border:\s*3px dashed/s)
	assert.match(css, /\.piece\.selected\s*\{[^}]*rotate\(22\.5deg\)[^}]*cyan/s)
	assert.match(css, /\.piece\.advance-candidate::before\s*\{[^}]*content:\s*"▲"/s)
})
