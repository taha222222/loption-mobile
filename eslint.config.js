// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const globals = require('globals');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'coverage/*', 'web-build/*', '.expo/*'],
  },
  {
    // Flat config ignores `/* eslint-env jest */`; declare Jest globals here.
    files: ['jest.setup.js', '__tests__/**'],
    languageOptions: { globals: globals.jest },
  },
]);
