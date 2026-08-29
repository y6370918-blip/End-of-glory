import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const bundled = path.join(
	os.homedir(),
	".cache",
	"codex-runtimes",
	"codex-primary-runtime",
	"dependencies",
	"python",
	"python.exe"
)
const candidates = [
	[process.env.PYTHON, []],
	["python", []],
	[fs.existsSync(bundled) ? bundled : null, []],
	["py", ["-3"]]
].filter(([command]) => command)

for (const [command, prefix] of candidates) {
	const result = spawnSync(command, [...prefix, "tools/build_assets.py"], {
		cwd: path.resolve(import.meta.dirname, ".."),
		stdio: "inherit",
		shell: false
	})
	if (!result.error && result.status === 0) process.exit(0)
	if (result.error?.code !== "ENOENT" && result.status !== 9009 && command !== "py")
		console.error(`Asset builder failed with ${command}; trying the next Python runtime.`)
}

throw new Error("Python 3 with Pillow is required to build image assets")
