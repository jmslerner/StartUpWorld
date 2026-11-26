/**
 * Procedural low-poly props: furniture, stations, building pieces, décor
 * and the sign beside the door.
 *
 * Every factory returns a `PropHandle` (see props/shared.ts): a `group` whose
 * origin is on the floor at the centre of `footprint` with the prop's front
 * facing +Z, optional `update(dt, elapsed)` / `setGlow(0..1)`, a `dispose()`,
 * and prop-specific setters.
 */
export * from "./props/shared";
export * from "./props/parts";
export * from "./props/workstations";
export * from "./props/stations";
export * from "./props/building";
export * from "./props/decor";
export * from "./props/markers";
export * from "./props/signature";
export * from "./props/catalog";
