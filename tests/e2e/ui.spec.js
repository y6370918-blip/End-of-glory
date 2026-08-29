"use strict"

const { test, expect } = require("@playwright/test")

async function openPreview(page, name = "") {
	await page.goto(`/.preview${name ? `.${name}` : ""}.html`)
	await page.waitForFunction(() => document.fonts?.status === "loaded")
	await expect(page.locator("#map-image")).toBeVisible()
	await expect(page.locator("#piece-layer .piece").first()).toBeVisible()
}

test("PUG shell, markers and information windows remain usable", async ({ page }) => {
	await openPreview(page, "markers")
	await expect(page.locator("body")).toHaveClass(/bevel/)
	await expect(page.locator("#roles .role")).toHaveCount(2)
	await expect(page.locator("#marker-layer").locator(".track-marker, .map-marker").first()).toBeVisible()
	await page.locator("#info-menu > summary").click()
	await page.locator("#show-score").click()
	await expect(page.locator("#score")).toBeVisible()
	const box = await page.locator("#score").boundingBox()
	const viewport = page.viewportSize()
	expect(box.x).toBeGreaterThanOrEqual(0)
	expect(box.y).toBeGreaterThanOrEqual(0)
	expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1)
	expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1)
	await page.locator("#score .dialog_x").click()
	await expect(page.locator("#score")).toBeHidden()
})

test("movement targets send only the server-signed primitive destination", async ({ page }) => {
	await openPreview(page, "movement")
	const target = page.locator("#space-layer .space.legal").first()
	await expect(target).toBeVisible()
	await target.dispatchEvent("click")
	await expect(page.locator("#status")).toContainText("视觉预览不会写入服务器：move")
})

test("combat cards remain direct one-click actions", async ({ page }) => {
	await openPreview(page, "combat-choice")
	await expect(page.locator("#cc-list")).toBeVisible()
	const legalCard = page.locator("#unused_combat_cards .combat-card.legal").first()
	await expect(legalCard).toBeVisible()
	await legalCard.dispatchEvent("click")
	await expect(page.locator("#status")).toContainText("视觉预览不会写入服务器：combat_card")
})

test("action cards use the PUG popup with legal and disabled choices", async ({ page }) => {
	await openPreview(page, "action-card")
	const legalCard = page.locator("#cards .card-thumb.legal").first()
	await expect(legalCard).toBeVisible()
	await legalCard.dispatchEvent("click")
	await expect(page.locator("#card-popup")).toBeVisible()
	await expect(page.locator("#card-popup li.title")).toHaveCount(1)
	await expect(page.locator("#card-popup li.action, #card-popup li.disabled")).toHaveCount(4)
})

test("mobile shell does not reserve an empty sidebar row above the map", async ({ page }) => {
	test.skip(page.viewportSize().width > 400)
	await openPreview(page, "markers")
	await expect(page.locator("#log_button")).toBeVisible()
	await expect(page.locator("#log_button img")).toHaveAttribute("src", "/images/scroll-quill.svg")
	const layout = await page.evaluate(() => {
		const header = document.querySelector("body > header").getBoundingClientRect()
		const main = document.querySelector("body > main").getBoundingClientRect()
		return {
			headerBottom: header.bottom,
			mainTop: main.top,
			mainHeight: main.height,
			asideHidden: document.querySelector("body > aside").hidden,
			rows: window.getComputedStyle(document.body).gridTemplateRows
		}
	})
	expect(layout.asideHidden).toBe(true)
	expect(layout.mainTop).toBeLessThanOrEqual(layout.headerBottom + 1)
	expect(layout.mainHeight).toBeGreaterThan(400)
	expect(layout.rows).not.toContain("200px")
	await page.locator("#log_button").click()
	await expect(page.locator("body > aside")).toBeVisible()
	await page.locator("#log_button").click()
	await expect(page.locator("body > aside")).toBeHidden()
})

test("mobile combat cards use a single viewport-width column", async ({ page }) => {
	test.skip(page.viewportSize().width > 400)
	await openPreview(page, "combat")
	const layout = await page.evaluate(() => {
		const panel = document.querySelector(".panel-list")
		const zones = document.querySelector("#cc-list")
		return {
			panelWidth: panel.getBoundingClientRect().width,
			columns: window.getComputedStyle(zones).gridTemplateColumns,
			viewportWidth: window.innerWidth
		}
	})
	expect(layout.panelWidth).toBeLessThanOrEqual(layout.viewportWidth)
	expect(layout.columns.trim().split(/\s+/)).toHaveLength(1)
})

test("toolbar and sidebar use the PUG dimensions", async ({ page }) => {
	for (const viewport of [
		{ width: 1920, height: 1080 },
		{ width: 1366, height: 768 },
		{ width: 390, height: 844 },
		{ width: 360, height: 800 },
		{ width: 320, height: 568 },
		{ width: 844, height: 390 }
	]) {
		await page.setViewportSize(viewport)
		await openPreview(page, "markers")
		const dimensions = await page.evaluate(() => {
			const doc = globalThis.document
			const getStyle = globalThis.getComputedStyle
			const visibleButton = [...doc.querySelectorAll("#toolbar > button, #toolbar > details")]
				.find((element) => getStyle(element).display !== "none")
			const image = visibleButton.querySelector("img")
			const aside = doc.querySelector("body > aside")
			const role = doc.querySelector(".role")
			const log = doc.querySelector("#log")
			const prompt = doc.querySelector("#prompt")
			return {
				button: visibleButton.getBoundingClientRect().width,
				image: image.getBoundingClientRect().width,
				aside: Number.parseFloat(getStyle(aside).width),
				roleFont: getStyle(role).fontSize,
				roleLine: getStyle(role).lineHeight,
				logFont: getStyle(log).fontSize,
				logLine: getStyle(log).lineHeight,
				promptFont: getStyle(prompt).fontSize,
				promptLine: getStyle(prompt).lineHeight
			}
		})
		expect(dimensions.button).toBe(44)
		expect(dimensions.image).toBe(44)
		expect(dimensions.roleFont).toBe("16px")
		expect(dimensions.roleLine).toBe("24px")
		expect(dimensions.logFont).toBe("12px")
		expect(dimensions.logLine).toBe("18px")
		expect(dimensions.promptFont).toBe("18px")
		expect(dimensions.promptLine).toBe("22px")
		expect(dimensions.aside).toBe(viewport.width <= 400 ? viewport.width : 212)
	}
})

