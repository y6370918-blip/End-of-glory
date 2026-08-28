import { spawnSync } from "node:child_process"

const result = spawnSync(process.execPath, ["--test", "tests/fuzz.test.js", "tests/late_war.test.js"], {
	cwd: process.cwd(),
	env: {
		...process.env,
		EOG_FUZZ_TARGET_TURN: "15",
		EOG_FUZZ_STEPS: process.env.EOG_FUZZ_STEPS || "12000"
	},
	stdio: "inherit"
})

process.exit(result.status ?? 1)
