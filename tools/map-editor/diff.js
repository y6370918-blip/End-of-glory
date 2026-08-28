"use strict"

;(function (root, factory) {
	const api = factory()
	if (typeof module === "object" && module.exports) module.exports = api
	else root.EogMapEditorDiff = api
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
	function fieldDiff(before, after, filter = "all") {
		const changes = []
		function walk(left, right, path) {
			if (JSON.stringify(left) === JSON.stringify(right)) return
			if (left && right && typeof left === "object" && typeof right === "object") {
				for (const key of new Set([...Object.keys(left), ...Object.keys(right)]))
					walk(left[key], right[key], `${path}.${key}`)
				return
			}
			changes.push({ path, before: left, after: right })
		}
		for (const key of ["spaces", "edges", "ui", "mapAudit"])
			if (filter === "all" || filter === key) walk(before?.[key], after?.[key], key)
		return changes
	}

	return Object.freeze({ fieldDiff })
})
