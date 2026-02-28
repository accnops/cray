import { Database } from "bun:sqlite";

export const SCHEMA_VERSION = 1;

export function createSchema(db: Database): void {
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");

  db.run(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      project_path TEXT NOT NULL,
      start_ts INTEGER NOT NULL,
      end_ts INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      total_input_tokens INTEGER DEFAULT 0,
      total_output_tokens INTEGER DEFAULT 0,
      total_cache_read_tokens INTEGER DEFAULT 0,
      total_cache_write_tokens INTEGER DEFAULT 0,
      estimated_cost_usd REAL DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS agents (
      agent_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(session_id),
      parent_agent_id TEXT,
      kind TEXT NOT NULL CHECK (kind IN ('main', 'subagent')),
      transcript_path TEXT NOT NULL,
      start_ts INTEGER NOT NULL,
      end_ts INTEGER NOT NULL,
      link_confidence REAL DEFAULT 1.0,
      total_input_tokens INTEGER DEFAULT 0,
      total_output_tokens INTEGER DEFAULT 0,
      estimated_cost_usd REAL DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS spans (
      span_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(session_id),
      agent_id TEXT NOT NULL REFERENCES agents(agent_id),
      parent_span_id TEXT,
      span_type TEXT NOT NULL,
      start_ts INTEGER NOT NULL,
      end_ts INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('success', 'error', 'unknown')),
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      cache_read_tokens INTEGER DEFAULT 0,
      cache_write_tokens INTEGER DEFAULT 0,
      model TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tool_calls (
      tool_call_id TEXT PRIMARY KEY,
      span_id TEXT NOT NULL REFERENCES spans(span_id),
      session_id TEXT NOT NULL REFERENCES sessions(session_id),
      agent_id TEXT NOT NULL REFERENCES agents(agent_id),
      tool_family TEXT NOT NULL CHECK (tool_family IN ('builtin', 'mcp')),
      tool_name TEXT NOT NULL,
      mcp_server TEXT,
      status TEXT NOT NULL CHECK (status IN ('success', 'error', 'unknown')),
      error_type TEXT,
      input_bytes INTEGER DEFAULT 0,
      output_bytes INTEGER DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS events (
      event_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(session_id),
      agent_id TEXT NOT NULL REFERENCES agents(agent_id),
      ts INTEGER NOT NULL,
      raw_type TEXT NOT NULL,
      norm_type TEXT NOT NULL,
      raw_line_no INTEGER NOT NULL,
      raw_json TEXT NOT NULL
    )
  `);

  // Create indexes
  db.run("CREATE INDEX IF NOT EXISTS idx_spans_session ON spans(session_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_spans_agent ON spans(agent_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_spans_ts ON spans(start_ts, end_ts)");
  db.run("CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls(session_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_tool_calls_tool ON tool_calls(tool_name)");
  db.run("CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts)");

  // Set schema version
  db.run("DELETE FROM schema_version");
  db.run("INSERT INTO schema_version (version) VALUES (?)", [SCHEMA_VERSION]);
}
