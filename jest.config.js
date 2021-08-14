module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  globals: {
    "ts-jest": {
      tsconfig: "./tsconfig-tests.json",
    },
  },
  setupFiles: ["./jestSetup.js"],
};
