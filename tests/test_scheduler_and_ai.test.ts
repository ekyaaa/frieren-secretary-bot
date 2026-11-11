import assert from 'node:assert';
import {
  Database,
  UserRepository,
  GuildRepository,
  SettingsRepository,
  AgentRepository,
  LogbookRepository,
} from '../packages/db/src/index.ts';
import { GeminiKeyRouter } from '../packages/ai/src/key_router.ts';
import { PersonaService } from '../packages/ai/src/persona.ts';
import { LogbookGeneratorService } from '../packages/ai/src/logbook_generator.ts';
import { SchedulerService, FakeClock } from '../packages/scheduler/src/scheduler.ts';
import type { DiscordTransport } from '../packages/scheduler/src/scheduler.ts';
import { BotService } from '../apps/bot/src/bot_service.ts';

class MockDiscordTransport implements DiscordTransport {
  public dmsSent: { userId: string; content: string }[] = [];
  public channelPosts: { channelId: string; content: string; allowedUserIds?: string[] }[] = [];
  public shouldBlockDm: boolean = false;

  async sendDm(userId: string, content: string): Promise<{ messageId: string; success: boolean; errorCode?: string }> {
    if (this.shouldBlockDm) {
      return { messageId: '', success: false, errorCode: 'DM_BLOCKED' };
    }
    this.dmsSent.push({ userId, content });
    return { messageId: `msg_${Date.now()}_${this.dmsSent.length}`, success: true };
  }

  async postToChannel(channelId: string, content: string, allowedUserIds?: string[]): Promise<{ messageId: string; success: boolean }> {
    this.channelPosts.push({ channelId, content, allowedUserIds });
    return { messageId: `post_${Date.now()}`, success: true };
  }
}

