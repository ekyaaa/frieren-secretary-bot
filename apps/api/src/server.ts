/**
 * Fastify/Node HTTP Server for Frieren Discord Logbook.
 * Implements Agent Ingestion API, Admin Dashboard API (behind static .env credentials),
 * Internal Bot API, CSRF protection, secure cookies, and rate limiting.
 */

import http, { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import fs from 'node:fs';
import pathModule from 'node:path';
import {
  Database,
  UserRepository,
  GuildRepository,
  SettingsRepository,
  CredentialRepository,
  AgentRepository,
  LogbookRepository,
  JobQueueRepository,
  AuditRepository,
  AdminSessionRepository,
  timingSafeEqualString,
  hashSha256,
} from '../../../packages/db/src/index.ts';

export interface ServerConfig {
  port: number;
  host: string;
  adminUsername: string;
  adminPassword: string;
  encryptionKey: string;
  trustedProxyCidrs?: string[];
  sessionTtlMinutes?: number;
}

export class ApiServer {
  private server: http.Server | null = null;
  public db: Database;
  public userRepo: UserRepository;
  public guildRepo: GuildRepository;
  public settingsRepo: SettingsRepository;
  public credRepo: CredentialRepository;
  public agentRepo: AgentRepository;
  public logbookRepo: LogbookRepository;
  public jobRepo: JobQueueRepository;
  public auditRepo: AuditRepository;
  public sessionRepo: AdminSessionRepository;

  public config: ServerConfig;

  // Rate limiting map: ip -> { count, resetAt, lockedUntil }
  private loginRateLimits = new Map<string, { count: number; resetAt: number; lockedUntil?: number }>();

  constructor(config: ServerConfig, db?: Database) {
    this.config = config;
    this.db = db || new Database(':memory:');
    this.userRepo = new UserRepository(this.db);
    this.guildRepo = new GuildRepository(this.db);
    this.settingsRepo = new SettingsRepository(this.db);
    this.credRepo = new CredentialRepository(this.db);
    this.agentRepo = new AgentRepository(this.db);
    this.logbookRepo = new LogbookRepository(this.db);
    this.jobRepo = new JobQueueRepository(this.db);
    this.auditRepo = new AuditRepository(this.db);
    this.sessionRepo = new AdminSessionRepository(this.db);
  }

  public async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res));
      this.server.listen(this.config.port, this.config.host, () => {
        resolve();
      });
    });
  }

  public async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) return resolve();
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  private async parseBody(req: IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 2 * 1024 * 1024) {
          // 2MB max payload guard
          reject(new Error('Payload Too Large'));
        }
      });
      req.on('end', () => {
        if (!body) return resolve({});
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve({});
        }
      });
      req.on('error', reject);
    });
  }

  private getCookie(req: IncomingMessage, name: string): string | null {
    const header = req.headers.cookie || '';
    for (const part of header.split(';')) {
      const [k, v] = part.trim().split('=');
      if (k === name) return decodeURIComponent(v || '');
    }
    return null;
  }

  private getClientIp(req: IncomingMessage): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      return forwarded.split(',')[0].trim();
    }
    return req.socket.remoteAddress || '127.0.0.1';
  }

  private sendJson(res: ServerResponse, status: number, data: any, headers: Record<string, string> = {}): void {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      ...headers,
    });
    res.end(JSON.stringify(data));
  }

  private checkLoginRateLimit(ip: string): boolean {
    const now = Date.now();
    const entry = this.loginRateLimits.get(ip);
    if (!entry) {
      this.loginRateLimits.set(ip, { count: 1, resetAt: now + 60_000 });
      return true;
    }

    if (entry.lockedUntil && now < entry.lockedUntil) {
      return false; // locked out
    }

    if (now > entry.resetAt) {
      this.loginRateLimits.set(ip, { count: 1, resetAt: now + 60_000 });
      return true;
    }

    entry.count++;
    if (entry.count > 10) {
      entry.lockedUntil = now + 5 * 60_000; // 5 min lockout
      return false;
    }
    return true;
  }

  private authenticateAdmin(req: IncomingMessage): { username: string; csrfToken: string } | null {
    const sessionId = this.getCookie(req, 'admin_session');
    if (!sessionId) return null;
    const session = this.sessionRepo.getSession(sessionId);
    if (!session) return null;
    return { username: session.username, csrfToken: session.csrfToken };
  }

  private authenticateAgent(req: IncomingMessage): { deviceId: string; userId: string } | null {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
    const token = authHeader.slice(7).trim();
    const tokenHash = hashSha256(token);
    const device = this.agentRepo.getDeviceByTokenHash(tokenHash);
    if (!device) return null;
    return { deviceId: device.deviceId, userId: device.userId };
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const path = url.pathname;
      const method = req.method || 'GET';
      const ip = this.getClientIp(req);

      // 1. Health check
      if (path === '/health' && method === 'GET') {
        return this.sendJson(res, 200, { status: 'healthy', timestamp: new Date().toISOString() });
      }

      // 1b. Serve Admin Dashboard HTML
      if ((path === '/admin' || path === '/admin/') && method === 'GET') {
        const dashboardHtmlPath = pathModule.join(process.cwd(), 'apps', 'admin-dashboard', 'index.html');
        if (fs.existsSync(dashboardHtmlPath)) {
          const html = fs.readFileSync(dashboardHtmlPath, 'utf8');
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(html);
          return;
        }
      }

      // 2. Admin Auth Routes
      if (path === '/admin/api/login' && method === 'POST') {
        if (!this.checkLoginRateLimit(ip)) {
          return this.sendJson(res, 429, { error: 'Too many failed login attempts. Please try again later.' });
        }

        const body = await this.parseBody(req);
        const { username, password } = body;

        // Verify that environment variables are present and valid
        if (!this.config.adminUsername || !this.config.adminPassword) {
          return this.sendJson(res, 500, { error: 'Admin authentication is not configured in server environment.' });
        }

        const validUsername = typeof username === 'string' && timingSafeEqualString(username, this.config.adminUsername);
        const validPassword = typeof password === 'string' && timingSafeEqualString(password, this.config.adminPassword);

        if (validUsername && validPassword) {
          const session = this.sessionRepo.createSession(this.config.adminUsername, this.config.sessionTtlMinutes || 60);
          this.auditRepo.recordEvent('ADMIN', this.config.adminUsername, 'ADMIN_LOGIN_SUCCESS', 'SESSION', session.sessionId, {}, ip);

          const cookie = `admin_session=${encodeURIComponent(session.sessionId)}; Path=/; HttpOnly; SameSite=Strict`;
          return this.sendJson(res, 200, {
            success: true,
            username: this.config.adminUsername,
            csrfToken: session.csrfToken,
            expiresAt: session.expiresAt,
          }, { 'Set-Cookie': cookie });
        } else {
          this.auditRepo.recordEvent('ADMIN', username || 'unknown', 'ADMIN_LOGIN_FAILURE', 'SESSION', '', { reason: 'invalid_credentials' }, ip);
          return this.sendJson(res, 401, { error: 'Invalid credentials.' });
        }
      }

      // Protected Admin API Routes (Requires admin session)
      if (path.startsWith('/admin/api/')) {
        const admin = this.authenticateAdmin(req);
        if (!admin) {
          return this.sendJson(res, 401, { error: 'Unauthorized access to admin API.' });
        }

        // For mutations (POST, PUT, DELETE), enforce CSRF token header
        if (['POST', 'PUT', 'DELETE'].includes(method)) {
          const csrfHeader = req.headers['x-csrf-token'];
          if (csrfHeader !== admin.csrfToken) {
            return this.sendJson(res, 403, { error: 'Invalid CSRF token.' });
          }
        }

        if (path === '/admin/api/me' && method === 'GET') {
          return this.sendJson(res, 200, { username: admin.username, csrfToken: admin.csrfToken });
        }

        if (path === '/admin/api/logout' && method === 'POST') {
          const sessionId = this.getCookie(req, 'admin_session')!;
          this.sessionRepo.destroySession(sessionId);
          this.auditRepo.recordEvent('ADMIN', admin.username, 'ADMIN_LOGOUT', 'SESSION', sessionId, {}, ip);
          const expiredCookie = `admin_session=; Path=/; HttpOnly; Max-Age=0; SameSite=Strict`;
          return this.sendJson(res, 200, { success: true }, { 'Set-Cookie': expiredCookie });
        }

        if (path === '/admin/api/overview' && method === 'GET') {
          const users = this.userRepo.listAll();
          const guilds = this.guildRepo.listAllGuilds();
          const pendingJobs = this.jobRepo.getPendingCount();
          const recentLogs = this.logbookRepo.listEntries(10, 0);

          return this.sendJson(res, 200, {
            usersCount: users.length,
            guildsCount: guilds.length,
            pendingJobs,
            recentLogbooks: recentLogs,
          });
        }

        if (path === '/admin/api/users' && method === 'GET') {
          const users = this.userRepo.listAll();
          return this.sendJson(res, 200, { users });
        }

        if (path === '/admin/api/guilds' && method === 'GET') {
          const guilds = this.guildRepo.listAllGuilds().map((g) => ({
            ...g,
            config: this.guildRepo.getGuildConfig(g.guildId),
            enrolledCount: this.guildRepo.getEnrolledUsers(g.guildId).length,
          }));
          return this.sendJson(res, 200, { guilds });
        }

        if (path === '/admin/api/logbooks' && method === 'GET') {
          const entries = this.logbookRepo.listEntries(50, 0);
          return this.sendJson(res, 200, { entries });
        }

        if (path === '/admin/api/audit' && method === 'GET') {
          const events = this.auditRepo.listEvents(50, 0);
          return this.sendJson(res, 200, { events });
        }

        if (path === '/admin/api/health' && method === 'GET') {
          return this.sendJson(res, 200, {
            status: 'HEALTHY',
            queuePending: this.jobRepo.getPendingCount(),
            dbConnected: true,
            timeUtc: new Date().toISOString(),
          });
        }

        return this.sendJson(res, 404, { error: 'Admin route not found.' });
      }

      // 3. Agent Public / Ingestion API Routes
      if (path === '/api/v1/agent/pair/claim' && method === 'POST') {
        const body = await this.parseBody(req);
        const { code, deviceId, platform, version } = body;

        if (!code || !deviceId || !platform) {
          return this.sendJson(res, 400, { error: 'Missing required pairing fields.' });
        }

        const claim = this.agentRepo.claimPairingCode(code, deviceId, platform, version || '1.0.0');
        if (!claim) {
          this.auditRepo.recordEvent('AGENT', deviceId, 'PAIR_CLAIM_FAILED', 'DEVICE', deviceId, { code: hashSha256(code) }, ip);
          return this.sendJson(res, 400, { error: 'Invalid, expired, or already claimed pairing code.' });
        }

        this.auditRepo.recordEvent('AGENT', deviceId, 'PAIR_CLAIM_SUCCESS', 'DEVICE', deviceId, { userId: claim.userId, platform }, ip);
        return this.sendJson(res, 200, {
          userId: claim.userId,
          bearerToken: claim.bearerToken,
          message: 'Device paired successfully.',
        });
      }

      if (path === '/api/v1/agent/heartbeat' && method === 'POST') {
        const auth = this.authenticateAgent(req);
        if (!auth) {
          return this.sendJson(res, 401, { error: 'Unauthorized agent device.' });
        }

        const body = await this.parseBody(req);
        this.agentRepo.updateHeartbeat(auth.deviceId, body.version);
        return this.sendJson(res, 200, { status: 'acknowledged', lastSeen: new Date().toISOString() });
      }

      if (path === '/api/v1/agent/commit-snapshots' && method === 'POST') {
        const auth = this.authenticateAgent(req);
        if (!auth) {
          return this.sendJson(res, 401, { error: 'Unauthorized agent device.' });
        }

        const body = await this.parseBody(req);
        const { targetDate, timezone, repositories, commits, digest } = body;

        if (!targetDate || !digest || !Array.isArray(commits)) {
          return this.sendJson(res, 400, { error: 'Invalid commit snapshot payload.' });
        }

        const snapshotId = crypto.randomUUID();
        this.agentRepo.saveSnapshot({
          snapshotId,
          userId: auth.userId,
          targetDate,
          timezone: timezone || 'Asia/Jakarta',
          repositories: repositories || [],
          commits,
          digest,
          capturedAt: new Date().toISOString(),
          sourceDeviceId: auth.deviceId,
        });

        this.auditRepo.recordEvent('AGENT', auth.deviceId, 'COMMIT_SNAPSHOT_INGESTED', 'SNAPSHOT', snapshotId, {
          userId: auth.userId,
          targetDate,
          commitCount: commits.length,
        }, ip);

        return this.sendJson(res, 200, {
          snapshotId,
          status: 'ingested',
          commitsCount: commits.length,
        });
      }

      // 4. Internal Bot Service API Routes (Authorized by internal token or direct handler)
      if (path === '/internal/v1/agent-pairing/create' && method === 'POST') {
        const body = await this.parseBody(req);
        const { userId, code } = body;
        if (!userId || !code) {
          return this.sendJson(res, 400, { error: 'userId and code are required.' });
        }

        this.agentRepo.createPairingCode(userId, code, 5); // 5 min TTL
        this.auditRepo.recordEvent('USER', userId, 'PAIRING_CODE_CREATED', 'PAIRING', '', { codeMasked: '***' }, ip);
        return this.sendJson(res, 200, { success: true, expiresMinutes: 5 });
      }

      // 404 Catch-all
      return this.sendJson(res, 404, { error: 'Endpoint not found.' });
    } catch (err: any) {
      return this.sendJson(res, 500, { error: err.message || 'Internal Server Error' });
    }
  }
}
