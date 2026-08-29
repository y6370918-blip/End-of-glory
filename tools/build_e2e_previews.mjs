import { spawnSync } from "node:child_process"

for (const scenario of ["default", "action-card", "movement", "markers", "combat-choice", "combat", "combat-result"]) {
	const result = spawnSync(process.execPath, ["tools/build_preview.mjs", scenario], {
		cwd: process.cwd(),
		stdio: "inherit"
	})
	if (result.status !== 0) process.exit(result.status ?? 1)
}
