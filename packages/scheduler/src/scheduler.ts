/**
 * Durable Job Scheduler and Background Worker for Frieren Discord Logbook.
 * Implements 16:00 reminder, 15-minute review window (T+15 = 16:15),
 * and AWAITING_WORK_END gate (until 16:25).
 * Fully testable with injected FakeClock.
 */

import {
  Database,
  UserRepository,
  GuildRepository,
  SettingsRepository,
  LogbookRepository,
  JobQueueRepository,
  AgentRepository,
} from '../../db/src/index.ts';
import { PersonaService } from '../../ai/src/persona.ts';
import { LogbookGeneratorService } from '../../ai/src/logbook_generator.ts';
import type { ScheduledJob, LogbookStatus } from '../../contracts/src/types.ts';
import crypto from 'node:crypto';

export interface DiscordTransport {
  sendDm(userId: string, content: string, components?: any[]): Promise<{ messageId: string; success: boolean; errorCode?: string }>;
  postToChannel(channelId: string, content: string, allowedUserIds?: string[]): Promise<{ messageId: string; success: boolean }>;
}

export class FakeClock {
  private currentTime: number;

  constructor(initialIso: string = '2026-11-11T16:00:00+07:00') {
    this.currentTime = new Date(initialIso).getTime();
  }

  public now(): Date {
    return new Date(this.currentTime);
  }

  public nowIso(): string {
    return new Date(this.currentTime).toISOString();
  }

  public advanceMinutes(mins: number): void {
    this.currentTime += mins * 60_000;
  }

  public setTime(iso: string): void {
    this.currentTime = new Date(iso).getTime();
  }
}

export class SchedulerService {
  private db: Database;
  private userRepo: UserRepository;
  private guildRepo: GuildRepository;
  private settingsRepo: SettingsRepository;
  private logbookRepo: LogbookRepository;
  private jobRepo: JobQueueRepository;
  private agentRepo: AgentRepository;
  private persona: PersonaService;
  private generator: LogbookGeneratorService;
  private discord: DiscordTransport;
  private clock: FakeClock;

  constructor(options: {
    db: Database;
    persona: PersonaService;
    generator: LogbookGeneratorService;
    discord: DiscordTransport;
    clock?: FakeClock;
  }) {
    this.db = options.db;
    this.userRepo = new UserRepository(this.db);
    this.guildRepo = new GuildRepository(this.db);
    this.settingsRepo = new SettingsRepository(this.db);
    this.logbookRepo = new LogbookRepository(this.db);
    this.jobRepo = new JobQueueRepository(this.db);
    this.agentRepo = new AgentRepository(this.db);
    this.persona = options.persona;
    this.generator = options.generator;
    this.discord = options.discord;
    this.clock = options.clock || new FakeClock();
  }

  public getClock(): FakeClock {
    return this.clock;
  }

  /**
   * Schedules the daily reminder for a user on a given date.
   */
  public scheduleDailyReminder(userId: string, targetDate: string, timeStr: string = '16:00'): ScheduledJob {
    const executeAt = new Date(`${targetDate}T${timeStr}:00+07:00`).toISOString();
    return this.jobRepo.enqueueJob(
      'DAILY_REMINDER',
      executeAt,
      { userId, targetDate },
      `reminder_${userId}_${targetDate}`
    );
  }

  /**
   * Schedules the guild daily checklist.
   */
  public scheduleGuildChecklist(guildId: string, targetDate: string, timeStr: string): ScheduledJob {
    const executeAt = new Date(`${targetDate}T${timeStr}:00+07:00`).toISOString();
    return this.jobRepo.enqueueJob(
      'GUILD_CHECKLIST',
      executeAt,
      { guildId, targetDate },
      `guild_checklist_${guildId}_${targetDate}`
    );
  }

  /**
   * Schedules the guild final missing ping.
   */
  public scheduleGuildFinalPing(guildId: string, targetDate: string, timeStr: string): ScheduledJob {
    const executeAt = new Date(`${targetDate}T${timeStr}:00+07:00`).toISOString();
    return this.jobRepo.enqueueJob(
      'FINAL_PING',
      executeAt,
      { guildId, targetDate },
      `guild_final_ping_${guildId}_${targetDate}`
    );
  }

