// Jest configuration. Kept in code rather than package.json so that paths into
// node_modules are resolved, not hard-coded: npm places expo-modules-core under
// expo/node_modules or at the top level depending on what else is installed,
// and a fixed path made every suite fail on the other layout.
const path = require('node:path');

/** The expo-modules-core that `expo` itself loads, wherever npm put it. */
const expoModulesCore = path.dirname(
  require.resolve('expo-modules-core/package.json', { paths: [path.dirname(require.resolve('expo/package.json'))] }),
);

/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/__tests__/**/*.test.ts?(x)'],
  moduleNameMapper: {
    '^@shared/(.*)$': '<rootDir>/src/shared/$1',
    '^@entities/(.*)$': '<rootDir>/src/entities/$1',
    '^@features/(.*)$': '<rootDir>/src/features/$1',
    '^@widgets/(.*)$': '<rootDir>/src/widgets/$1',
    '^@pages/(.*)$': '<rootDir>/src/pages/$1',
    '^@core/(.*)$': '<rootDir>/src/core/$1',
    '^@contracts/(.*)$': '<rootDir>/supabase/functions/_shared/contracts/$1',
    '^@db$': '<rootDir>/supabase/functions/_shared/database.types.ts',
    '^@domain/(.*)$': '<rootDir>/supabase/functions/_shared/domain/$1',
    '^expo-modules-core$': expoModulesCore,
    '^expo-modules-core/(.*)$': `${expoModulesCore}/$1`,
  },
  setupFiles: ['<rootDir>/jest.setup.ts'],
};
