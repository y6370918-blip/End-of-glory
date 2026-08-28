"use strict"

;(function (root, factory) {
	const api = factory()
	if (typeof module === "object" && module.exports) module.exports = api
	else root.EogClientUi = api
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
	function decorateTarget(element, { legal = false, hints = [] } = {}) {
		const important = hints.some((entry) => entry.importance === "important")
		element.classList.toggle("legal", legal)
		element.classList.toggle("blocked", !legal && hints.length > 0)
		element.classList.toggle("important", !legal && important)
		return element
	}

	function dispatchTarget(entries, perform, menu) {
		if (!entries?.length) return false
		if (entries.length === 1) perform(entries[0].action, entries[0].arg)
		else menu(entries)
		return true
	}

	function reparentStable(element, parent) {
		if (element.parentNode !== parent) parent.append(element)
		return element
	}

	function patchStableElement(element, frame = {}) {
		if (frame.className !== undefined && element.className !== frame.className)
			element.className = frame.className
		if (frame.src !== undefined && element.getAttribute("src") !== frame.src)
			element.setAttribute("src", frame.src)
		for (const [name, value] of Object.entries(frame.dataset || {})) {
			if (value == null) delete element.dataset[name]
			else if (element.dataset[name] !== String(value)) element.dataset[name] = String(value)
		}
		for (const [name, value] of Object.entries(frame.attributes || {})) {
			if (value == null) element.removeAttribute(name)
			else if (element.getAttribute(name) !== String(value)) element.setAttribute(name, String(value))
		}
		return element
	}

	function applyWindowLayout(element, layout, viewport = { width: globalThis.innerWidth, height: globalThis.innerHeight }) {
		const width = Math.min(Math.max(280, Number(layout?.width) || element.offsetWidth || 480), viewport.width)
		const height = Math.min(Math.max(180, Number(layout?.height) || element.offsetHeight || 360), viewport.height)
		const left = Math.max(0, Math.min(Number(layout?.left) || 0, viewport.width - width))
		const top = Math.max(0, Math.min(Number(layout?.top) || 0, viewport.height - height))
		Object.assign(element.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` })
		return { left, top, width, height }
	}

	function renderActionMenu(menu, { title = "", items = [], onSelect = () => {} } = {}) {
		const document = menu.ownerDocument
		const heading = document.createElement("li")
		heading.className = "title"
		heading.textContent = title
		const separator = document.createElement("li")
		separator.className = "separator"
		menu.replaceChildren(heading, separator)
		for (const entry of items) {
			const item = document.createElement("li")
			item.dataset.action = entry.action
			item.textContent = entry.label
			item.className = entry.enabled ? "action" : "disabled"
			item.setAttribute("aria-disabled", entry.enabled ? "false" : "true")
			if (entry.enabled) item.addEventListener("click", () => onSelect(entry.action, entry.arg))
			menu.append(item)
		}
		return menu
	}

	return { applyWindowLayout, decorateTarget, dispatchTarget, patchStableElement, renderActionMenu, reparentStable }
})