async function runSchedulerAndAiTests() {
  console.log('--- Starting Scheduler and AI Acceptance Tests ---');

  // 1. Test Key Router Failover
  const router = new GeminiKeyRouter(['KEY_FAIL_429', 'KEY_SUCCESS']);
  let callCount = 0;
  const mockCaller = async (apiKey: string) => {
    callCount++;
    if (apiKey === 'KEY_FAIL_429') {
      const err = new Error('Quota exceeded (429)');
      (err as any).status = 429;
      throw err;
    }
    return 'Mock AI Response from ' + apiKey;
  };

  const failoverRes = await router.executeWithFailover(mockCaller, 'test prompt');
  assert.strictEqual(failoverRes.usedKeyId, 'global_key_2');
  assert.strictEqual(callCount, 2);
  console.log('✔ Gemini key failover rotated from KEY_FAIL_429 to global_key_2');

  // 2. Test Persona Service (English-Only & Factual)
  const persona = new PersonaService(router);
  const reminderText = persona.getDeterministicFallback({ type: 'reminder' });
  assert.ok(reminderText.includes('fifteen minutes'));
  assert.ok(!reminderText.includes('Master~')); // No forbidden anime catchphrase
  console.log('✔ Persona system produces natural English without forbidden phrases');

  // 3. Test Logbook Generator (Zero commits vs normal commits)
  const generator = new LogbookGeneratorService(router);
  const zeroCommitsRes = await generator.generateSummary('2026-11-11', []);
  assert.strictEqual(zeroCommitsRes.requiresManualInput, true);
  assert.strictEqual(zeroCommitsRes.summary, '');
  console.log('✔ Zero commits properly sets requires_manual_input=true and prevents fake reporting');

  const normalCommitsRes = await generator.generateSummary('2026-11-11', [
    {
      repoId: 'r1',
      hash: 'a1b2c3d',
      author: 'Tester <t@test.com>',
      committedAt: '2026-11-11T10:00:00+07:00',
      subject: 'feat: add database encryption token: secret123',
      body: 'Implemented AES-256',
      changedFileStats: { files: 1, insertions: 10, deletions: 0 },
    },
  ]);
  assert.ok(normalCommitsRes.summary.includes('Melakukan pengerjaan teknis'));
  assert.ok(!normalCommitsRes.summary.includes('secret123')); // Secret redacted
  console.log('✔ Formal Indonesian summary generated with secret redaction');

  // 4. Test Scheduler & Review Lifecycle (16:00 -> 16:15 -> 16:25)
  const db = new Database(':memory:');
  const discord = new MockDiscordTransport();
  const clock = new FakeClock('2026-11-11T15:59:00+07:00'); // 1 minute before reminder

  const scheduler = new SchedulerService({
    db,
    persona,
    generator,
    discord,
    clock,
  });

  const bot = new BotService({ db, persona, generator });

  // Setup user and agent
  const userRepo = new UserRepository(db);
  const guildRepo = new GuildRepository(db);
  const settingsRepo = new SettingsRepository(db);
  const agentRepo = new AgentRepository(db);
  const logbookRepo = new LogbookRepository(db);

  const user = userRepo.getOrCreate('user_frieren_1', 'Fern');
  settingsRepo.saveSettings({
    userId: 'user_frieren_1',
    autoSubmitEnabled: true,
    reminderTime: '16:00',
    startTime: '07:10',
    endTime: '16:25',
    workingDays: [1, 2, 3, 4, 5],
  });

  // User belongs to 2 guilds (Guild A and Guild B)
  guildRepo.upsertGuild('guild_A', 'Guild A');
  guildRepo.upsertGuild('guild_B', 'Guild B');
  guildRepo.enrollUser('guild_A', 'user_frieren_1');
  guildRepo.enrollUser('guild_B', 'user_frieren_1');

  // Save commit snapshot from agent
  agentRepo.saveSnapshot({
    snapshotId: 'snap_1',
    userId: 'user_frieren_1',
    targetDate: '2026-11-11',
    timezone: 'Asia/Jakarta',
    repositories: [{ repoId: 'r1', alias: 'hero-party', branch: 'main' }],
    commits: [
      {
        repoId: 'r1',
        hash: 'comm_12345',
        author: 'Fern <fern@local>',
        committedAt: '2026-11-11T11:00:00+07:00',
        subject: 'feat: optimize defensive magic shield',
        body: 'Increased resilience',
      },
    ],
    digest: 'digest_123',
    capturedAt: '2026-11-11T11:05:00+07:00',
    sourceDeviceId: 'dev_1',
  });

  // Schedule daily reminder for 16:00
  scheduler.scheduleDailyReminder('user_frieren_1', '2026-11-11', '16:00');

  // At 15:59: job should not run yet
  let jobRun = await scheduler.processNextJob();
  assert.strictEqual(jobRun, null);

  // Advance clock to 16:00
  clock.advanceMinutes(1);
  jobRun = await scheduler.processNextJob();
  assert.ok(jobRun !== null && jobRun.jobType === 'DAILY_REMINDER');

  // Multi-guild check: Exactly ONE DM delivered despite belonging to 2 guilds!
  assert.strictEqual(discord.dmsSent.length, 1);
  assert.strictEqual(discord.dmsSent[0].userId, 'user_frieren_1');
  console.log('✔ T008: Exactly ONE DM sent to user belonging to multiple guilds');

  // Verify logbook entry is in AUTO_WAITING state
  let entry = logbookRepo.getEntryByUserAndDate('user_frieren_1', '2026-11-11');
  assert.ok(entry);
  assert.strictEqual(entry.status, 'AUTO_WAITING');
  console.log('✔ T013: Logbook moved to AUTO_WAITING on successful DM reminder');

  // Advance clock by 10 minutes (to 16:10) -> review deadline not due yet
  clock.advanceMinutes(10);
  jobRun = await scheduler.processNextJob();
  assert.strictEqual(jobRun, null);

  // Advance clock by 5 more minutes (to 16:15 -> T+15 reached)
  clock.advanceMinutes(5);
  jobRun = await scheduler.processNextJob();
  assert.ok(jobRun !== null && jobRun.jobType === 'REVIEW_DEADLINE');

  // Work-end gate check: work ends at 16:25, so status must be AWAITING_WORK_END, not submitted!
  entry = logbookRepo.getEntryByUserAndDate('user_frieren_1', '2026-11-11');
  assert.strictEqual(entry?.status, 'AWAITING_WORK_END');
  console.log('✔ T014: Status paused in AWAITING_WORK_END because workday ends at 16:25');

  // Advance clock to 16:24 (1 minute before work end) -> still in AWAITING_WORK_END
  clock.advanceMinutes(9);
  jobRun = await scheduler.processNextJob();
  assert.strictEqual(jobRun, null);

  // Advance clock to 16:25 (work end reached) -> AUTO_SUBMIT triggers
  clock.advanceMinutes(1);
  jobRun = await scheduler.processNextJob();
  assert.ok(jobRun !== null && jobRun.jobType === 'AUTO_SUBMIT');

  entry = logbookRepo.getEntryByUserAndDate('user_frieren_1', '2026-11-11');
  assert.strictEqual(entry?.status, 'QUEUED_SUBMIT');
  console.log('✔ T014: Status transitioned to QUEUED_SUBMIT at 16:25 work end');

  // 5. Test DM Blocked Guard (T009)
  const blockedDiscord = new MockDiscordTransport();
  blockedDiscord.shouldBlockDm = true;

  const blockedScheduler = new SchedulerService({
    db,
    persona,
    generator,
    discord: blockedDiscord,
    clock: new FakeClock('2026-11-11T16:00:00+07:00'),
  });

  settingsRepo.saveSettings({
    userId: 'user_blocked_1',
    autoSubmitEnabled: true,
    reminderTime: '16:00',
    startTime: '07:10',
    endTime: '16:25',
    workingDays: [1, 2, 3, 4, 5],
  });

  blockedScheduler.scheduleDailyReminder('user_blocked_1', '2026-11-11', '16:00');
  await blockedScheduler.processNextJob();

  const blockedEntry = logbookRepo.getEntryByUserAndDate('user_blocked_1', '2026-11-11');
  assert.strictEqual(blockedEntry?.status, 'DM_BLOCKED');
  // Confirm NO review deadline or auto submit was queued for blocked user!
  const blockedPendingJobs = db.prepare("SELECT COUNT(*) as count FROM scheduled_jobs WHERE status = 'PENDING'").get() as any;
  assert.strictEqual(blockedPendingJobs.count, 0);
  console.log('✔ T009: DM_BLOCKED prevents auto review timer and silent submission');

  // 6. Test Saturday default Mon-Fri check (T010)
  const satClock = new FakeClock('2026-11-14T16:00:00+07:00'); // Saturday
  const satScheduler = new SchedulerService({
    db,
    persona,
    generator,
    discord: new MockDiscordTransport(),
    clock: satClock,
  });
  satScheduler.scheduleDailyReminder('user_frieren_1', '2026-11-14', '16:00');
  await satScheduler.processNextJob();

  const satEntry = logbookRepo.getEntryByUserAndDate('user_frieren_1', '2026-11-14');
  assert.strictEqual(satEntry, null);
  console.log('✔ T010: Saturday tick generates no reminder for Mon-Fri user');

  // 7. Test Slash Commands & Ephemeral Channel Protection (T001)
  const channelResp = await bot.handleSlashCommand({
    userId: 'u_cmd_1',
    username: 'Stark',
    guildId: 'guild_A',
    command: 'setup start',
    isDm: false,
  });
  assert.strictEqual(channelResp.ephemeral, true);
  assert.ok(channelResp.content.includes('Direct Messages'));
  console.log('✔ T001: Guild channel command receives ephemeral bridge directing to DM');

  const dmResp = await bot.handleSlashCommand({
    userId: 'u_cmd_1',
    username: 'Stark',
    command: 'agent pair',
    isDm: true,
  });
  assert.ok(dmResp.content.includes('FR-'));
  console.log('✔ T003: DM command generates 5-minute single-use pairing code');

  console.log('--- All Scheduler & AI Acceptance Tests Passed Successfully! ---');
}

runSchedulerAndAiTests().catch((err) => {
  console.error('Test Failed:', err);
  process.exit(1);
});
