CREATE TABLE IF NOT EXISTS sessions (
    id            TEXT PRIMARY KEY,
    session_id    TEXT NOT NULL UNIQUE,
    cwd           TEXT NOT NULL,
    git_branch    TEXT,
    claude_version TEXT,
    model         TEXT,
    input_tokens  INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens INTEGER NOT NULL DEFAULT 0,
    duration_seconds INTEGER,
    started_at    TEXT NOT NULL,
    ended_at      TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_sessions_ended_at ON sessions(ended_at);
CREATE INDEX IF NOT EXISTS idx_sessions_cwd ON sessions(cwd);

CREATE TABLE IF NOT EXISTS tool_calls (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id    TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
    tool_name     TEXT NOT NULL,
    call_count    INTEGER NOT NULL DEFAULT 0,
    UNIQUE(session_id, tool_name)
);

CREATE INDEX IF NOT EXISTS idx_tool_calls_tool_name ON tool_calls(tool_name);
CREATE INDEX IF NOT EXISTS idx_tool_calls_session_id ON tool_calls(session_id);
