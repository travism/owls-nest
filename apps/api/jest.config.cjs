// Two-project setup: unit tests live next to source as *.spec.ts;
// e2e tests live under test/ as *.e2e-spec.ts and boot the full Nest app.

const TRANSFORM_IGNORE = ['node_modules/(?!.*(otplib|@otplib|@scure|@noble))'];

/** @type {import('jest').Config} */
module.exports = {
  rootDir: '.',
  projects: [
    {
      displayName: 'unit',
      testEnvironment: 'node',
      moduleFileExtensions: ['js', 'json', 'ts'],
      rootDir: '.',
      testRegex: 'src/.*\\.spec\\.ts$',
      transform: { '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
      transformIgnorePatterns: TRANSFORM_IGNORE,
    },
    {
      displayName: 'e2e',
      testEnvironment: 'node',
      moduleFileExtensions: ['js', 'json', 'ts'],
      rootDir: '.',
      testRegex: 'test/.*\\.e2e-spec\\.ts$',
      transform: { '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
      transformIgnorePatterns: TRANSFORM_IGNORE,
    },
  ],
};
