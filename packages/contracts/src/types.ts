/**
 * Domain Types & Status Enums for Frieren Discord Logbook Automation.
 * Authoritative source: docs/FRIEREN_DISCORD_LOGBOOK_PRD.md & docs/ARCHITECTURE_AND_API.md
 */

export type LogbookStatus =
  | 'NOT_DUE'
  | 'REMINDER_PREPARING'
  | 'DM_DELIVERED'
  | 'DM_BLOCKED'
  | 'DRAFT_READY'
  | 'NEEDS_MANUAL_INPUT'
  | 'AGENT_OFFLINE'
  | 'EDITING'
  | 'APPROVED'
  | 'AUTO_WAITING'
  | 'AWAITING_WORK_END'
  | 'QUEUED_SUBMIT'
  | 'SUBMITTING'
  | 'SUBMITTED_UNVERIFIED'
  | 'RECONCILING'
  | 'UNVERIFIED_RETRYABLE'
  | 'NEEDS_ATTENTION'
  | 'VERIFIED'
  | 'SKIPPED'
  | 'AUTO_CANCELLED';

export type EvidenceStatus =
  | 'NONE'
  | 'SCREENSHOT_PENDING'
  | 'READY'
  | 'SCREENSHOT_FAILED'
  | 'DM_SENT'
  | 'DM_FAILED';

export type MentionPolicy = 'all-participants' | 'missing-only' | 'none';

export interface User {
  discordUserId: string;
  discordNameCache: string;
  timezone: string;
  homeGuildId: string | null;
  setupStatus: 'INCOMPLETE' | 'READY';
  createdAt: string;
  updatedAt: string;
}

export interface Guild {
  guildId: string;
  nameCache: string;
  ownerIdCache: string;
  installedAt: string;
  status: 'ACTIVE' | 'PAUSED';
}

export interface GuildMembership {
  guildId: string;
  userId: string;
  enrolled: boolean;
  lastSeen: string;
}

export interface GuildConfig {
  guildId: string;
  checklistChannelId: string | null;
  checklistTime: string | null; // e.g. "17:00"
  lastPingTime: string | null;   // e.g. "18:30"
  days: number[]; // 1=Mon, 7=Sun
  mentionPolicy: MentionPolicy;
  enabled: boolean;
}

export interface UserSettings {
  userId: string;
  reminderTime: string; // default "16:00"
  workingDays: number[]; // default [1, 2, 3, 4, 5]
  startTime: string; // default "07:10"
  endTime: string;   // default "16:25"
  autoSubmitEnabled: boolean; // default false
  timezone: string; // default "Asia/Jakarta"
  locationProfileId: string | null;
}

export interface AgentDevice {
  deviceId: string;
  userId: string;
  platform: 'win32' | 'linux' | 'darwin';
  version: string;
  tokenHash: string;
  lastSeen: string;
  lastSync: string | null;
  revokedAt: string | null;
}

export interface PairingCode {
  id: string;
  userId: string;
  codeHash: string;
  expiresAt: string;
  claimedAt: string | null;
  attempts: number;
}

export interface ChangedFileStats {
  files: number;
  insertions: number;
  deletions: number;
}

export interface CommitInfo {
  repoId: string;
  hash: string;
  author: string;
  committedAt: string;
  subject: string;
  body: string;
  changedFileStats?: ChangedFileStats;
}

export interface RepositoryInfo {
  repoId: string;
  alias: string;
  branch: string;
}

export interface CommitSnapshot {
  snapshotId: string;
  userId: string;
  targetDate: string; // "YYYY-MM-DD"
  timezone: string;
  repositories: RepositoryInfo[];
  commits: CommitInfo[];
  digest: string;
  capturedAt: string;
  sourceDeviceId: string;
}

export interface LogbookRevision {
  revisionId: string;
  entryId: string;
  summary: string;
  workStart: string;
  workEnd: string;
  location: string;
  source: 'GEMINI_FROM_GIT' | 'MANUAL' | 'FALLBACK';
  sourceSnapshotId?: string;
  approvedAt: string | null;
  createdAt: string;
}

