module.exports = {
  clearMocks: true,
  moduleFileExtensions: ["js", "json", "ts"],
  preset: "ts-jest",
  rootDir: ".",
  testEnvironment: "node",
  testMatch: ["<rootDir>/test/**/*.spec.ts"]
};
