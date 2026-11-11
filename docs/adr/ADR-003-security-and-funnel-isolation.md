# ADR-003: Security Boundaries, Static Admin Authentication, and Tailscale Funnel

## Context
The platform operator runs an existing Tailscale Funnel exposing local ports to the public internet and has explicitly requested static username/password authentication (`ADMIN_DASH_USERNAME=atmin`, `ADMIN_DASH_PASSWORD=password123`) configured exclusively via private `.env`. Normal Discord users must never have web login accounts. Furthermore, user laptops contain proprietary source code that must never be exposed to the server.

## Decision
1. **Admin Surface & Funnel Ingress**:
   - The admin dashboard is bound to loopback (`ADMIN_BIND_HOST=127.0.0.1`, `ADMIN_BIND_PORT=3100`) where the operator's existing Tailscale Funnel terminates public HTTPS traffic.
   - We do not modify or overwrite existing Tailscale configurations.
   - Static credentials are read strictly from process environment variables at runtime (`process.env.ADMIN_DASH_USERNAME`, `process.env.ADMIN_DASH_PASSWORD`). No fallback defaults are hardcoded in source code.
   - Brute-force protection: IP-based and username-based rate-limiting with exponential backoff and timing-safe password comparison.
   - Sessions are managed via encrypted, HttpOnly, Secure, SameSite cookies with CSRF validation on all mutation endpoints.
2. **Local Agent Isolation**:
   - The Local Git Agent interacts only with `/api/v1/agent/*`.
   - Device pairing issues a 5-minute, single-use numeric code in Discord DM.
   - When claimed, the server exchanges the code for a cryptographically random device bearer token, storing only its SHA-256 hash in the database.
   - The agent scans only user-allowlisted directories on the laptop. It never transmits source file contents, private Git tokens, or `.env` files.
3. **Data at Rest & Secret Hygiene**:
   - DERMAGA passwords and user Gemini API keys are encrypted at rest using AES-256-GCM with a server-side encryption key (`DATABASE_ENCRYPTION_KEY`).
   - All logs, errors, and public Discord outputs are strictly redacted of credentials, API keys, and sensitive tokens.
   - Ephemeral messages are used for channel slash commands, while all operational workflows continue in private DMs.

## Consequences
- Operator's chosen configuration is respected without compromising server security hygiene.
- Regular users cannot access or tamper with administrative functions.
- Zero leakage of student source code, Git credentials, or portal passwords.
