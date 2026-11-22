import js from '@eslint/js';
import globals from 'globals';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
    // Build output: bundles and copied assets inside the browser folders.
    globalIgnores(['node_modules', 'extension/dist', 'extension/chrome/*.js', 'extension/firefox/*.js']),
    {
        files: ['**/*.{js,mjs}'],
        extends: [js.configs.recommended],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: globals.browser,
        },
        rules: {
            'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
        },
    },
    {
        // Content script, worker/event page and popup see page globals plus
        // the WebExtension APIs (chrome.* / browser.*).
        files: ['extension/shared/**/*.js'],
        languageOptions: { globals: { ...globals.browser, ...globals.webextensions } },
    },
    {
        // Node scripts; the live checks also pass callbacks that run inside
        // the browser (page.evaluate), so browser and extension globals apply.
        files: ['extension/scripts/**/*.mjs', 'extension/*.config.js', 'eslint.config.js', 'tests/**/*.mjs'],
        languageOptions: { globals: { ...globals.node, ...globals.browser, ...globals.webextensions } },
    },
    {
        files: ['extension/tests/**/*.js'],
        languageOptions: { globals: { ...globals.node, ...globals.browser, ...globals.webextensions } },
    },
]);
