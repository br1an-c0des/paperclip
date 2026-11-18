import { pgTable, uuid, text, timestamp, jsonb, integer, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

/**
 * A time-limited allow for one access action on one resource, checked after an agent's level and
 * overrides (fork/step-4a-mcp-and-permissions.md, section 2). `uses_left` is 1 for an approved
 * permission request's replay and null for a standing grant that lasts until it expires.
 */
export const temporaryAccessGrants = pgTable(
  "temporary_access_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    principalType: text("principal_type").$type<"agent" | "user">().notNull(),
    principalId: text("principal_id").notNull(),
    action: text("action").notNull(),
    resource: jsonb("resource").$type<{ type: "issue" | "agent" | "project" | "company"; id: string }>().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    reason: text("reason").notNull(),
    usesLeft: integer("uses_left"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("temporary_access_grants_principal_action_idx").on(
      table.companyId,
      table.principalType,
      table.principalId,
      table.action,
    ),
  ],
);
