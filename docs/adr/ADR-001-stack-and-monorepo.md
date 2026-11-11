# ADR-001: Architecture, Stack, and Monorepo Structure

## Context
The Frieren Discord Logbook Automation platform requires integrating a Discord bot, a local Git metadata scanner running on user laptops, an admin dashboard, a durable background scheduler, Gemini AI models, and DERMAGA portal automation with browser screenshot verification.
Existing codebases (`Oktavian19/bot-services` and `Oktavian19/logbook-cli`) provide established domain knowledge for DERMAGA form submission and Git scanning. However, the existing bot was built on Telegram and SQLite, whereas the target product requires a multi-guild Discord bot with strict DM privacy, local agent pairing, and dual AI prompts.

## Decision
We adopt a unified monorepo structure:
1. **Discord Bot Gateway (`apps/bot`)**: Node.js / TypeScript using `discord.js`. Manages slash commands, ephemeral acknowledgements, DM onboarding wizard, buttons, modals, and conversational replies.
2. **Backend API (`apps/api`)**: Node.js / TypeScript using Fastify. Exposes device pairing and commit snapshot ingestion (`/api/v1/agent/*`), internal service endpoints (`/internal/v1/*`), and admin dashboard APIs (`/admin/api/*`).
3. **Admin Dashboard (`apps/admin-dashboard`)**: Admin-only web application served behind static `.env` credentials. Regular users have no web accounts.
4. **Local Git Agent (`apps/local-agent`)**: Python application with Tkinter GUI. Scans user-allowlisted directories, runs offline queueing, and sends only commit metadata.
5. **DERMAGA Worker (`services/dermaga-worker`)**: Python service utilizing `BeautifulSoup4` for portal session/CSRF handling and `Playwright` Chromium for fresh-reload DOM verification and screenshot capture.
6. **Shared Packages (`packages/*`)**:
   - `packages/contracts`: Domain enums and validation schemas.
   - `packages/db`: Relational persistence (Postgres in production, SQLite support for test suites) and AES-256-GCM encryption.
   - `packages/scheduler`: Durable job queue supporting transaction locks, fake-clock testing, and scheduling rules.
   - `packages/ai`: Google GenAI SDK integration with key failover pool, Frieren English persona, and formal Indonesian logbook generator.

## Consequences
- Clean separation of concerns between Discord interactions, user laptop Git scanning, and third-party portal automation.
- No direct filesystem access from the server to user laptops.
- Easy testing through modular service boundaries and fixture injection.