  /**
   * Executes a single due job from the queue.
   */
  public async processNextJob(): Promise<ScheduledJob | null> {
    const nowIso = this.clock.nowIso();
    const job = this.jobRepo.lockNextJob(nowIso, 60);
    if (!job) return null;

    try {
      if (job.jobType === 'DAILY_REMINDER') {
        await this.handleDailyReminder(job);
      } else if (job.jobType === 'REVIEW_DEADLINE') {
        await this.handleReviewDeadline(job);
      } else if (job.jobType === 'AUTO_SUBMIT') {
        await this.handleAutoSubmit(job);
      } else if (job.jobType === 'GUILD_CHECKLIST') {
        await this.handleGuildChecklist(job);
      } else if (job.jobType === 'FINAL_PING') {
        await this.handleGuildFinalPing(job);
      }
      this.jobRepo.completeJob(job.jobId);
      return job;
    } catch (err: any) {
      this.jobRepo.failJob(job.jobId, err.message || 'Job execution failed');
      throw err;
    }
  }

  private async handleDailyReminder(job: ScheduledJob): Promise<void> {
    const { userId, targetDate } = job.payload as { userId: string; targetDate: string };
    const settings = this.settingsRepo.getSettings(userId);

    // 1. Check working days (1=Mon ... 7=Sun)
    const targetDayOfWeek = new Date(`${targetDate}T12:00:00+07:00`).getDay();
    const isoDayOfWeek = targetDayOfWeek === 0 ? 7 : targetDayOfWeek;
    if (!settings.workingDays.includes(isoDayOfWeek)) {
      return; // Not a working day for user
    }

    // 2. Fetch or create logical logbook entry
    const entry = this.logbookRepo.getOrCreateEntry(userId, targetDate, userId);
    if (entry.status === 'VERIFIED' || entry.status === 'SKIPPED') {
      return; // Already verified or skipped
    }

    // 3. Gather commits from local agent snapshot
    const snapshot = this.agentRepo.getLatestSnapshot(userId, targetDate);
    const commits = snapshot ? snapshot.commits : [];

    let summaryText = '';
    let statusToSet: LogbookStatus = 'DRAFT_READY';

    if (commits.length > 0) {
      const genResult = await this.generator.generateSummary(targetDate, commits);
      summaryText = genResult.summary;
      statusToSet = 'DRAFT_READY';
    } else {
      summaryText = 'Belum ada komit terdeteksi dari agent lokal hari ini. Masukkan ringkasan secara manual.';
      statusToSet = 'NEEDS_MANUAL_INPUT';
    }

    // Create revision
    const revisionId = crypto.randomUUID();
    this.logbookRepo.createRevision({
      revisionId,
      entryId: entry.entryId,
      summary: summaryText,
      workStart: settings.startTime,
      workEnd: settings.endTime,
      location: 'Kampus / Lab',
      source: commits.length > 0 ? 'GEMINI_FROM_GIT' : 'MANUAL',
      sourceSnapshotId: snapshot?.snapshotId,
      approvedAt: null,
    });

    this.logbookRepo.updateStatus(entry.entryId, statusToSet);

    // 4. Send private DM to user
    const reminderMsg = this.persona.getDeterministicFallback({
      type: commits.length > 0 ? 'draft_ready' : 'agent_offline',
      commitsCount: commits.length,
    });

    const dmResult = await this.discord.sendDm(userId, `${reminderMsg}\n\n**Draft Logbook (${targetDate}):**\n${summaryText}`);

    if (!dmResult.success) {
      this.logbookRepo.updateStatus(entry.entryId, 'DM_BLOCKED');
      this.logbookRepo.recordDeliveryEvent(entry.entryId, 'REMINDER_DM', undefined, undefined, dmResult.errorCode || 'DM_BLOCKED');
      // Hard boundary: DM_BLOCKED must NOT start the review timer or auto-submit
      return;
    }

    // Record delivery success
    const deliveredAt = this.clock.nowIso();
    this.logbookRepo.recordDeliveryEvent(entry.entryId, 'REMINDER_DM', dmResult.messageId, deliveredAt);

    // 5. If user has auto-submit enabled, start 15-minute review window
    if (settings.autoSubmitEnabled && statusToSet === 'DRAFT_READY') {
      this.logbookRepo.updateStatus(entry.entryId, 'AUTO_WAITING');

      // Schedule review deadline at deliveredAt + 15 minutes
      const reviewDeadlineTime = new Date(new Date(deliveredAt).getTime() + 15 * 60_000).toISOString();
      this.jobRepo.enqueueJob(
        'REVIEW_DEADLINE',
        reviewDeadlineTime,
        { userId, entryId: entry.entryId, revisionId, targetDate },
        `review_deadline_${entry.entryId}`
      );
    }
  }

