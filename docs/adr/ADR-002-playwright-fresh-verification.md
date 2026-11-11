# ADR-002: Playwright Fresh-Reload Verification and Screenshot Evidence

## Context
Third-party university attendance portals like DERMAGA often return HTTP 200 responses or generic success banners even when an entry fails validation or encounters backend database latency. A screenshot captured immediately after form submission without a page reload is prone to capturing stale DOM state or optimistic UI toasts that do not reflect persisted server data.

## Decision
1. **Two-Phase Status Classification**:
   - HTTP 200 upon form submission marks the logbook status as `SUBMITTED_UNVERIFIED`.
   - The status is never updated to `VERIFIED` based solely on the POST response.
2. **Fresh-Reload Protocol**:
   - Following submission, Playwright opens a fresh browser context or navigates to the monitoring page URL (`page.goto(MONITORING_URL)`) and triggers a fresh reload (`page.reload()`).
   - The verifier waits for the monitoring table DOM to load.
   - The verifier searches for a table row/card matching:
     - The authenticated student account.
     - The target date.
     - The submitted summary or work hours.
3. **Evidence Generation**:
   - Only upon finding a verified DOM match is the status updated to `VERIFIED`.
   - Playwright captures an element or viewport screenshot of the matching row and surrounding context.
   - The screenshot is hashed (SHA-256) and saved in a non-public storage volume.
   - The screenshot is sent privately to the student via Discord DM. It is **never** posted to a guild channel.
4. **Decoupled Evidence Failure**:
   - If DOM verification succeeds but screenshot capture or DM delivery fails, the submission remains `VERIFIED` and the evidence status is flagged as `SCREENSHOT_FAILED` or `DM_FAILED`.
   - The system **never** re-submits the form to fix a failed screenshot.

## Consequences
- False positive submissions are completely prevented.
- Complete auditability with SHA-256 evidence hashes.
- Reliable reconciliation during network timeouts or retry attempts.
