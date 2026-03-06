module.exports = {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  roots: ["<rootDir>/src", "<rootDir>/../tests/api"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  extensionsToTreatAsEsm: [".ts"],
  testMatch: ["**/*.test.ts"],
  // Start Mock Copilot Connect before tests; set COPILOT_URL in each worker.
  globalSetup: "<rootDir>/../tests/api/globalSetup.cjs",
  globalTeardown: "<rootDir>/../tests/api/globalTeardown.cjs",
  setupFiles: ["<rootDir>/../tests/api/setupEnv.cjs"],
};