  private async handleReviewDeadline(job: ScheduledJob): Promise<void> {
    const { userId, entryId, revisionId, targetDate } = job.payload as {
      userId: string;
      entryId: string;
      revisionId: string;
      targetDate: string;
    };

    const entry = this.logbookRepo.getEntry(entryId);
    if (!entry) return;

    // Safety checks: cancel if user opted out, skipped, or is currently editing
    const settings = this.settingsRepo.getSettings(userId);
    if (!settings.autoSubmitEnabled) {
      this.logbookRepo.updateStatus(entryId, 'AUTO_CANCELLED');
      return;
    }

    if (entry.status !== 'AUTO_WAITING') {
      // User may have edited, skipped, or manually submitted
      return;
    }

    if (entry.activeRevisionId !== revisionId) {
      // Revision changed, hold
      return;
    }

    // Work-end gate: default 16:25
    // Target date + settings.endTime (e.g. 2026-11-11T16:25:00+07:00)
    const workEndIso = new Date(`${targetDate}T${settings.endTime}:00+07:00`).toISOString();
    const nowIso = this.clock.nowIso();

    if (new Date(nowIso).getTime() < new Date(workEndIso).getTime()) {
      // Workday not finished yet! Hold in AWAITING_WORK_END until workEndIso
      this.logbookRepo.updateStatus(entryId, 'AWAITING_WORK_END');

      const holdMsg = this.persona.getDeterministicFallback({
        type: 'awaiting_work_end',
        endTime: settings.endTime,
      });
      await this.discord.sendDm(userId, holdMsg);

      // Schedule auto-submit at exact work end time
      this.jobRepo.enqueueJob(
        'AUTO_SUBMIT',
        workEndIso,
        { userId, entryId, revisionId, targetDate },
        `auto_submit_${entryId}`
      );
    } else {
      // Current time is >= work end time, eligible to submit immediately
      this.logbookRepo.updateStatus(entryId, 'QUEUED_SUBMIT');
    }
  }

  private async handleAutoSubmit(job: ScheduledJob): Promise<void> {
    const { userId, entryId, revisionId } = job.payload as {
      userId: string;
      entryId: string;
      revisionId: string;
    };

    const entry = this.logbookRepo.getEntry(entryId);
    if (!entry) return;

    const settings = this.settingsRepo.getSettings(userId);
    if (!settings.autoSubmitEnabled) {
      this.logbookRepo.updateStatus(entryId, 'AUTO_CANCELLED');
      return;
    }

    if (entry.status === 'AWAITING_WORK_END' && entry.activeRevisionId === revisionId) {
      this.logbookRepo.updateStatus(entryId, 'QUEUED_SUBMIT');
    }
  }

