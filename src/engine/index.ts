/**
 * The deterministic insight engine — design spec §9.
 *
 * Nothing in here calls an LLM, uses randomness, or reads the clock. "Today" is a
 * parameter on every entry point, which is what makes every projection reproducible
 * and every test a fixed-point assertion rather than a snapshot of when it ran.
 */

export * from './cadence'
export * from './cash-flow'
export * from './confidence'
export * from './debt-map'
export * from './price-step'
export * from './recurring'
export * from './tolerance'
