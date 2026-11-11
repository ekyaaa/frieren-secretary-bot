/**
 * Domain Repositories for Frieren Discord Logbook.
 * Implements data access patterns, encryption/decryption, and atomic operations.
 */

import { Database } from './database.ts';
import {
  encrypt,
  decrypt,
  hashSha256,
  generateDeviceToken,
  maskSecret,
} from './crypto.ts';
import type {
  User,
  Guild,
  GuildConfig,
  UserSettings,
  AgentDevice,
  CommitSnapshot,
  LogbookEntry,
  LogbookRevision,
  Evidence,
  SubmissionAttempt,
  ScheduledJob,
  AuditEvent,
  LogbookStatus,
  EvidenceStatus,
} from '../../contracts/src/types.ts';
import crypto from 'node:crypto';

export class UserRepository {
  private db: Database;
  constructor(db: Database) {
    this.db = db;
  }

  public getOrCreate(discordUserId: string, name: string = ''): User {
    const existing = this.db
      .prepare('SELECT * FROM users WHERE discord_user_id = ?')
      .get(discordUserId) as any;

    if (existing) {
      return this.mapUser(existing);
    }

    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO users (discord_user_id, discord_name_cache, timezone, home_guild_id, setup_status, created_at, updated_at)
         VALUES (?, ?, 'Asia/Jakarta', NULL, 'INCOMPLETE', ?, ?)`
      )
      .run(discordUserId, name, now, now);

    // Initialize default user settings as well
    this.db
      .prepare(
        `INSERT OR IGNORE INTO user_settings (user_id, reminder_time, working_days_json, start_time, end_time, auto_submit_enabled, timezone, location_profile_id)
         VALUES (?, '16:00', '[1,2,3,4,5]', '07:10', '16:25', 0, 'Asia/Jakarta', NULL)`
      )
      .run(discordUserId);

    return this.findById(discordUserId)!;
  }

  public findById(discordUserId: string): User | null {
    const row = this.db
      .prepare('SELECT * FROM users WHERE discord_user_id = ?')
      .get(discordUserId) as any;
    return row ? this.mapUser(row) : null;
  }

  public updateSetupStatus(discordUserId: string, status: 'INCOMPLETE' | 'READY'): void {
    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE users SET setup_status = ?, updated_at = ? WHERE discord_user_id = ?')
      .run(status, now, discordUserId);
  }

  public setHomeGuild(discordUserId: string, guildId: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE users SET home_guild_id = ?, updated_at = ? WHERE discord_user_id = ?')
      .run(guildId, now, discordUserId);
  }

  public listAll(): User[] {
    const rows = this.db.prepare('SELECT * FROM users ORDER BY created_at DESC').all() as any[];
    return rows.map((r) => this.mapUser(r));
  }

  private mapUser(row: any): User {
    return {
      discordUserId: row.discord_user_id,
      discordNameCache: row.discord_name_cache,
      timezone: row.timezone,
      homeGuildId: row.home_guild_id,
      setupStatus: row.setup_status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export class GuildRepository {
  private db: Database;
  constructor(db: Database) {
    this.db = db;
  }

  public upsertGuild(guildId: string, name: string = '', ownerId: string = ''): Guild {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO guilds (guild_id, name_cache, owner_id_cache, installed_at, status)
         VALUES (?, ?, ?, ?, 'ACTIVE')
         ON CONFLICT(guild_id) DO UPDATE SET
           name_cache = excluded.name_cache,
           owner_id_cache = excluded.owner_id_cache`
      )
      .run(guildId, name, ownerId, now);

    this.db
      .prepare(
        `INSERT OR IGNORE INTO guild_configs (guild_id, checklist_channel_id, checklist_time, last_ping_time, days_json, mention_policy, enabled)
         VALUES (?, NULL, '17:00', '18:30', '[1,2,3,4,5]', 'all-participants', 1)`
      )
      .run(guildId);

