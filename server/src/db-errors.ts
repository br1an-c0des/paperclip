const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";
const MAX_CAUSE_DEPTH = 4;

/**
 * Recognizes a Postgres unique-constraint violation (SQLSTATE 23505).
 *
 * Drizzle wraps driver failures in its own `Failed query: ...` error, so the
 * Postgres error that carries the code and the constraint name is reachable
 * only through `cause` — inspecting the thrown error directly misses it. The
 * constraint name itself lands on `constraint_name` under postgres.js and on
 * `constraint` under node-postgres, and is not always surfaced at all, so fall
 * back to the driver message.
 */
export function isUniqueViolation(error: unknown, constraintName?: string): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current && typeof current === "object"; depth += 1) {
    const candidate = current as {
      code?: unknown;
      constraint?: unknown;
      constraint_name?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    if (candidate.code === UNIQUE_VIOLATION) {
      if (!constraintName) return true;
      const constraint = candidate.constraint ?? candidate.constraint_name;
      if (constraint === constraintName) return true;
      if (typeof candidate.message === "string" && candidate.message.includes(constraintName)) return true;
    }
    current = candidate.cause;
  }
  return false;
}

/**
 * Recognizes a Postgres foreign-key-constraint violation (SQLSTATE 23503).
 *
 * A delete that leaves an orphan reference raises this code. Drizzle wraps the
 * driver failure in its own `Failed query: ...` error, so the Postgres error
 * that carries the code is reachable only through `cause`. This helper walks
 * the `cause` chain, the same way `isUniqueViolation` does.
 */
export function isForeignKeyViolation(error: unknown): boolean {
  return foreignKeyViolation(error) !== null;
}

/**
 * The table and constraint of a foreign-key violation (SQLSTATE 23503), or
 * null when the error is not one. For a blocked delete, `table` is the
 * referencing table. postgres.js names the fields `table_name` and
 * `constraint_name`, node-postgres `table` and `constraint`; either may be
 * missing.
 */
export function foreignKeyViolation(
  error: unknown,
): { table: string | null; constraint: string | null } | null {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current && typeof current === "object"; depth += 1) {
    const candidate = current as {
      code?: unknown;
      cause?: unknown;
      table?: unknown;
      table_name?: unknown;
      constraint?: unknown;
      constraint_name?: unknown;
    };
    if (candidate.code === FOREIGN_KEY_VIOLATION) {
      const table = candidate.table_name ?? candidate.table;
      const constraint = candidate.constraint_name ?? candidate.constraint;
      return {
        table: typeof table === "string" ? table : null,
        constraint: typeof constraint === "string" ? constraint : null,
      };
    }
    current = candidate.cause;
  }
  return null;
}
