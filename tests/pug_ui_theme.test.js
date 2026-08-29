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
	assert.match(css, /body\s*\{[^}]*background:\s*slategray/s)
	assert.match(css, /body #log\s*\{[^}]*background:\s*whitesmoke/s)
	assert.doesNotMatch(css, /--eog-ap:\s*#173c9c|--eog-cp:\s*#b31d2d/)
})

test("the removed combat dashboard does not leave boxed EOG statistics", () => {
	assert.doesNotMatch(css, /\.combat-stat\b/)
	assert.doesNotMatch(client, /function combatStat\b|className = "combat-stat"/)
	assert.doesNotMatch(html, /id="combat-panel"|id="combat-detail"/)
	assert.doesNotMatch(client, /function renderCombat\b|combatReference\(/)
	assert.match(html, /id="cc-list"/)
})

test("combat and log dice use the PUG sprite and faction faces", () => {
	assert.match(css, /\.die\s*\{[^}]*width:\s*11px[^}]*height:\s*11px[^}]*die_black_pips\.svg[^}]*background-size:\s*600% 100%/s)
	assert.match(css, /\.die\.ap\s*\{[^}]*background-color:\s*pink/s)
	assert.match(css, /\.die\.cp\s*\{[^}]*background-color:\s*lightblue/s)
	for (let face = 1; face <= 6; face++) assert.match(css, new RegExp(`\\.die\\.d${face}\\s*\\{`))
	assert.match(client, /function dieElement\(faction, value\)/)
	assert.match(client, /\[⚀-⚅\]/u)
	assert.match(client, /match\[3\] === "W" \? "ap" : "cp"/)
	assert.match(client, /function initializeDiceSprite\(\)/)
	assert.match(css, /\.dice-sprite-ready \.die\s*\{[^}]*color:\s*transparent/s)
	assert.match(css, /\.die-value\s*\{/)
	assert.doesNotMatch(css, /\.log-die\b/)
})

test("sidebar uses fixed PUG role and deck nodes without EOG summary cards", () => {
	assert.match(html, /id="role_Allied_Powers"[\s\S]*id="ap_hand"/)
	assert.match(html, /id="role_Central_Powers"[\s\S]*id="cp_hand"/)
	assert.match(html, /id="ap_deck_size"[\s\S]*id="cp_deck_size"[\s\S]*id="violations"/)
	assert.doesNotMatch(html, /class="role_info"/)
	assert.doesNotMatch(client, /sidebar-summary|sidebar-notices|role-stat-link/)
})

test("cards, panels, and information windows expose the PUG visual structure", () => {
	assert.match(html, /<section id="hand-panel" class="panel"><div class="panel-head">手牌<\/div>/)
	assert.doesNotMatch(html, /<div class="panel-head">战斗<\/div>/)
	assert.match(css, /\.card-thumb\s*\{[^}]*width:\s*var\(--card-width\)[^}]*height:\s*var\(--card-height\)[^}]*border-radius:\s*16px/s)
	assert.match(css, /\.dialog_header\s*\{[^}]*background:\s*var\(--eog-dialog-head\)/s)
	assert.match(css, /\.dialog_x\s*\{[^}]*background:\s*var\(--eog-dialog-close\)/s)
})

