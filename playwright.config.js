"use strict"

const { defineConfig } = require("@playwright/test")
const port = Number(process.env.EOG_E2E_PORT || 8765)
const baseURL = `http://127.0.0.1:${port}`

module.exports = defineConfig({
	testDir: "./tests/e2e",
	testMatch: "**/*.spec.js",
	fullyParallel: false,
	workers: 1,
	retries: 0,
	timeout: 30_000,
	expect: { timeout: 8_000 },
	use: {
		baseURL,
		browserName: "chromium",
		colorScheme: "light",
		locale: "zh-CN",
		timezoneId: "Asia/Shanghai",
		screenshot: "only-on-failure"
	},
	projects: [
		{ name: "desktop", use: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 } },
		{ name: "laptop", use: { viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 } },
		{ name: "mobile", use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 } },
		{ name: "retina", use: { viewport: { width: 1366, height: 768 }, deviceScaleFactor: 2 } }
	],
	webServer: {
		command: "node tools/e2e_server.mjs",
		url: `${baseURL}/.preview.html`,
		reuseExistingServer: true,
		timeout: 120_000
	}
})
