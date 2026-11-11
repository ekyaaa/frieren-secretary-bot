-- Frieren Discord Logbook Database Schema (SQLite / Postgres compatible)

CREATE TABLE IF NOT EXISTS users (
  discord_user_id TEXT PRIMARY KEY,
  discord_name_cache TEXT NOT NULL DEFAULT '',
  timezone TEXT NOT NULL DEFAULT 'Asia/Jakarta',
  home_guild_id TEXT,
  setup_status TEXT NOT NULL DEFAULT 'INCOMPLETE',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS guilds (
  guild_id TEXT PRIMARY KEY,
  name_cache TEXT NOT NULL DEFAULT '',
  owner_id_cache TEXT NOT NULL DEFAULT '',
  installed_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
);

CREATE TABLE IF NOT EXISTS guild_memberships (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  enrolled INTEGER NOT NULL DEFAULT 1,
  last_seen TEXT NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS guild_configs (
  guild_id TEXT PRIMARY KEY,
  checklist_channel_id TEXT,
  checklist_time TEXT,
  last_ping_time TEXT,
  days_json TEXT NOT NULL DEFAULT '[1,2,3,4,5]',
  mention_policy TEXT NOT NULL DEFAULT 'all-participants',
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT PRIMARY KEY,
  reminder_time TEXT NOT NULL DEFAULT '16:00',
  working_days_json TEXT NOT NULL DEFAULT '[1,2,3,4,5]',
  start_time TEXT NOT NULL DEFAULT '07:10',
  end_time TEXT NOT NULL DEFAULT '16:25',
  auto_submit_enabled INTEGER NOT NULL DEFAULT 0,
  timezone TEXT NOT NULL DEFAULT 'Asia/Jakarta',
  location_profile_id TEXT
);

CREATE TABLE IF NOT EXISTS dermaga_credentials (
  user_id TEXT PRIMARY KEY,
  username_encrypted TEXT NOT NULL,
  password_encrypted TEXT NOT NULL,
  last_validation_at TEXT,
  auth_status TEXT NOT NULL DEFAULT 'UNVALIDATED'
);

CREATE TABLE IF NOT EXISTS gemini_user_keys (
  user_id TEXT PRIMARY KEY,
  encrypted_key TEXT NOT NULL,
  key_fingerprint TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
);

CREATE TABLE IF NOT EXISTS agents (
  device_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  version TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  last_sync TEXT,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS agent_pairing_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  code_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  claimed_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS repositories (
  repo_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  branch_policy TEXT NOT NULL DEFAULT 'main',
  author_filter TEXT,
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS commit_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  target_date TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Jakarta',
  repositories_json TEXT NOT NULL,
  commits_json TEXT NOT NULL,
  digest TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  source_device_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS logbook_entries (
  entry_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  target_date TEXT NOT NULL,
  portal_account_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'NOT_DUE',
  active_revision_id TEXT,
  verified_at TEXT,
  portal_record_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, target_date, portal_account_id)
);

CREATE TABLE IF NOT EXISTS logbook_revisions (
  revision_id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  work_start TEXT NOT NULL,
  work_end TEXT NOT NULL,
  location TEXT NOT NULL,
  source TEXT NOT NULL,
  source_snapshot_id TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS delivery_events (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  discord_message_id TEXT,
  delivered_at TEXT,
  error_code TEXT,
  UNIQUE(entry_id, event_type)
);

CREATE TABLE IF NOT EXISTS submission_attempts (
  attempt_id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  portal_response_kind TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  error TEXT
);

CREATE TABLE IF NOT EXISTS evidences (
  evidence_id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL UNIQUE,
  screenshot_private_path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  verified_record_digest TEXT NOT NULL,
  captured_after_refresh_at TEXT NOT NULL,
  retention_until TEXT NOT NULL,
  evidence_status TEXT NOT NULL DEFAULT 'READY'
);

CREATE TABLE IF NOT EXISTS scheduled_jobs (
  job_id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL,
  execute_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  locked_until TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  last_error TEXT,
  dedup_key TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS guild_daily_checklists (
  guild_id TEXT NOT NULL,
  target_date TEXT NOT NULL,
  post_type TEXT NOT NULL, -- 'CHECKLIST' or 'FINAL_PING'
  post_message_id TEXT,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (guild_id, target_date, post_type)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  ip_address TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  session_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  csrf_token TEXT NOT NULL
);
