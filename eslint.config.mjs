import globals from "globals";
import pluginJs from "@eslint/js";
import eslintRecommended from 'eslint-plugin-eslint-recommended';
import nodePlugin from 'eslint-plugin-n';

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    plugins: {
      'eslint-recommended': eslintRecommended,
      n: nodePlugin,
    },
    rules: {
      ...eslintRecommended.configs.recommended.rules,
      ...nodePlugin.configs['recommended-script'].rules,
    },
    languageOptions: {
      globals: {
        ...nodePlugin.configs['recommended-script'].languageOptions.globals,
      },
      sourceType: 'module',
    },
  },
];