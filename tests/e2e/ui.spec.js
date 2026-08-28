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
	await expect(page.locator("body")).toHaveClass(/eog/)
	await expect(page.locator("#roles .role")).toHaveCount(2)
	await expect(page.locator("#marker-layer").locator(".track-marker, .map-marker").first()).toBeVisible()
	await page.locator("#info-menu > summary").click()
	await page.locator("#show-score").click()
	await expect(page.locator("#overview-window")).toBeVisible()
	const box = await page.locator("#overview-window").boundingBox()
	const viewport = page.viewportSize()
	expect(box.x).toBeGreaterThanOrEqual(0)
	expect(box.y).toBeGreaterThanOrEqual(0)
	expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1)
	expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1)
	await page.locator("#overview-window .info-window-close").click()
	await expect(page.locator("#overview-window")).toBeHidden()
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
	await expect(page.locator("#combat-zone")).toBeVisible()
	const legalCard = page.locator("#combat-cards-available .combat-card.legal").first()
	await expect(legalCard).toBeVisible()
	await legalCard.dispatchEvent("click")
	await expect(page.locator("#status")).toContainText("视觉预览不会写入服务器：combat_card")
})

test("action cards use the PUG popup with legal and disabled choices", async ({ page }) => {
	await openPreview(page, "action-card")
	const legalCard = page.locator("#hand .card-thumb.legal").first()
	await expect(legalCard).toBeVisible()
	await legalCard.dispatchEvent("click")
	await expect(page.locator("#card-popup")).toBeVisible()
	await expect(page.locator("#card-popup li.title")).toHaveCount(1)
	await expect(page.locator("#card-popup li.action, #card-popup li.disabled")).toHaveCount(4)
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
	await page.locator("#combat-zone").scrollIntoViewIfNeeded()
	await expect(page).toHaveScreenshot("combat.png", {
		animations: "disabled",
		maxDiffPixelRatio: 0.015
	})
})
