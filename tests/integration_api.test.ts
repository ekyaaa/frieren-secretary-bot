import { ApiServer } from '../apps/api/src/server.ts';
import { Database } from '../packages/db/src/database.ts';
import assert from 'node:assert';

async function runApiTests() {
  const db = new Database(':memory:');
  const server = new ApiServer({
    port: 9123,
    host: '127.0.0.1',
    adminUsername: 'atmin',
    adminPassword: 'password123',
    encryptionKey: 'test-encryption-key-for-database',
  }, db);

  await server.start();
  const baseUrl = 'http://127.0.0.1:9123';

  try {
    // 1. Health check
    const healthRes = await fetch(`${baseUrl}/health`);
    assert.strictEqual(healthRes.status, 200);
    const healthBody = await healthRes.json() as any;
    assert.strictEqual(healthBody.status, 'healthy');

    // 2. Admin login with correct credentials
    const loginRes = await fetch(`${baseUrl}/admin/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'atmin', password: 'password123' }),
    });
    assert.strictEqual(loginRes.status, 200);
    const loginBody = await loginRes.json() as any;
    assert.strictEqual(loginBody.success, true);
    assert.ok(loginBody.csrfToken);

    const setCookie = loginRes.headers.get('set-cookie');
    assert.ok(setCookie?.includes('admin_session='));
    const sessionCookie = setCookie!.split(';')[0];

    // 3. Admin login with wrong credentials
    const badLoginRes = await fetch(`${baseUrl}/admin/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'atmin', password: 'wrongpassword' }),
    });
    assert.strictEqual(badLoginRes.status, 401);

    // 4. Admin API overview without session cookie
    const unauthRes = await fetch(`${baseUrl}/admin/api/overview`);
    assert.strictEqual(unauthRes.status, 401);

    // 5. Admin API overview with valid session cookie
    const overviewRes = await fetch(`${baseUrl}/admin/api/overview`, {
      headers: { Cookie: sessionCookie },
    });
    assert.strictEqual(overviewRes.status, 200);
    const overviewBody = await overviewRes.json() as any;
    assert.ok(overviewBody.usersCount !== undefined);

    // 6. Agent Pairing Flow
    // Create pairing code via internal route
    const pairCreateRes = await fetch(`${baseUrl}/internal/v1/agent-pairing/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'u-999', code: 'FR-12345' }),
    });
    assert.strictEqual(pairCreateRes.status, 200);

    // Claim pairing code
    const claimRes = await fetch(`${baseUrl}/api/v1/agent/pair/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: 'FR-12345',
        deviceId: 'device-laptop-01',
        platform: 'linux',
        version: '1.0.0',
      }),
    });
    assert.strictEqual(claimRes.status, 200);
    const claimBody = await claimRes.json() as any;
    assert.strictEqual(claimBody.userId, 'u-999');
    assert.ok(claimBody.bearerToken.startsWith('agt_'));
    const bearerToken = claimBody.bearerToken;

    // Second claim with same code fails (one-time use)
    const replayClaimRes = await fetch(`${baseUrl}/api/v1/agent/pair/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: 'FR-12345',
        deviceId: 'device-laptop-02',
        platform: 'linux',
      }),
    });
    assert.strictEqual(replayClaimRes.status, 400);

    // Heartbeat with bearer token
    const heartbeatRes = await fetch(`${baseUrl}/api/v1/agent/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bearerToken}`,
      },
      body: JSON.stringify({ version: '1.0.1' }),
    });
    assert.strictEqual(heartbeatRes.status, 200);

    // Heartbeat with invalid token fails
    const badHeartbeatRes = await fetch(`${baseUrl}/api/v1/agent/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer agt_invalid_fake_token`,
      },
    });
    assert.strictEqual(badHeartbeatRes.status, 401);

    // Ingest Commit Snapshot
    const snapshotRes = await fetch(`${baseUrl}/api/v1/agent/commit-snapshots`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bearerToken}`,
      },
      body: JSON.stringify({
        targetDate: '2026-11-11',
        timezone: 'Asia/Jakarta',
        repositories: [{ repoId: 'r1', alias: 'frieren-bot', branch: 'main' }],
        commits: [
          {
            repoId: 'r1',
            hash: 'abcdef123',
            author: 'student@example.com',
            committedAt: '2026-11-11T10:00:00+07:00',
            subject: 'feat: add agent pairing',
            body: 'Implement pairing claim logic',
            changedFileStats: { files: 3, insertions: 45, deletions: 2 },
          },
        ],
        digest: 'sha256-digest-of-snapshot',
      }),
    });
    assert.strictEqual(snapshotRes.status, 200);
    const snapshotBody = await snapshotRes.json() as any;
    assert.strictEqual(snapshotBody.status, 'ingested');
    assert.strictEqual(snapshotBody.commitsCount, 1);

    // Check that snapshot is in DB
    const savedSnapshot = server.agentRepo.getLatestSnapshot('u-999', '2026-11-11');
    assert.ok(savedSnapshot);
    assert.strictEqual(savedSnapshot.commits.length, 1);
    assert.strictEqual(savedSnapshot.commits[0].hash, 'abcdef123');

    // Admin audit trail check
    const auditRes = await fetch(`${baseUrl}/admin/api/audit`, {
      headers: { Cookie: sessionCookie },
    });
    assert.strictEqual(auditRes.status, 200);
    const auditBody = await auditRes.json() as any;
    assert.ok(auditBody.events.length >= 4);

    console.log('All API Integration Tests passed successfully!');
  } finally {
    await server.stop();
  }
}

runApiTests().catch((err) => {
  console.error('API Test Error:', err);
  process.exit(1);
});