    return this.getGuild(guildId)!;
  }

  public getGuild(guildId: string): Guild | null {
    const row = this.db.prepare('SELECT * FROM guilds WHERE guild_id = ?').get(guildId) as any;
    if (!row) return null;
    return {
      guildId: row.guild_id,
      nameCache: row.name_cache,
      ownerIdCache: row.owner_id_cache,
      installedAt: row.installed_at,
      status: row.status,
    };
  }

  public enrollUser(guildId: string, userId: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO guild_memberships (guild_id, user_id, enrolled, last_seen)
         VALUES (?, ?, 1, ?)
         ON CONFLICT(guild_id, user_id) DO UPDATE SET enrolled = 1, last_seen = excluded.last_seen`
      )
      .run(guildId, userId, now);
  }

  public unenrollUser(guildId: string, userId: string): void {
    this.db
      .prepare('UPDATE guild_memberships SET enrolled = 0 WHERE guild_id = ? AND user_id = ?')
      .run(guildId, userId);
  }

  public getEnrolledUsers(guildId: string): string[] {
    const rows = this.db
      .prepare('SELECT user_id FROM guild_memberships WHERE guild_id = ? AND enrolled = 1')
      .all(guildId) as any[];
    return rows.map((r) => r.user_id);
  }

  public getGuildConfig(guildId: string): GuildConfig | null {
    const row = this.db.prepare('SELECT * FROM guild_configs WHERE guild_id = ?').get(guildId) as any;
    if (!row) return null;
    return {
      guildId: row.guild_id,
      checklistChannelId: row.checklist_channel_id,
      checklistTime: row.checklist_time,
      lastPingTime: row.last_ping_time,
      days: JSON.parse(row.days_json || '[1,2,3,4,5]'),
      mentionPolicy: row.mention_policy,
      enabled: row.enabled === 1,
    };
  }

  public saveGuildConfig(config: Partial<GuildConfig> & { guildId: string }): void {
    const current = this.getGuildConfig(config.guildId);
    const updated = { ...current, ...config };
    this.db
      .prepare(
        `INSERT INTO guild_configs (guild_id, checklist_channel_id, checklist_time, last_ping_time, days_json, mention_policy, enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(guild_id) DO UPDATE SET
           checklist_channel_id = excluded.checklist_channel_id,
           checklist_time = excluded.checklist_time,
           last_ping_time = excluded.last_ping_time,
           days_json = excluded.days_json,
           mention_policy = excluded.mention_policy,
           enabled = excluded.enabled`
      )
      .run(
        updated.guildId,
        updated.checklistChannelId ?? null,
        updated.checklistTime ?? null,
        updated.lastPingTime ?? null,
        JSON.stringify(updated.days ?? [1, 2, 3, 4, 5]),
        updated.mentionPolicy ?? 'all-participants',
        updated.enabled !== false ? 1 : 0
      );
  }

  public listAllGuilds(): Guild[] {
    const rows = this.db.prepare('SELECT * FROM guilds ORDER BY installed_at DESC').all() as any[];
    return rows.map((row) => ({
      guildId: row.guild_id,
      nameCache: row.name_cache,
      ownerIdCache: row.owner_id_cache,
      installedAt: row.installed_at,
      status: row.status,
    }));
  }
}

export class SettingsRepository {
  private db: Database;
  constructor(db: Database) {
    this.db = db;
  }

  public getSettings(userId: string): UserSettings {
    const row = this.db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId) as any;
    if (!row) {
      return {
        userId,
        reminderTime: '16:00',
        workingDays: [1, 2, 3, 4, 5],
        startTime: '07:10',
        endTime: '16:25',
        autoSubmitEnabled: false,
        timezone: 'Asia/Jakarta',
        locationProfileId: null,
      };
    }
    return {
      userId: row.user_id,
      reminderTime: row.reminder_time,
      workingDays: JSON.parse(row.working_days_json || '[1,2,3,4,5]'),
      startTime: row.start_time,
      endTime: row.end_time,
      autoSubmitEnabled: row.auto_submit_enabled === 1,
      timezone: row.timezone,
      locationProfileId: row.location_profile_id,
    };
  }

  public saveSettings(settings: Partial<UserSettings> & { userId: string }): UserSettings {
    const current = this.getSettings(settings.userId);
    const updated = { ...current, ...settings };
    this.db
      .prepare(
        `INSERT INTO user_settings (user_id, reminder_time, working_days_json, start_time, end_time, auto_submit_enabled, timezone, location_profile_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           reminder_time = excluded.reminder_time,
           working_days_json = excluded.working_days_json,
           start_time = excluded.start_time,
           end_time = excluded.end_time,
           auto_submit_enabled = excluded.auto_submit_enabled,
           timezone = excluded.timezone,
           location_profile_id = excluded.location_profile_id`
      )
      .run(
        updated.userId,
        updated.reminderTime,
        JSON.stringify(updated.workingDays),
        updated.startTime,
        updated.endTime,
        updated.autoSubmitEnabled ? 1 : 0,
        updated.timezone,
        updated.locationProfileId ?? null
      );
    return updated;
  }
}

export class CredentialRepository {
  private db: Database;
  constructor(db: Database) {
    this.db = db;
  }

  public saveDermagaCredentials(userId: string, username: string, pass: string, encKey: string): void {
    const userEnc = encrypt(username, encKey);
    const passEnc = encrypt(pass, encKey);
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO dermaga_credentials (user_id, username_encrypted, password_encrypted, last_validation_at, auth_status)
         VALUES (?, ?, ?, ?, 'VALID')
         ON CONFLICT(user_id) DO UPDATE SET
           username_encrypted = excluded.username_encrypted,
           password_encrypted = excluded.password_encrypted,
           last_validation_at = excluded.last_validation_at,
           auth_status = 'VALID'`
      )
      .run(userId, userEnc, passEnc, now);
  }

  public getDermagaCredentials(userId: string, encKey: string): { username: string; pass: string; status: string } | null {
    const row = this.db.prepare('SELECT * FROM dermaga_credentials WHERE user_id = ?').get(userId) as any;
    if (!row) return null;
    return {
      username: decrypt(row.username_encrypted, encKey),
      pass: decrypt(row.password_encrypted, encKey),
      status: row.auth_status,
    };
  }

  public saveGeminiKey(userId: string, key: string, encKey: string): void {
    const encryptedKey = encrypt(key, encKey);
    const fingerprint = maskSecret(key);
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO gemini_user_keys (user_id, encrypted_key, key_fingerprint, updated_at, status)
         VALUES (?, ?, ?, ?, 'ACTIVE')
         ON CONFLICT(user_id) DO UPDATE SET
           encrypted_key = excluded.encrypted_key,
           key_fingerprint = excluded.key_fingerprint,
           updated_at = excluded.updated_at,
           status = 'ACTIVE'`
      )
      .run(userId, encryptedKey, fingerprint, now);
  }

  public getGeminiKey(userId: string, encKey: string): { key: string; fingerprint: string; status: string } | null {
    const row = this.db.prepare('SELECT * FROM gemini_user_keys WHERE user_id = ?').get(userId) as any;
    if (!row) return null;
    return {
      key: decrypt(row.encrypted_key, encKey),
      fingerprint: row.key_fingerprint,
      status: row.status,
    };
  }

  public deleteCredentials(userId: string): void {
    this.db.prepare('DELETE FROM dermaga_credentials WHERE user_id = ?').run(userId);
    this.db.prepare('DELETE FROM gemini_user_keys WHERE user_id = ?').run(userId);
  }
}

export class AgentRepository {
  private db: Database;
  constructor(db: Database) {
    this.db = db;
  }

  public createPairingCode(userId: string, code: string, ttlMinutes: number = 5): void {
    const id = crypto.randomUUID();
    const codeHash = hashSha256(code);
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();

    this.db
      .prepare(
        `INSERT INTO agent_pairing_codes (id, user_id, code_hash, expires_at, claimed_at, attempts)
         VALUES (?, ?, ?, ?, NULL, 0)`
      )
      .run(id, userId, codeHash, expiresAt);
  }

  public claimPairingCode(code: string, deviceId: string, platform: 'win32' | 'linux' | 'darwin', version: string): { userId: string; bearerToken: string } | null {
    const codeHash = hashSha256(code);
    const row = this.db.prepare('SELECT * FROM agent_pairing_codes WHERE code_hash = ?').get(codeHash) as any;

    if (!row) return null;
    if (row.claimed_at) return null; // already claimed
    if (new Date(row.expires_at).getTime() < Date.now()) return null; // expired
    if (row.attempts >= 5) return null; // rate-limited

    const token = generateDeviceToken();
    const tokenHash = hashSha256(token);
    const now = new Date().toISOString();

    return this.db.transaction(() => {
      this.db.prepare('UPDATE agent_pairing_codes SET claimed_at = ? WHERE id = ?').run(now, row.id);

      this.db
        .prepare(
          `INSERT INTO agents (device_id, user_id, platform, version, token_hash, last_seen, last_sync, revoked_at)
           VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)
           ON CONFLICT(device_id) DO UPDATE SET
             platform = excluded.platform,
             version = excluded.version,
             token_hash = excluded.token_hash,
             last_seen = excluded.last_seen,
             revoked_at = NULL`
        )
        .run(deviceId, row.user_id, platform, version, tokenHash, now);

      return {
        userId: row.user_id,
        bearerToken: token,
      };
    });
  }

  public getDeviceByTokenHash(tokenHash: string): AgentDevice | null {
    const row = this.db.prepare('SELECT * FROM agents WHERE token_hash = ? AND revoked_at IS NULL').get(tokenHash) as any;
    if (!row) return null;
    return this.mapDevice(row);
  }

  public getDevice(deviceId: string): AgentDevice | null {
    const row = this.db.prepare('SELECT * FROM agents WHERE device_id = ?').get(deviceId) as any;
    if (!row) return null;
    return this.mapDevice(row);
  }

  public updateHeartbeat(deviceId: string, version?: string): void {
    const now = new Date().toISOString();
    if (version) {
      this.db.prepare('UPDATE agents SET last_seen = ?, version = ? WHERE device_id = ?').run(now, version, deviceId);
    } else {
      this.db.prepare('UPDATE agents SET last_seen = ? WHERE device_id = ?').run(now, deviceId);
    }
  }

  public revokeDevice(deviceId: string): void {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE agents SET revoked_at = ? WHERE device_id = ?').run(now, deviceId);
  }

  public listUserDevices(userId: string): AgentDevice[] {
    const rows = this.db.prepare('SELECT * FROM agents WHERE user_id = ? ORDER BY last_seen DESC').all(userId) as any[];
    return rows.map((r) => this.mapDevice(r));
  }

  public saveSnapshot(snapshot: CommitSnapshot): void {
    this.db
      .prepare(
        `INSERT INTO commit_snapshots (snapshot_id, user_id, target_date, timezone, repositories_json, commits_json, digest, captured_at, source_device_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(snapshot_id) DO NOTHING`
      )
      .run(
        snapshot.snapshotId,
        snapshot.userId,
        snapshot.targetDate,
        snapshot.timezone,
        JSON.stringify(snapshot.repositories),
        JSON.stringify(snapshot.commits),
        snapshot.digest,
        snapshot.capturedAt,
        snapshot.sourceDeviceId
      );

    const now = new Date().toISOString();
    this.db.prepare('UPDATE agents SET last_sync = ?, last_seen = ? WHERE device_id = ?').run(now, now, snapshot.sourceDeviceId);
  }

  public getLatestSnapshot(userId: string, targetDate: string): CommitSnapshot | null {
    const row = this.db
      .prepare('SELECT * FROM commit_snapshots WHERE user_id = ? AND target_date = ? ORDER BY captured_at DESC LIMIT 1')
      .get(userId, targetDate) as any;
    if (!row) return null;
    return {
      snapshotId: row.snapshot_id,
      userId: row.user_id,
      targetDate: row.target_date,
      timezone: row.timezone,
      repositories: JSON.parse(row.repositories_json || '[]'),
      commits: JSON.parse(row.commits_json || '[]'),
      digest: row.digest,
      capturedAt: row.captured_at,
      sourceDeviceId: row.source_device_id,
    };
  }

  private mapDevice(row: any): AgentDevice {
    return {
      deviceId: row.device_id,
      userId: row.user_id,
      platform: row.platform,
      version: row.version,
      tokenHash: row.token_hash,
      lastSeen: row.last_seen,
      lastSync: row.last_sync,
      revokedAt: row.revoked_at,
    };
  }
}

export class LogbookRepository {
  private db: Database;
  constructor(db: Database) {
    this.db = db;
  }

  public getOrCreateEntry(userId: string, targetDate: string, portalAccountId: string): LogbookEntry {
    const existing = this.db
      .prepare('SELECT * FROM logbook_entries WHERE user_id = ? AND target_date = ? AND portal_account_id = ?')
      .get(userId, targetDate, portalAccountId) as any;

    if (existing) {
      return this.mapEntry(existing);
    }

    const entryId = crypto.randomUUID();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO logbook_entries (entry_id, user_id, target_date, portal_account_id, status, active_revision_id, verified_at, portal_record_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'NOT_DUE', NULL, NULL, NULL, ?, ?)`
      )
      .run(entryId, userId, targetDate, portalAccountId, now, now);

    return this.getEntry(entryId)!;
  }

  public getEntry(entryId: string): LogbookEntry | null {
    const row = this.db.prepare('SELECT * FROM logbook_entries WHERE entry_id = ?').get(entryId) as any;
    return row ? this.mapEntry(row) : null;
  }

  public getEntryByUserAndDate(userId: string, targetDate: string): LogbookEntry | null {
    const row = this.db.prepare('SELECT * FROM logbook_entries WHERE user_id = ? AND target_date = ?').get(userId, targetDate) as any;
    return row ? this.mapEntry(row) : null;
  }

  public updateStatus(entryId: string, status: LogbookStatus, verifiedAt?: string, portalRecordId?: string): void {
    const now = new Date().toISOString();
    if (status === 'VERIFIED') {
      const vAt = verifiedAt || now;
      this.db
        .prepare('UPDATE logbook_entries SET status = ?, verified_at = ?, portal_record_id = COALESCE(?, portal_record_id), updated_at = ? WHERE entry_id = ?')
        .run(status, vAt, portalRecordId ?? null, now, entryId);
    } else {
      this.db
        .prepare('UPDATE logbook_entries SET status = ?, updated_at = ? WHERE entry_id = ?')
        .run(status, now, entryId);
    }
  }

  public createRevision(revision: Omit<LogbookRevision, 'createdAt'>): LogbookRevision {
    const now = new Date().toISOString();
    return this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO logbook_revisions (revision_id, entry_id, summary, work_start, work_end, location, source, source_snapshot_id, approved_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          revision.revisionId,
          revision.entryId,
          revision.summary,
          revision.workStart,
          revision.workEnd,
          revision.location,
          revision.source,
          revision.sourceSnapshotId ?? null,
          revision.approvedAt ?? null,
          now
        );

      this.db
        .prepare('UPDATE logbook_entries SET active_revision_id = ?, updated_at = ? WHERE entry_id = ?')
        .run(revision.revisionId, now, revision.entryId);

      return {
        ...revision,
        createdAt: now,
      };
    });
  }

  public getRevision(revisionId: string): LogbookRevision | null {
    const row = this.db.prepare('SELECT * FROM logbook_revisions WHERE revision_id = ?').get(revisionId) as any;
    if (!row) return null;
    return {
      revisionId: row.revision_id,
      entryId: row.entry_id,
      summary: row.summary,
      workStart: row.work_start,
      workEnd: row.work_end,
      location: row.location,
      source: row.source,
      sourceSnapshotId: row.source_snapshot_id,
      approvedAt: row.approved_at,
      createdAt: row.created_at,
    };
  }

  public getActiveRevision(entryId: string): LogbookRevision | null {
    const entry = this.getEntry(entryId);
    if (!entry || !entry.activeRevisionId) return null;
    return this.getRevision(entry.activeRevisionId);
  }

  public recordDeliveryEvent(entryId: string, eventType: string, discordMessageId?: string, deliveredAt?: string, errorCode?: string): void {
    const id = crypto.randomUUID();
    this.db
      .prepare(
        `INSERT INTO delivery_events (id, entry_id, event_type, discord_message_id, delivered_at, error_code)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(entry_id, event_type) DO UPDATE SET
           discord_message_id = excluded.discord_message_id,
           delivered_at = excluded.delivered_at,
           error_code = excluded.error_code`
      )
      .run(id, entryId, eventType, discordMessageId ?? null, deliveredAt ?? null, errorCode ?? null);
  }

  public createSubmissionAttempt(attempt: Omit<SubmissionAttempt, 'startedAt'>): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO submission_attempts (attempt_id, entry_id, revision_id, idempotency_key, portal_response_kind, started_at, completed_at, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        attempt.attemptId,
        attempt.entryId,
        attempt.revisionId,
        attempt.idempotencyKey,
        attempt.portalResponseKind,
        now,
        attempt.completedAt ?? null,
        attempt.error ?? null
      );
  }

  public saveEvidence(evidence: Evidence): void {
    this.db
      .prepare(
        `INSERT INTO evidences (evidence_id, entry_id, screenshot_private_path, sha256, verified_record_digest, captured_after_refresh_at, retention_until, evidence_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(entry_id) DO UPDATE SET
           screenshot_private_path = excluded.screenshot_private_path,
           sha256 = excluded.sha256,
           verified_record_digest = excluded.verified_record_digest,
           captured_after_refresh_at = excluded.captured_after_refresh_at,
           retention_until = excluded.retention_until,
           evidence_status = excluded.evidence_status`
      )
      .run(
        evidence.evidenceId,
        evidence.entryId,
        evidence.screenshotPrivatePath,
        evidence.sha256,
        evidence.verifiedRecordDigest,
        evidence.capturedAfterRefreshAt,
        evidence.retentionUntil,
        evidence.evidenceStatus
      );
  }

  public getEvidence(entryId: string): Evidence | null {
    const row = this.db.prepare('SELECT * FROM evidences WHERE entry_id = ?').get(entryId) as any;
    if (!row) return null;
    return {
      evidenceId: row.evidence_id,
      entryId: row.entry_id,
      screenshotPrivatePath: row.screenshot_private_path,
      sha256: row.sha256,
      verifiedRecordDigest: row.verified_record_digest,
      capturedAfterRefreshAt: row.captured_after_refresh_at,
      retentionUntil: row.retention_until,
      evidenceStatus: row.evidence_status,
    };
  }

  public listEntries(limit: number = 50, offset: number = 0): LogbookEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM logbook_entries ORDER BY target_date DESC, created_at DESC LIMIT ? OFFSET ?')
      .all(limit, offset) as any[];
    return rows.map((r) => this.mapEntry(r));
  }

  private mapEntry(row: any): LogbookEntry {
    return {
      entryId: row.entry_id,
      userId: row.user_id,
      targetDate: row.target_date,
      portalAccountId: row.portal_account_id,
      status: row.status,
      activeRevisionId: row.active_revision_id,
      verifiedAt: row.verified_at,
      portalRecordId: row.portal_record_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export class JobQueueRepository {
  private db: Database;
  constructor(db: Database) {
    this.db = db;
  }

  public enqueueJob(
    jobType: ScheduledJob['jobType'],
    executeAt: string,
    payload: Record<string, unknown>,
    dedupKey?: string,
    maxAttempts: number = 3
  ): ScheduledJob {
    const jobId = crypto.randomUUID();
    const payloadJson = JSON.stringify(payload);

    this.db
      .prepare(
        `INSERT INTO scheduled_jobs (job_id, job_type, execute_at, payload_json, status, locked_until, attempts, max_attempts, last_error, dedup_key)
         VALUES (?, ?, ?, ?, 'PENDING', NULL, 0, ?, NULL, ?)
         ON CONFLICT(dedup_key) DO UPDATE SET
           execute_at = excluded.execute_at,
           payload_json = excluded.payload_json,
           status = 'PENDING',
           locked_until = NULL`
      )
      .run(jobId, jobType, executeAt, payloadJson, maxAttempts, dedupKey ?? null);

    return this.getJob(jobId)!;
  }

  public getJob(jobId: string): ScheduledJob | null {
    const row = this.db.prepare('SELECT * FROM scheduled_jobs WHERE job_id = ?').get(jobId) as any;
    return row ? this.mapJob(row) : null;
  }

  public lockNextJob(now: string = new Date().toISOString(), lockSeconds: number = 60): ScheduledJob | null {
    return this.db.transaction(() => {
      const candidate = this.db
        .prepare(
          `SELECT * FROM scheduled_jobs
           WHERE status = 'PENDING'
             AND execute_at <= ?
             AND (locked_until IS NULL OR locked_until < ?)
             AND attempts < max_attempts
           ORDER BY execute_at ASC
           LIMIT 1`
        )
        .get(now, now) as any;

      if (!candidate) return null;

      const lockedUntil = new Date(Date.now() + lockSeconds * 1000).toISOString();
      this.db
        .prepare("UPDATE scheduled_jobs SET status = 'LOCKED', locked_until = ?, attempts = attempts + 1 WHERE job_id = ?")
        .run(lockedUntil, candidate.job_id);

      return this.mapJob({
        ...candidate,
        status: 'LOCKED',
        locked_until: lockedUntil,
        attempts: candidate.attempts + 1,
      });
    });
  }

  public completeJob(jobId: string): void {
    this.db.prepare("UPDATE scheduled_jobs SET status = 'COMPLETED', locked_until = NULL WHERE job_id = ?").run(jobId);
  }

  public failJob(jobId: string, error: string, retryAt?: string): void {
    if (retryAt) {
      this.db
        .prepare("UPDATE scheduled_jobs SET status = 'PENDING', execute_at = ?, locked_until = NULL, last_error = ? WHERE job_id = ?")
        .run(retryAt, error, jobId);
    } else {
      this.db
        .prepare("UPDATE scheduled_jobs SET status = 'FAILED', locked_until = NULL, last_error = ? WHERE job_id = ?")
        .run(error, jobId);
    }
  }

  public cancelPendingJobs(jobType: string, filterKey: string, filterValue: string): number {
    const rows = this.db
      .prepare("SELECT job_id, payload_json FROM scheduled_jobs WHERE job_type = ? AND status = 'PENDING'")
      .all(jobType) as any[];

    let cancelled = 0;
    for (const r of rows) {
      try {
        const payload = JSON.parse(r.payload_json);
        if (payload[filterKey] === filterValue) {
          this.db.prepare("DELETE FROM scheduled_jobs WHERE job_id = ?").run(r.job_id);
          cancelled++;
        }
      } catch {}
    }
    return cancelled;
  }

  public getPendingCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) as count FROM scheduled_jobs WHERE status = 'PENDING'").get() as any;
    return row?.count ?? 0;
  }

  private mapJob(row: any): ScheduledJob {
    return {
      jobId: row.job_id,
      jobType: row.job_type,
      executeAt: row.execute_at,
      payload: JSON.parse(row.payload_json || '{}'),
      status: row.status,
      lockedUntil: row.locked_until,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      lastError: row.last_error,
      dedupKey: row.dedup_key,
    };
  }
}

