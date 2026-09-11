import js from '@eslint/js';
import globals from 'globals';

const commonRules = {
  'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
  'no-empty': ['warn', { allowEmptyCatch: true }],
  'no-useless-assignment': 'warn',
  'no-undef': 'error',
};

export default [
  { ignores: ['dist/**', 'node_modules/**', '.firebase/**'] },
  js.configs.recommended,
  {
    // Frontend (navegador + ES modules)
    files: ['public/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    rules: commonRules,
  },
  {
    // Backend, scripts y configuracion (Node)
    files: ['server/**/*.{js,mjs}', 'scripts/**/*.{js,mjs}', '*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: commonRules,
  },
  {
    // Tests
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: commonRules,
  },
];

