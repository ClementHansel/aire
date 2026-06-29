/**
 * Shared type definitions for the AIRE Operations Platform.
 * Re-exports from enums and interfaces for backwards compatibility.
 */

// Re-export the Role enum as a type alias for consumers using the string literal pattern
export type { JWTPayload } from '../interfaces/auth';
export { Role } from '../enums';
