import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.json' }],
  },
  collectCoverageFrom: ['**/*.(t|j)s', '!**/*.spec.ts', '!**/index.ts'],
  coverageDirectory: '../coverage',
  reporters: ['default', ['jest-junit', { outputDirectory: '../coverage', outputName: 'junit.xml' }]],
  testEnvironment: 'node',
  clearMocks: true,
};

export default config;
