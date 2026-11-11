# Operational Runbook — Frieren Discord Logbook Automation

This runbook guides platform operators through deployment, configuration, Tailscale Funnel integration, and maintenance.

---

## 1. Quickstart Deployment

### Prerequisites
- Linux / Ubuntu / Debian VPS with Docker and Docker Compose installed.
- Tailscale daemon installed and logged in, with Tailscale Funnel enabled.
- Discord Application & Bot Token from [Discord Developer Portal](https://discord.com/developers/applications).
- Node.js 22+ and Python 3.11+ if running directly without containers.

### Step 1: Environment Setup
1. Copy the environment template:
   ```bash
   cp .env.example .env
   chmod 600 .env
   ```
2. Edit `.env` with your secret keys:
   ```dotenv
   DISCORD_BOT_TOKEN=your_token_here
   DISCORD_APPLICATION_ID=your_app_id_here
   DATABASE_ENCRYPTION_KEY=your_generated_random_32_byte_secret
   ADMIN_DASH_USERNAME=atmin
   ADMIN_DASH_PASSWORD=password123
   AGENT_API_PUBLIC_BASE_URL=https://your-server.tailscale-funnel.ts.net
   ```

### Step 2: Running via Docker Compose
Start all background services (Database, API, Bot, Worker):
```bash
docker compose -f infra/docker-compose.yml up -d --build
```
Verify container health:
```bash
docker compose -f infra/docker-compose.yml ps
```

---

## 2. Tailscale Funnel Integration

The platform operator uses an existing Tailscale Funnel deployment. Funnel terminates public HTTPS and forwards requests to local loopback.

1. **Verify Funnel status:**
   ```bash
   tailscale funnel status
   ```
2. **Forward traffic to the API service (`127.0.0.1:3100`):**
   ```bash
   tailscale funnel 3100 on
   ```
3. **Verify external accessibility:**
   Open `https://<your-tailnet-subdomain>.ts.net/admin` in your browser.
   You will see the Admin Sign In portal.
   Sign in using the configured `.env` credentials (`atmin` / `password123`).

---

## 3. Discord Bot Setup & Slash Commands

1. **Bot Permissions:**
   - In the Discord Developer Portal, enable **Privileged Gateway Intents**:
     - `SERVER MEMBERS INTENT` (for guild roster tracking)
     - `MESSAGE CONTENT INTENT` (for mention/reply conversational context)
2. **Invite Bot to Guild:**
   - Generate OAuth2 URL with scopes `bot` and `applications.commands`.
   - Permissions: `Send Messages`, `Embed Links`, `Attach Files`, `Read Message History`, `Mention Everyone` (for scoped participant mentions).
3. **User Flow:**
   - User types `/setup start` in any channel where the bot is invited.
   - The bot replies with an ephemeral message and initiates the private DM wizard.
   - User types `/agent install` in DM to receive the Windows/Linux installer.
   - User types `/agent pair` in DM to receive a single-use 5-minute code (`FR-XXXXX`).

---

## 4. Local Git Agent Setup (User Laptop)

1. **Download & Run:**
   - Windows: Run `frieren-agent-win.exe`
   - Linux: Run `chmod +x frieren-agent-linux && ./frieren-agent-linux`
2. **Configure Repositories:**
   - Click **Add Project Folder...** and select your project root (e.g. `C:\Users\Student\Projects\Inventory` or `/home/user/workspace/web-app`).
   - The agent automatically discovers any `.git` repository up to 3 folders deep.
3. **Pairing:**
   - Paste the code from Discord `/agent pair` into the pairing field.
   - Click **Claim Pairing Code**.
   - The device receives a secure bearer token saved locally in `.frieren_agent_config.json`.
4. **Syncing:**
   - Click **Sync Commits Now** or leave the agent running in the background.
   - The agent scans for commits on the target date, strips `.env` and sensitive files, and sends metadata to the server. If offline, commits are safely queued in `.frieren_agent_queue.db` until connection recovers.

---

## 5. Daily Schedule Lifecycle

- **16:00 Asia/Jakarta:** Frieren gathers today's Git commits from the paired agent, generates a formal Indonesian logbook draft, and sends a private DM review with action buttons.
- **16:15 (T+15 minutes):** The 15-minute review window closes. If auto-submit is enabled:
  - If the student's scheduled workday ends at **16:25**, submission is held in `AWAITING_WORK_END` until 16:25.
  - The student can click **Edit**, **Skip**, or **Cancel Auto-Submit** at any time before dispatch.
- **16:25:** The entry moves to `QUEUED_SUBMIT` and is dispatched to DERMAGA.
- **Post-Submission Proof:**
  - Playwright reloads the DERMAGA monitoring page in headless Chromium.
  - The verifier confirms the row exists in the fresh DOM.
  - Only after DOM confirmation is status marked `VERIFIED`.
  - A screenshot is captured, hashed (SHA-256), and sent privately to the student via DM.
- **Guild Channel Posts:**
  - At the guild's configured checklist time (e.g. 17:00), a checklist of enrolled participants is posted.
  - At final ping time (e.g. 18:30), only missing/unverified users are pinged.

---

## 6. Live DERMAGA Portal Validation Checklist

Before going live with real students:
1. [ ] Log into the DERMAGA portal manually to ensure no CAPTCHA or MFA has been introduced.
2. [ ] Test student login with real credentials via `/account connect` in Discord DM.
3. [ ] Verify that password is never printed in terminal logs (`[REDACTED]`).
4. [ ] Run one manual submission using `/logbook submit` and confirm that Playwright successfully reloads monitoring, captures the row screenshot, and DMs the image.
