import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { createSchema, SCHEMA_VERSION } from "./schema.js";

describe("createSchema", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("should create all required tables", () => {
    createSchema(db);

    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];

    const tableNames = tables.map(t => t.name);

    expect(tableNames).toContain("sessions");
    expect(tableNames).toContain("agents");
    expect(tableNames).toContain("spans");
    expect(tableNames).toContain("tool_calls");
    expect(tableNames).toContain("events");
    expect(tableNames).toContain("schema_version");
  });

  it("should set schema version", () => {
    createSchema(db);

    const row = db.query("SELECT version FROM schema_version").get() as { version: number };

    expect(row.version).toBe(SCHEMA_VERSION);
  });
});