export interface LogbookEntry {
  entryId: string;
  userId: string;
  targetDate: string; // "YYYY-MM-DD"
  portalAccountId: string;
  status: LogbookStatus;
  activeRevisionId: string | null;
  verifiedAt: string | null;
  portalRecordId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Evidence {
  evidenceId: string;
  entryId: string;
  screenshotPrivatePath: string;
  sha256: string;
  verifiedRecordDigest: string;
  capturedAfterRefreshAt: string;
  retentionUntil: string;
  evidenceStatus: EvidenceStatus;
}

export interface SubmissionAttempt {
  attemptId: string;
  entryId: string;
  revisionId: string;
  idempotencyKey: string;
  portalResponseKind: string;
  startedAt: string;
  completedAt: string | null;
  error: string | null;
}

export interface ScheduledJob {
  jobId: string;
  jobType: 'DAILY_REMINDER' | 'REVIEW_DEADLINE' | 'AUTO_SUBMIT' | 'FRESH_VERIFY' | 'GUILD_CHECKLIST' | 'FINAL_PING';
  executeAt: string;
  payload: Record<string, unknown>;
  status: 'PENDING' | 'LOCKED' | 'COMPLETED' | 'FAILED';
  lockedUntil: string | null;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  dedupKey: string;
}

export interface AuditEvent {
  id: string;
  actorType: 'USER' | 'ADMIN' | 'SYSTEM' | 'AGENT';
  actorId: string;
  action: string;
  objectType: string;
  objectId: string;
  details: Record<string, unknown>;
  ipAddress?: string;
  createdAt: string;
}

/**
 * Valid state transitions mapping for LogbookStatus.
 */
export const ALLOWED_TRANSITIONS: Record<LogbookStatus, LogbookStatus[]> = {
  NOT_DUE: ['REMINDER_PREPARING', 'DRAFT_READY', 'NEEDS_MANUAL_INPUT', 'AGENT_OFFLINE', 'SKIPPED'],
  REMINDER_PREPARING: ['DM_DELIVERED', 'DM_BLOCKED'],
  DM_DELIVERED: ['DRAFT_READY', 'NEEDS_MANUAL_INPUT', 'AGENT_OFFLINE', 'AUTO_WAITING', 'EDITING', 'APPROVED', 'SKIPPED'],
  DM_BLOCKED: ['NEEDS_MANUAL_INPUT', 'SKIPPED'],
  DRAFT_READY: ['EDITING', 'APPROVED', 'AUTO_WAITING', 'SKIPPED', 'AUTO_CANCELLED', 'QUEUED_SUBMIT'],
  NEEDS_MANUAL_INPUT: ['EDITING', 'DRAFT_READY', 'SKIPPED'],
  AGENT_OFFLINE: ['DRAFT_READY', 'NEEDS_MANUAL_INPUT', 'SKIPPED'],
  EDITING: ['DRAFT_READY', 'SKIPPED', 'AUTO_CANCELLED'],
  APPROVED: ['QUEUED_SUBMIT', 'AUTO_WAITING', 'EDITING', 'SKIPPED'],
  AUTO_WAITING: ['AWAITING_WORK_END', 'QUEUED_SUBMIT', 'EDITING', 'SKIPPED', 'AUTO_CANCELLED'],
  AWAITING_WORK_END: ['QUEUED_SUBMIT', 'EDITING', 'SKIPPED', 'AUTO_CANCELLED'],
  QUEUED_SUBMIT: ['SUBMITTING', 'AUTO_CANCELLED', 'SKIPPED'],
  SUBMITTING: ['SUBMITTED_UNVERIFIED', 'NEEDS_ATTENTION', 'RECONCILING'],
  SUBMITTED_UNVERIFIED: ['RECONCILING', 'VERIFIED', 'UNVERIFIED_RETRYABLE', 'NEEDS_ATTENTION'],
  RECONCILING: ['VERIFIED', 'UNVERIFIED_RETRYABLE', 'NEEDS_ATTENTION', 'SUBMITTED_UNVERIFIED'],
  UNVERIFIED_RETRYABLE: ['RECONCILING', 'QUEUED_SUBMIT', 'NEEDS_ATTENTION'],
  NEEDS_ATTENTION: ['QUEUED_SUBMIT', 'RECONCILING', 'SKIPPED'],
  VERIFIED: [], // Terminal verified state
  SKIPPED: ['DRAFT_READY', 'NEEDS_MANUAL_INPUT'],
  AUTO_CANCELLED: ['APPROVED', 'DRAFT_READY', 'QUEUED_SUBMIT', 'SKIPPED'],
};

export function canTransition(current: LogbookStatus, next: LogbookStatus): boolean {
  if (current === next) return true;
  const allowed = ALLOWED_TRANSITIONS[current];
  return allowed ? allowed.includes(next) : false;
}

export function assertValidTransition(current: LogbookStatus, next: LogbookStatus): void {
  if (!canTransition(current, next)) {
    throw new Error(`Invalid logbook state transition: ${current} -> ${next}`);
  }
}
