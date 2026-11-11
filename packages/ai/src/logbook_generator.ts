/**
 * Formal Indonesian DERMAGA Logbook Summary Generator.
 * Authoritative source: docs/LOGBOOK_FORMAL_PROMPT.md
 * Strictly formal Indonesian paragraph, no persona, no fabricated tasks.
 */

import fs from 'node:fs';
import path from 'node:path';
import { GeminiKeyRouter } from './key_router.ts';
import type { GeminiCaller } from './key_router.ts';
import type { CommitInfo } from '../../contracts/src/types.ts';

export interface LogbookGenerationResult {
  summary: string;
  sourceCommitIds: string[];
  warnings: string[];
  requiresManualInput: boolean;
  usedKeyId?: string;
  source: 'GEMINI_FROM_GIT' | 'MANUAL_FALLBACK';
}

export class LogbookGeneratorService {
  private systemInstruction: string = '';
  private router: GeminiKeyRouter;

  constructor(router: GeminiKeyRouter, promptPath?: string) {
    this.router = router;
    this.loadSystemInstruction(promptPath);
  }

  private loadSystemInstruction(customPath?: string): void {
    const candidatePaths = [
      customPath,
      path.join(process.cwd(), 'docs', 'LOGBOOK_FORMAL_PROMPT.md'),
      path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..', 'docs', 'LOGBOOK_FORMAL_PROMPT.md'),
    ].filter(Boolean) as string[];

    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        this.systemInstruction = fs.readFileSync(p, 'utf8');
        return;
      }
    }

    this.systemInstruction = 'You are an assistant that drafts a concise, professional Indonesian-language internship logbook summary.';
  }

  public getSystemInstruction(): string {
    return this.systemInstruction;
  }

  /**
   * Generates a formal Indonesian logbook summary based on commit evidence.
   */
  public async generateSummary(
    targetDate: string,
    commits: CommitInfo[],
    userNotes?: string,
    caller?: GeminiCaller,
    userKey?: string
  ): Promise<LogbookGenerationResult> {
    // 1. Zero commit guard: never fabricate activities
    if (!commits || commits.length === 0) {
      if (userNotes && userNotes.trim().length > 0) {
        return {
          summary: userNotes.trim(),
          sourceCommitIds: [],
          warnings: ['USER_SUPPLIED_NOTES_ONLY'],
          requiresManualInput: false,
          source: 'MANUAL_FALLBACK',
        };
      }
      return {
        summary: '',
        sourceCommitIds: [],
        warnings: ['NO_COMMITS_DETECTED'],
        requiresManualInput: true,
        source: 'MANUAL_FALLBACK',
      };
    }

    // 2. Prepare structured sanitized evidence
    const sanitizedCommits = commits.map((c) => ({
      id: `${c.repoId}:${c.hash.slice(0, 7)}`,
      subject: this.redactPotentialSecrets(c.subject),
      body: this.redactPotentialSecrets(c.body || ''),
      stats: c.changedFileStats,
    }));

    const promptPayload = {
      targetDate,
      timezone: 'Asia/Jakarta',
      commits: sanitizedCommits,
      userNotes: userNotes ? this.redactPotentialSecrets(userNotes) : undefined,
    };

    const prompt =
      'Berdasarkan data komit Git berikut, susunlah draf laporan harian magang formal dalam satu paragraf bahasa Indonesia yang padat dan profesional. ' +
      'Kembalikan respons HANYA dalam format JSON valid tanpa code fences:\n' +
      '{\n' +
      '  "summary": "Melakukan ...",\n' +
      '  "source_commit_ids": ["repo:sha"],\n' +
      '  "warnings": [],\n' +
      '  "requires_manual_input": false\n' +
      '}\n\n' +
      JSON.stringify(promptPayload);

    // 3. Call Gemini if caller provided
    if (caller) {
      try {
        const response = await this.router.executeWithFailover(caller, prompt, this.systemInstruction, userKey);
        const parsed = this.parseAndValidateOutput(response.text, sanitizedCommits.map((c) => c.id));
        if (parsed) {
          return {
            ...parsed,
            usedKeyId: response.usedKeyId,
            source: 'GEMINI_FROM_GIT',
          };
        }
      } catch {
        // Fall back to deterministic summary
      }
    }

    // 4. Deterministic factual fallback generator (non-AI)
    return this.generateDeterministicSummary(sanitizedCommits, userNotes);
  }

  private parseAndValidateOutput(
    rawText: string,
    allowedCommitIds: string[]
  ): Omit<LogbookGenerationResult, 'source'> | null {
    try {
      let cleanJson = rawText.trim();
      if (cleanJson.startsWith('```json')) {
        cleanJson = cleanJson.slice(7);
      }
      if (cleanJson.startsWith('```')) {
        cleanJson = cleanJson.slice(3);
      }
      if (cleanJson.endsWith('```')) {
        cleanJson = cleanJson.slice(0, -3);
      }
      cleanJson = cleanJson.trim();

      const obj = JSON.parse(cleanJson);
      if (typeof obj.summary === 'string') {
        const validIds = Array.isArray(obj.source_commit_ids)
          ? obj.source_commit_ids.filter((id: string) => allowedCommitIds.includes(id))
          : allowedCommitIds;

        return {
          summary: obj.summary.trim(),
          sourceCommitIds: validIds,
          warnings: Array.isArray(obj.warnings) ? obj.warnings : [],
          requiresManualInput: obj.requires_manual_input === true,
        };
      }
    } catch {}
    return null;
  }

  private generateDeterministicSummary(
    commits: { id: string; subject: string }[],
    userNotes?: string
  ): LogbookGenerationResult {
    const subjects = commits.map((c) => c.subject).filter(Boolean);
    const summary = `Melakukan pengerjaan teknis pada repositori proyek mencakup: ${subjects.join(', ')}.${userNotes ? ` Catatan tambahan: ${userNotes}` : ''}`;

    return {
      summary,
      sourceCommitIds: commits.map((c) => c.id),
      warnings: ['AI_UNAVAILABLE_FALLBACK_USED'],
      requiresManualInput: false,
      source: 'MANUAL_FALLBACK',
    };
  }

  private redactPotentialSecrets(text: string): string {
    return text
      .replace(/(?:api[_-]?key|secret|token|password)\s*[:=]\s*[^\s]+/gi, '[REDACTED_SECRET]')
      .replace(/ghp_[a-zA-Z0-9]{36}/g, '[REDACTED_GITHUB_TOKEN]');
  }
}