export class AuditRepository {
  private db: Database;
  constructor(db: Database) {
    this.db = db;
  }

  public recordEvent(
    actorType: AuditEvent['actorType'],
    actorId: string,
    action: string,
    objectType: string,
    objectId: string,
    details: Record<string, unknown> = {},
    ipAddress?: string
  ): void {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    // Sanitize details: never record raw secrets, keys, or passwords
    const sanitizedDetails = { ...details };
    for (const key of Object.keys(sanitizedDetails)) {
      const lower = key.toLowerCase();
      if (lower.includes('password') || lower.includes('secret') || lower.includes('token') || lower.includes('key')) {
        sanitizedDetails[key] = '[REDACTED]';
      }
    }

    this.db
      .prepare(
        `INSERT INTO audit_events (id, actor_type, actor_id, action, object_type, object_id, details_json, ip_address, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, actorType, actorId, action, objectType, objectId, JSON.stringify(sanitizedDetails), ipAddress ?? null, now);
  }

  public listEvents(limit: number = 100, offset: number = 0): AuditEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM audit_events ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(limit, offset) as any[];

    return rows.map((row) => ({
      id: row.id,
      actorType: row.actor_type,
      actorId: row.actor_id,
      action: row.action,
      objectType: row.object_type,
      objectId: row.object_id,
      details: JSON.parse(row.details_json || '{}'),
      ipAddress: row.ip_address,
      createdAt: row.created_at,
    }));
  }
}

export class AdminSessionRepository {
  private db: Database;
  constructor(db: Database) {
    this.db = db;
  }

  public createSession(username: string, ttlMinutes: number = 60): { sessionId: string; csrfToken: string; expiresAt: string } {
    const sessionId = `sess_${crypto.randomBytes(32).toString('hex')}`;
    const csrfToken = crypto.randomBytes(24).toString('hex');
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();

    this.db
      .prepare(
        `INSERT INTO admin_sessions (session_id, username, created_at, expires_at, csrf_token)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(sessionId, username, now, expiresAt, csrfToken);

    return { sessionId, csrfToken, expiresAt };
  }

  public getSession(sessionId: string): { sessionId: string; username: string; csrfToken: string; expiresAt: string } | null {
    const row = this.db.prepare('SELECT * FROM admin_sessions WHERE session_id = ?').get(sessionId) as any;
    if (!row) return null;
    if (new Date(row.expires_at).getTime() < Date.now()) {
      this.destroySession(sessionId);
      return null;
    }
    return {
      sessionId: row.session_id,
      username: row.username,
      csrfToken: row.csrf_token,
      expiresAt: row.expires_at,
    };
  }

  public destroySession(sessionId: string): void {
    this.db.prepare('DELETE FROM admin_sessions WHERE session_id = ?').run(sessionId);
  }

  public cleanupExpired(): void {
    const now = new Date().toISOString();
    this.db.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').run(now);
  }
}