  private async handleGuildChecklist(job: ScheduledJob): Promise<void> {
    const { guildId, targetDate } = job.payload as { guildId: string; targetDate: string };
    const config = this.guildRepo.getGuildConfig(guildId);
    if (!config || !config.enabled || !config.checklistChannelId) {
      return; // Guild channel not configured or disabled
    }

    const enrolledUserIds = this.guildRepo.getEnrolledUsers(guildId);
    if (enrolledUserIds.length === 0) return;

    const verifiedUsers: string[] = [];
    const pendingUsers: string[] = [];
    const missingUsers: string[] = [];
    const skippedUsers: string[] = [];

    for (const uId of enrolledUserIds) {
      const entry = this.logbookRepo.getEntryByUserAndDate(uId, targetDate);
      if (!entry) {
        missingUsers.push(uId);
      } else if (entry.status === 'VERIFIED') {
        verifiedUsers.push(uId);
      } else if (entry.status === 'SKIPPED') {
        skippedUsers.push(uId);
      } else {
        pendingUsers.push(uId);
      }
    }

    // Format checklist text
    let message = `📋 **Checklist Logbook Magang — ${targetDate}**\n`;
    message += `Ringkasan: ✅ ${verifiedUsers.length} Terverifikasi | 🟡 ${pendingUsers.length} Menunggu | ❌ ${missingUsers.length} Belum | ⚪ ${skippedUsers.length} Dilewati\n\n`;

    if (config.mentionPolicy === 'all-participants') {
      message += `**Daftar Peserta:**\n`;
      for (const uId of enrolledUserIds) {
        const tag = verifiedUsers.includes(uId)
          ? '✅'
          : pendingUsers.includes(uId)
          ? '🟡'
          : skippedUsers.includes(uId)
          ? '⚪'
          : '❌';
        message += `${tag} <@${uId}>\n`;
      }
    }

    // Dedup: record post to guild_daily_checklists
    const nowIso = this.clock.nowIso();
    this.db
      .prepare(
        `INSERT INTO guild_daily_checklists (guild_id, target_date, post_type, post_message_id, state, created_at)
         VALUES (?, ?, 'CHECKLIST', NULL, 'POSTED', ?)
         ON CONFLICT(guild_id, target_date, post_type) DO NOTHING`
      )
      .run(guildId, targetDate, nowIso);

    // Send only to configured channel with explicit allowed mentions (enrolled only, NEVER @everyone)
    const allowedMentions = config.mentionPolicy === 'all-participants' ? enrolledUserIds : [];
    await this.discord.postToChannel(config.checklistChannelId, message, allowedMentions);
  }

  private async handleGuildFinalPing(job: ScheduledJob): Promise<void> {
    const { guildId, targetDate } = job.payload as { guildId: string; targetDate: string };
    const config = this.guildRepo.getGuildConfig(guildId);
    if (!config || !config.enabled || !config.checklistChannelId) {
      return;
    }

    const enrolledUserIds = this.guildRepo.getEnrolledUsers(guildId);
    const missingOrUnverified: string[] = [];

    for (const uId of enrolledUserIds) {
      const entry = this.logbookRepo.getEntryByUserAndDate(uId, targetDate);
      if (!entry || entry.status !== 'VERIFIED') {
        missingOrUnverified.push(uId);
      }
    }

    if (missingOrUnverified.length === 0) {
      return; // All members verified, no ping necessary!
    }

    // Final ping message: mentions ONLY missing/unverified users
    const mentionTags = missingOrUnverified.map((id) => `<@${id}>`).join(' ');
    const message =
      `⏰ **Pengingat Akhir Logbook (${targetDate})**\n` +
      `Batas pengisian logbook DERMAGA hampir selesai. Peserta berikut dimohon segera memverifikasi laporannya:\n` +
      `${mentionTags}`;

    const nowIso = this.clock.nowIso();
    this.db
      .prepare(
        `INSERT INTO guild_daily_checklists (guild_id, target_date, post_type, post_message_id, state, created_at)
         VALUES (?, ?, 'FINAL_PING', NULL, 'POSTED', ?)
         ON CONFLICT(guild_id, target_date, post_type) DO NOTHING`
      )
      .run(guildId, targetDate, nowIso);

    // Allowed mentions: strictly only missing users!
    await this.discord.postToChannel(config.checklistChannelId, message, missingOrUnverified);
  }
}
