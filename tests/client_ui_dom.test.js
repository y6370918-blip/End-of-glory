"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")
const { Window } = require("happy-dom")
const ClientUi = require("../client-ui.js")

test("yellow target dispatches the exact primitive action", () => {
	const window = new Window()
	const target = window.document.createElement("button")
	ClientUi.decorateTarget(target, { legal: true })
	assert.equal(target.classList.contains("legal"), true)
	const sent = []
	ClientUi.dispatchTarget([{ action: "move", arg: "metz" }], (action, arg) => sent.push([action, arg]), () => {})
	assert.deepEqual(sent, [["move", "metz"]])
})

test("grey and orange blocked targets explain but never dispatch", () => {
	const window = new Window()
	const grey = window.document.createElement("button")
	const orange = window.document.createElement("button")
	ClientUi.decorateTarget(grey, { hints: [{ code: "movement_points" }] })
	ClientUi.decorateTarget(orange, { hints: [{ code: "event_restriction", importance: "important" }] })
	assert.equal(grey.classList.contains("blocked"), true)
	assert.equal(grey.classList.contains("legal"), false)
	assert.equal(orange.classList.contains("important"), true)
	const sent = []
	assert.equal(ClientUi.dispatchTarget([], (...args) => sent.push(args), () => {}), false)
	assert.deepEqual(sent, [])
})

test("multiple target actions open the common menu", () => {
	const entries = [{ action: "activate_move", arg: "paris" }, { action: "activate_attack", arg: "paris" }]
	let menu = null
	ClientUi.dispatchTarget(entries, () => assert.fail("should not send directly"), (items) => { menu = items })
	assert.equal(menu, entries)
})

test("stable pieces are reparented without changing DOM identity", () => {
	const window = new Window()
	const first = window.document.createElement("div")
	const second = window.document.createElement("div")
	const piece = window.document.createElement("button")
	first.append(piece)
	assert.equal(ClientUi.reparentStable(piece, second), piece)
	assert.equal(second.firstChild, piece)
})

test("moving, flipping, selecting, and changing supply patch the same piece node", () => {
	const window = new Window()
	const origin = window.document.createElement("div")
	const destination = window.document.createElement("div")
	const piece = window.document.createElement("button")
	const image = window.document.createElement("img")
	piece.append(image)
	origin.append(piece)
	ClientUi.patchStableElement(piece, {
		className: "piece lcu selected supply-none reduced",
		dataset: { reduced: 1, supply: "none" }
	})
	ClientUi.patchStableElement(image, { src: "assets/reduced.webp" })
	const identity = ClientUi.reparentStable(piece, destination)
	assert.equal(identity, piece)
	assert.equal(destination.firstChild, piece)
	assert.equal(piece.classList.contains("selected"), true)
	assert.equal(piece.dataset.supply, "none")
	assert.equal(image.getAttribute("src"), "assets/reduced.webp")
})

test("information window layouts are clamped to the viewport", () => {
	const window = new Window()
	const element = window.document.createElement("section")
	const result = ClientUi.applyWindowLayout(element, { left: 900, top: -20, width: 600, height: 500 }, { width: 1000, height: 700 })
	assert.deepEqual(result, { left: 400, top: 0, width: 600, height: 500 })
})

test("card action menu keeps illegal uses visible but disabled", () => {
	const window = new Window()
	const menu = window.document.createElement("menu")
	const sent = []
	ClientUi.renderActionMenu(menu, {
		title: "八月炮火",
		items: [
			{ action: "naval_event", arg: 700, label: "事件", enabled: false },
			{ action: "naval_fleet", arg: 700, label: "舰队", enabled: true }
		],
		onSelect: (action, arg) => sent.push([action, arg])
	})
	assert.equal(menu.querySelector(".title").textContent, "八月炮火")
	assert.equal(menu.querySelector('[data-action="naval_event"]').className, "disabled")
	menu.querySelector('[data-action="naval_event"]').click()
	assert.deepEqual(sent, [])
	menu.querySelector('[data-action="naval_fleet"]').click()
	assert.deepEqual(sent, [["naval_fleet", 700]])
})
