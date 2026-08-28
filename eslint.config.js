"use strict"

const js = require("@eslint/js")

module.exports = [
	{
		ignores: ["data.js", "assets/**", "data/generated/**"]
	},
	js.configs.recommended,
	{
		files: ["**/*.js"],
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: "commonjs",
			globals: {
				module: "readonly",
				require: "readonly",
				exports: "writable",
				process: "readonly",
				console: "readonly",
				window: "readonly",
				document: "readonly",
				confirm: "readonly",
				__dirname: "readonly"
			}
		},
		rules: {
			"no-unused-vars": ["error", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],
			"no-constant-condition": "off"
		}
	},
	{
		files: ["**/*.mjs"],
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: "module",
			globals: {
				process: "readonly",
				console: "readonly",
				URL: "readonly"
			}
		},
		rules: {
			"no-unused-vars": ["error", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],
			"no-constant-condition": "off"
		}
	}
]
