import { spawnSync } from "node:child_process"

const build = spawnSync(process.execPath, ["tools/build_e2e_previews.mjs"], {
	cwd: process.cwd(),
	stdio: "inherit"
})
if (build.status !== 0) process.exit(build.status ?? 1)

process.argv[2] = process.env.EOG_E2E_PORT || "8765"
await import("./dev_server.mjs")
