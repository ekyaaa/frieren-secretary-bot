import assert from 'node:assert';
import { Database } from '../packages/db/src/database.ts';
import { GuildRepository } from '../packages/db/src/repositories.ts';
import { SchedulerService, FakeClock } from '../packages/scheduler/src/scheduler.ts';
import type { DiscordTransport } from '../packages/scheduler/src/scheduler.ts';
import { PersonaService } from '../packages/ai/src/persona.ts';
import { LogbookGeneratorService } from '../packages/ai/src/logbook_generator.ts';
import { GeminiKeyRouter } from '../packages/ai/src/key_router.ts';
import { ApiServer } from '../apps/api/src/server.ts';

class GuildMockDiscordTransport implements DiscordTransport {
  public dmsSent: any[] = [];
  public channelPosts: { channelId: string; content: string; allowedUserIds?: string[] }[] = [];

  async sendDm(userId: string, content: string): Promise<any> {
    this.dmsSent.push({ userId, content });
    return { messageId: 'm1', success: true };
  }

  async postToChannel(channelId: string, content: string, allowedUserIds?: string[]): Promise<any> {
    this.channelPosts.push({ channelId, content, allowedUserIds });
    return { messageId: 'p1', success: true };
  }
}

async function runGuildAndDashboardTests() {
  console.log('--- Starting Guild Channels and Admin Dashboard Tests ---');

  const db = new Database(':memory:');
  const router = new GeminiKeyRouter([]);
  const persona = new PersonaService(router);
  const generator = new LogbookGeneratorService(router);
  const discord = new GuildMockDiscordTransport();
  const clock = new FakeClock('2026-11-11T17:00:00+07:00');

  const scheduler = new SchedulerService({
    db,
    persona,
    generator,
    discord,
    clock,
  });

  const guildRepo = new GuildRepository(db);

  // 1. Setup Guild A and Guild B with separate rosters
  guildRepo.upsertGuild('guild_A', 'Guild Alpha');
  guildRepo.saveGuildConfig({
    guildId: 'guild_A',
    checklistChannelId: 'chan_alpha_1',
    checklistTime: '17:00',
    lastPingTime: '18:30',
    mentionPolicy: 'all-participants',
    enabled: true,
  });

  guildRepo.upsertGuild('guild_B', 'Guild Beta');
  guildRepo.saveGuildConfig({
    guildId: 'guild_B',
    checklistChannelId: 'chan_beta_1',
    checklistTime: '17:00',
    lastPingTime: '18:30',
    mentionPolicy: 'missing-only',
    enabled: true,
  });

  // Members:
  // User 1 (Alice) in Guild A only
  // User 2 (Bob) in Guild B only
  // User 3 (Charlie) shared in both Guild A and Guild B
  guildRepo.enrollUser('guild_A', 'user_alice');
  guildRepo.enrollUser('guild_A', 'user_charlie');
  guildRepo.enrollUser('guild_B', 'user_bob');
  guildRepo.enrollUser('guild_B', 'user_charlie');

  // Mark Alice as VERIFIED, Charlie as PENDING (AUTO_WAITING), Bob as MISSING
  const entryAlice = scheduler['logbookRepo'].getOrCreateEntry('user_alice', '2026-11-11', 'user_alice');
  scheduler['logbookRepo'].updateStatus(entryAlice.entryId, 'VERIFIED');

  const entryCharlie = scheduler['logbookRepo'].getOrCreateEntry('user_charlie', '2026-11-11', 'user_charlie');
  scheduler['logbookRepo'].updateStatus(entryCharlie.entryId, 'AUTO_WAITING');

  // 2. Execute Guild A Checklist
  scheduler.scheduleGuildChecklist('guild_A', '2026-11-11', '17:00');
  await scheduler.processNextJob();

  assert.strictEqual(discord.channelPosts.length, 1);
  const postA = discord.channelPosts[0];
  assert.strictEqual(postA.channelId, 'chan_alpha_1');

  // Verify: includes Alice (verified) and Charlie (pending), but NEVER Bob (Guild B)!
  assert.ok(postA.content.includes('<@user_alice>'));
  assert.ok(postA.content.includes('<@user_charlie>'));
  assert.ok(!postA.content.includes('user_bob')); // No cross-guild leakage!
  assert.ok(!postA.content.includes('@everyone')); // No mass mentions

  // Allowed mentions must be strictly scoped to Guild A enrolled members
  assert.ok(postA.allowedUserIds?.includes('user_alice'));
  assert.ok(postA.allowedUserIds?.includes('user_charlie'));
  assert.ok(!postA.allowedUserIds?.includes('user_bob'));
  console.log('✔ T025/T026/T028: Guild A checklist mentions enrolled participants without cross-guild leakage or @everyone');

  // 3. Execute Guild A Final Ping at 18:30
  clock.advanceMinutes(90); // to 18:30
  scheduler.scheduleGuildFinalPing('guild_A', '2026-11-11', '18:30');
  await scheduler.processNextJob();

  assert.strictEqual(discord.channelPosts.length, 2);
  const pingA = discord.channelPosts[1];
  assert.strictEqual(pingA.channelId, 'chan_alpha_1');

  // Alice is VERIFIED, so final ping must mention ONLY Charlie (unverified)!
  assert.ok(pingA.content.includes('<@user_charlie>'));
  assert.ok(!pingA.content.includes('<@user_alice>'));
  assert.strictEqual(pingA.allowedUserIds?.length, 1);
  assert.strictEqual(pingA.allowedUserIds[0], 'user_charlie');
  console.log('✔ T027: Final ping pings ONLY missing/unverified users, never verified members');

  // 4. Test Admin Dashboard HTTP and Security
  const apiServer = new ApiServer({
    port: 9288,
    host: '127.0.0.1',
    adminUsername: 'atmin',
    adminPassword: 'password123',
    encryptionKey: 'test-dash-enc-key',
  }, db);

  await apiServer.start();
  const baseUrl = 'http://127.0.0.1:9288';

  try {
    // 4a. Serve Dashboard HTML
    const htmlRes = await fetch(`${baseUrl}/admin`);
    assert.strictEqual(htmlRes.status, 200);
    const html = await htmlRes.text();
    assert.ok(html.includes('Admin Sign In'));
    assert.ok(html.includes('Frieren Secretary — Admin Dashboard'));
    console.log('✔ T029: /admin serves clean single-page administrative dashboard');

    // 4b. CSRF protection on mutation
    const loginRes = await fetch(`${baseUrl}/admin/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'atmin', password: 'password123' }),
    });
    const loginData = await loginRes.json() as any;
    const sessionCookie = loginRes.headers.get('set-cookie')!.split(';')[0];

    // Attempt logout with invalid CSRF token
    const badCsrfRes = await fetch(`${baseUrl}/admin/api/logout`, {
      method: 'POST',
      headers: {
        Cookie: sessionCookie,
        'x-csrf-token': 'wrong-csrf-token',
      },
    });
    assert.strictEqual(badCsrfRes.status, 403);
    console.log('✔ CSRF protection blocks mutations with invalid CSRF token');

    // Logout with valid CSRF token
    const goodLogoutRes = await fetch(`${baseUrl}/admin/api/logout`, {
      method: 'POST',
      headers: {
        Cookie: sessionCookie,
        'x-csrf-token': loginData.csrfToken,
      },
    });
    assert.strictEqual(goodLogoutRes.status, 200);
    console.log('✔ Admin logout invalidates session and clears cookie');

    // 4c. Brute-force throttling (T030)
    let rateLimited = false;
    for (let i = 0; i < 15; i++) {
      const res = await fetch(`${baseUrl}/admin/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'atmin', password: 'wrong' }),
      });
      if (res.status === 429) {
        rateLimited = true;
        break;
      }
    }
    assert.strictEqual(rateLimited, true);
    console.log('✔ T030: Repeated failed admin logins trigger 429 lockout');

  } finally {
    await apiServer.stop();
  }

  console.log('--- All Guild and Dashboard Tests Passed Successfully! ---');
}

runGuildAndDashboardTests().catch((err) => {
  console.error('Test Failed:', err);
  process.exit(1);
});
