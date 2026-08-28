import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';

export default ts.config(
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs['flat/recommended'],
	{
		languageOptions: {
			globals: { ...globals.browser }
		}
	},
	{
		// The e2e harness runs in Node, not the browser: Playwright's config, its setup
		// script and the specs all read `process`.
		files: ['playwright.config.ts', 'tests/**'],
		languageOptions: {
			globals: { ...globals.node }
		}
	},
	{
		files: ['**/*.svelte'],
		languageOptions: {
			parserOptions: { parser: ts.parser }
		}
	},
	{
		ignores: ['build/', '.svelte-kit/', 'dist/', 'playwright-report/', 'test-results/']
	}
);