test("the PUG-style reinforcement board is generated from structured card operations", () => {
	assert.match(html, /id="show-reinforcements">检查增援/)
	assert.match(html, /id="reinforcement-panel"[^>]*aria-label="增援表"/)
	assert.match(html, /id="reinforcement-board" class="reinforcement-board"/)
	assert.match(client, /function renderReinforcementBoard\(\)/)
	assert.match(client, /operation\.type === "reinforcement"/)
	assert.match(client, /function reinforcementUnitElement\(operation, definition\)/)
	assert.match(client, /pieceById\[definition\.piece\]/)
	assert.match(client, /byId\("show-reinforcements"\)\.addEventListener\("click", showReinforcements\)/)
	assert.match(css, /\.reinforcement-board\s*\{[^}]*border:\s*8px solid #123b4f[^}]*background:\s*#d9ccb5/s)
})

test("card panels follow map zoom within readable bounds outside map panning", () => {
	assert.match(html, /id="board-panels" class="panel-list"/)
	assert.match(client, /function mountAdaptiveBoardPanels\(\)/)
	assert.match(client, /if \(panels\.parentElement !== main\) main\.append\(panels\)/)
	assert.match(client, /Math\.min\(1\.2, Math\.max\(0\.72, effectiveMapScale\)\)/)
	assert.match(client, /elementScale\(inner\) \* elementScale\(mapwrap\)/)
	assert.match(client, /outer\.style\.height = `\$\{Math\.ceil\(scaledHeight\)\}px`/)
	assert.match(css, /#board-panels\[data-scale-mode="adaptive"\]\s*\{[^}]*position:\s*sticky[^}]*width:\s*var\(--panel-viewport-width, 100%\)[^}]*transform:\s*none !important/s)
	assert.match(css, /--card-width:\s*calc\(250px \* var\(--card-scale\)\)/)
	assert.match(css, /--card-height:\s*calc\(340px \* var\(--card-scale\)\)/)
})

test("toolbar and sidebar retain the PUG dimensions", () => {
	assert.doesNotMatch(css, /#toolbar > details > summary,[\s\S]{0,160}width:\s*(?:36|40)px/)
	assert.doesNotMatch(css, /#toolbar > details > summary img,[\s\S]{0,160}width:\s*(?:26|30)px/)
	assert.match(css, /body aside\s*\{[^}]*width:\s*212px/s)
	assert.match(css, /body \.role\s*\{[^}]*font-size:\s*16px[^}]*line-height:\s*1\.5/s)
	assert.match(css, /body #log\s*\{[^}]*font-size:\s*12px[^}]*line-height:\s*18px/s)
	assert.match(css, /body #prompt\s*\{[^}]*font-size:\s*18px[^}]*line-height:\s*22px/s)
	assert.match(css, /@media\s*\(max-width:\s*600px\)[\s\S]*#stack-menu\s*\{[^}]*display:\s*none/s)
})

test("map feedback remains explicit and is not color-only", () => {
	assert.match(css, /\.space\.legal\s*\{[^}]*border:\s*4px solid yellow/s)
	assert.match(css, /\.space\.blocked\s*\{[^}]*border:\s*3px dashed/s)
	assert.match(css, /\.piece\.selected\s*\{[^}]*rotate\(22\.5deg\)[^}]*cyan/s)
	assert.match(css, /\.piece\.advance-candidate::before\s*\{[^}]*content:\s*"▲"/s)
})

test("mobile layout leaves no fixed blank row between the header and map", () => {
	assert.doesNotMatch(css, /@media\s*\(max-width:\s*400px\)[\s\S]*grid-template-rows:\s*auto\s+minmax\(0,\s*200px\)/)
	assert.match(css, /@media\s*\(max-width:\s*800px\)[\s\S]*\.panel-list\s*\{[^}]*width:\s*100vw/s)
	assert.match(css, /@media\s*\(max-width:\s*800px\)[\s\S]*#cc-list\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s)
	assert.match(client, /window\.visualViewport/)
	assert.match(client, /function positionTransientMenu\(/)
})

test("sidebar logs use PUG continuous faction groups and compact hierarchy", () => {
	assert.match(css, /#log \.group\.ap\s*\{[^}]*background:\s*hsl\(0 20% 90%\)/s)
	assert.match(css, /#log \.group\.cp\s*\{[^}]*background:\s*hsl\(214 30% 90%\)/s)
	assert.match(css, /#log \.group\.h4\.ap\s*\{[^}]*background:\s*hsl\(0 20% 80%\)/s)
	assert.match(css, /#log \.group\.h4\.cp\s*\{[^}]*background:\s*hsl\(214 30% 80%\)/s)
	assert.match(css, /#log \.i\.align\s*\{[^}]*padding-left:\s*24px/s)
	assert.match(client, /function onLog\(text, index = 0\)/)
	assert.match(client, /content\.startsWith\("\.h2"\)[\s\S]*element\.className = "h2"/)
	assert.match(client, /classList\.add\(`\$\{faction\}-unit`\)/)
	assert.match(client, /classList\.add\(`\$\{card\.faction\}-card`\)/)
	assert.doesNotMatch(css, /#log \.group\.ap\s*\{[^}]*border-left/s)
})
