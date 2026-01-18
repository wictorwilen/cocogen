export { main } from "./cli.js";

// TypeSpec decorator implementations.
// These are invoked by the TypeSpec compiler when a .tsp file imports this package.
export * from "./typespec/decorators.js";
export * from "./typespec/state.js";
