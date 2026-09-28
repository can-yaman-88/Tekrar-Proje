// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const boundaries = require('eslint-plugin-boundaries');

// Feature-Sliced Design: a layer may only import from layers below it.
const LAYERS = ['routes', 'core', 'pages', 'widgets', 'features', 'entities', 'shared', 'contracts'];
const below = (layer) => LAYERS.slice(LAYERS.indexOf(layer) + 1);

module.exports = defineConfig([
  expoConfig,
  { ignores: ['dist/*', '.expo/*', 'supabase/functions/**'] },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { boundaries },
    settings: {
      'import/resolver': { typescript: { project: './tsconfig.json' } },
      'boundaries/elements': [
        { type: 'routes', pattern: 'src/app' },
        { type: 'core', pattern: 'src/core' },
        { type: 'pages', pattern: 'src/pages/*', capture: ['slice'] },
        { type: 'widgets', pattern: 'src/widgets/*', capture: ['slice'] },
        { type: 'features', pattern: 'src/features/*', capture: ['slice'] },
        { type: 'entities', pattern: 'src/entities/*', capture: ['slice'] },
        { type: 'shared', pattern: 'src/shared' },
        { type: 'contracts', pattern: 'supabase/functions/_shared' },
      ],
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          policies: [
            ...LAYERS.map((layer) => ({
              from: { element: { type: layer } },
              allow: { to: { element: { types: { anyOf: below(layer) } } } },
            })),
            // Entities may reference the shared `course` entity (CourseRef).
            {
              from: { element: { type: 'entities' } },
              allow: { to: { element: { type: 'entities', captured: { slice: 'course' } } } },
            },
          ],
        },
      ],
      // Slices are consumed only through their public API (index.ts).
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@pages/*/*', '@widgets/*/*', '@features/*/*', '@entities/*/*'],
              message: 'Import from the slice public API (index.ts), not its internals.',
            },
          ],
        },
      ],
    },
  },
]);
