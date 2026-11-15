module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: "./tsconfig-tests.json" }],
  },
  setupFiles: ["./jestSetup.js"],
};
