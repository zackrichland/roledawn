import type { PGlite } from "@electric-sql/pglite";
export function createMigratedDatabase(options?: { log?: (message: string) => void }): Promise<{ db: PGlite; migrations: string[] }>;