test("combat log is one continuous PUG faction group", async ({ page }) => {
	await openPreview(page, "combat-result")
	if (page.viewportSize().width <= 800) await page.locator("#log_button").click()
	const groupHeader = page.locator("#log .group.h4.cp").last()
	await expect(groupHeader).toContainText("战斗")
	await expect(page.locator("#log .group.cp.bold")).toHaveCount(2)
	expect(await page.locator("#log .group.cp.detail").count()).toBeGreaterThan(2)
	await expect(page.locator("#log .log-unit.cp-unit").first()).toBeVisible()
	await expect(page.locator("#log .log-unit.ap-unit").first()).toBeVisible()
	if (page.viewportSize().width <= 800) {
		await page.locator("#log .log-unit.cp-unit").first().click()
		await expect(page.locator("body > aside")).toBeHidden()
	}
})

test("PUG dice render all supported log formats with a readable fallback", async ({ page }) => {
	await openPreview(page, "combat-result")
	if (page.viewportSize().width <= 800) await page.locator("#log_button").click()
	await expect(page.locator("#log .die.cp.d6")).toHaveCount(1)
	await expect(page.locator("#log .die.ap.d2")).toHaveCount(1)
	await page.evaluate(() => {
		const log = document.querySelector("#log")
		log.append(window.on_log("#ap 骰子 W3、B4、⚄、[[die:ap:1]]", 9999))
	})
	await expect(page.locator("#log .die.ap.d3")).toHaveCount(1)
	await expect(page.locator("#log .die.cp.d4")).toHaveCount(1)
	await expect(page.locator("#log .die.d5")).toHaveCount(1)
	await expect(page.locator("#log .die.ap.d1")).toHaveCount(1)
	const sprite = await page.locator("#log .die.cp.d6").evaluate((element) => ({
		image: window.getComputedStyle(element).backgroundImage,
		position: window.getComputedStyle(element).backgroundPosition,
		label: element.getAttribute("aria-label")
	}))
	expect(sprite.image).toContain("die_black_pips.svg")
	expect(sprite.position).toContain("100%")
	expect(sprite.label).toBe("同盟国骰点 6")
	await page.evaluate(() => document.documentElement.classList.remove("dice-sprite-ready"))
	const fallback = await page.locator("#log .die.cp.d6").evaluate((element) => ({
		text: element.textContent,
		color: window.getComputedStyle(element).color,
		fontSize: window.getComputedStyle(element).fontSize
	}))
	expect(fallback.text).toBe("6")
	expect(fallback.color).not.toBe("rgba(0, 0, 0, 0)")
	expect(fallback.fontSize).not.toBe("0px")
})

test("card panels follow map zoom within readable bounds outside map panning", async ({ page }) => {
	await openPreview(page, "action-card")
	const before = await page.locator("#cards .card-thumb").first().evaluate(() => {
		const panels = globalThis.document.querySelector("#board-panels")
		return {
			panelParent: panels.parentElement.tagName,
			insideTransform: Boolean(panels.closest("#pan_zoom_main")),
			scaleMode: panels.dataset.scaleMode
		}
	})
	expect(before.panelParent).toBe("MAIN")
	expect(before.insideTransform).toBe(false)
	expect(before.scaleMode).toBe("adaptive")

	for (const sample of [
		{ pan: 0.5, fit: 1, scale: 0.72 },
		{ pan: 0.9, fit: 0.8, scale: 0.72 },
		{ pan: 1, fit: 1, scale: 1 },
		{ pan: 1.2, fit: 1, scale: 1.2 },
		{ pan: 1.5, fit: 1, scale: 1.2 }
	]) {
		await page.evaluate(({ pan, fit }) => {
			const inner = document.querySelector("#pan_zoom_main")
			const mapwrap = document.querySelector("#mapwrap")
			inner.dataset.scale = String(pan)
			mapwrap.dataset.scale = String(fit)
		}, sample)
		await expect.poll(() => page.locator("#board-panels").getAttribute("data-card-scale"))
			.toBe(sample.scale.toFixed(4))
		const card = await page.locator("#cards .card-thumb").first().boundingBox()
		expect(card.width).toBeCloseTo(250 * sample.scale, 1)
		expect(card.height).toBeCloseTo(340 * sample.scale, 1)
	}
})

test("@visual PUG marker board baseline", async ({ page }) => {
	await openPreview(page, "markers")
	await expect(page).toHaveScreenshot("markers.png", {
		animations: "disabled",
		maxDiffPixelRatio: 0.015
	})
})

test("@visual PUG combat-card baseline", async ({ page }) => {
	await openPreview(page, "combat")
	await page.locator("#cc-list").scrollIntoViewIfNeeded()
	await expect(page).toHaveScreenshot("combat.png", {
		animations: "disabled",
		maxDiffPixelRatio: 0.015
	})
})
