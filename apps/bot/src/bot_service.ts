/**
 * Discord Bot Interaction Service for Frieren Discord Logbook.
 * Handles slash commands, ephemeral bridge replies in channels,
 * private DM wizards, action buttons, modals, and conversational replies.
 * Authoritative source: docs/FRIEREN_DISCORD_LOGBOOK_PRD.md §8 & docs/frieren_gemini_example_english.md
 */

import {
  Database,
  UserRepository,
  GuildRepository,
  SettingsRepository,
  CredentialRepository,
  AgentRepository,
  LogbookRepository,
  generatePairingCode,
} from '../../../packages/db/src/index.ts';
import { PersonaService } from '../../../packages/ai/src/persona.ts';
import { LogbookGeneratorService } from '../../../packages/ai/src/logbook_generator.ts';
import crypto from 'node:crypto';

export interface InteractionResponse {
  content: string;
  ephemeral?: boolean;
  components?: any[];
}

export class BotService {
  public db: Database;
  public userRepo: UserRepository;
  public guildRepo: GuildRepository;
  public settingsRepo: SettingsRepository;
  public credRepo: CredentialRepository;
  public agentRepo: AgentRepository;
  public logbookRepo: LogbookRepository;
  public persona: PersonaService;
  public generator: LogbookGeneratorService;

  constructor(options: {
    db: Database;
    persona: PersonaService;
    generator: LogbookGeneratorService;
  }) {
    this.db = options.db;
    this.userRepo = new UserRepository(this.db);
    this.guildRepo = new GuildRepository(this.db);
    this.settingsRepo = new SettingsRepository(this.db);
    this.credRepo = new CredentialRepository(this.db);
    this.agentRepo = new AgentRepository(this.db);
    this.logbookRepo = new LogbookRepository(this.db);
    this.persona = options.persona;
    this.generator = options.generator;
  }

  /**
   * Routes incoming slash command.
   * If invoked in a guild channel, returns ephemeral bridge reply,
   * while all sensitive and configuration data happens in DM.
   */
  public async handleSlashCommand(options: {
    userId: string;
    username: string;
    guildId?: string;
    command: string;
    args?: Record<string, any>;
    isDm: boolean;
  }): Promise<InteractionResponse> {
    const { userId, username, guildId, command, args, isDm } = options;

    // Ensure user exists
    const user = this.userRepo.getOrCreate(userId, username);
    if (guildId) {
      this.guildRepo.upsertGuild(guildId);
      this.guildRepo.enrollUser(guildId, userId);
      if (!user.homeGuildId) {
        this.userRepo.setHomeGuild(userId, guildId);
      }
    }

    // Ephemeral bridge guard: If command is run in guild channel and is a setup or personal command,
    // acknowledge ephemerally and direct user to private DM
    if (!isDm && ['setup', 'agent', 'account', 'logbook', 'settings'].some((c) => command.startsWith(c))) {
      return {
        content: "I've sent the details to your Direct Messages to keep your account and Git data private. Please check our DM.",
        ephemeral: true,
      };
    }

    switch (command) {
      case 'help':
        return {
          content:
            "**Frieren Secretary — Commands Guide**\n" +
            "• `/setup start` — Begin or resume the setup wizard in DM.\n" +
            "• `/setup status` — Check readiness of credentials and paired agent.\n" +
            "• `/agent install` — Download or get release link for Windows / Linux agent.\n" +
            "• `/agent pair` — Generate a single-use 5-minute pairing code.\n" +
            "• `/agent status` — Inspect your paired laptop agent status.\n" +
            "• `/logbook today` — View today's logbook status, draft, and controls.\n" +
            "• `/settings view` — View your current schedule and auto-submit preference.\n" +
            "• `/settings auto-submit enabled:<true|false>` — Opt-in or opt-out of auto-submit.\n" +
            "All setup and verification evidence occur strictly in private DMs.",
        };

      case 'setup start':
        return {
          content:
            "**Welcome to Frieren Logbook Setup**\n" +
            "Let's get you ready for internship reporting without hassle:\n" +
            "1. **Local Agent**: Run `/agent install` and `/agent pair` to connect your Git repositories.\n" +
            "2. **DERMAGA**: Connect your portal login via `/account connect`.\n" +
            "3. **Settings**: Your daily reminder is set to **16:00** with auto-submit **OFF** by default.\n" +
            "Use `/setup status` at any time to verify readiness.",
        };

      case 'setup status': {
        const creds = this.credRepo.getDermagaCredentials(userId, 'server-secret-key');
        const devices = this.agentRepo.listUserDevices(userId);
        const settings = this.settingsRepo.getSettings(userId);

        const dermagaReady = creds !== null;
        const agentReady = devices.length > 0;
        const overallReady = dermagaReady && agentReady;

        this.userRepo.updateSetupStatus(userId, overallReady ? 'READY' : 'INCOMPLETE');

        return {
          content:
            `**Setup Status for ${username}:**\n` +
            `• DERMAGA Account: ${dermagaReady ? '✅ Connected' : '❌ Missing (/account connect)'}\n` +
            `• Local Agent: ${agentReady ? `✅ Paired (${devices.length} device)` : '❌ Unpaired (/agent pair)'}\n` +
            `• Schedule: Reminder at ${settings.reminderTime}, Work ${settings.startTime}–${settings.endTime}\n` +
            `• Auto-Submit: ${settings.autoSubmitEnabled ? '✅ ON' : '⚪ OFF (Manual approval)'}\n` +
            `• Readiness: **${overallReady ? 'READY' : 'INCOMPLETE'}**`,
        };
      }

      case 'agent install':
        return {
          content:
            "**Install Frieren Local Git Agent**\n" +
            "Select your operating system to install the lightweight local Git scanner:\n" +
            "• **Windows**: [Download .exe Release](https://github.com/Oktavian19/frieren-agent/releases/latest/download/frieren-agent-win.exe)\n" +
            "• **Linux**: [Download .AppImage Release](https://github.com/Oktavian19/frieren-agent/releases/latest/download/frieren-agent-linux.AppImage)\n\n" +
            "Once installed, open the application and use `/agent pair` to link your laptop.",
        };

      case 'agent pair': {
        const code = generatePairingCode();
        this.agentRepo.createPairingCode(userId, code, 5); // 5 min TTL
        return {
          content:
            `**Your Device Pairing Code:** \`${code}\`\n` +
            `Enter this code into your Local Agent application.\n` +
            `*This code is single-use and expires in 5 minutes.*`,
        };
      }

      case 'agent status': {
        const devices = this.agentRepo.listUserDevices(userId);
        if (devices.length === 0) {
          return { content: "No paired devices found. Run `/agent pair` to connect your laptop." };
        }
        const dev = devices[0];
        return {
          content:
            `**Paired Device Status:**\n` +
            `• Device ID: \`${dev.deviceId.slice(0, 8)}...\`\n` +
            `• Platform: \`${dev.platform}\` (v${dev.version})\n` +
            `• Last Heartbeat: ${dev.lastSeen}\n` +
            `• Last Git Sync: ${dev.lastSync || 'Never'}`,
        };
      }

      case 'logbook today': {
        const today = new Date().toISOString().slice(0, 10);
        const entry = this.logbookRepo.getEntryByUserAndDate(userId, today);
        if (!entry) {
          return { content: `No logbook entry found for today (${today}). It will be generated at your reminder time (16:00).` };
        }
        const rev = entry.activeRevisionId ? this.logbookRepo.getRevision(entry.activeRevisionId) : null;
        return {
          content:
            `**Logbook Status for ${today}:** \`${entry.status}\`\n` +
            `**Working Hours:** ${rev?.workStart || '07:10'} – ${rev?.workEnd || '16:25'}\n` +
            `**Summary:**\n${rev?.summary || 'No summary available.'}`,
        };
      }

      case 'logbook edit': {
        const today = args?.date || new Date().toISOString().slice(0, 10);
        const entry = this.logbookRepo.getOrCreateEntry(userId, today, userId);
        this.logbookRepo.updateStatus(entry.entryId, 'EDITING');
        return {
          content:
            `Logbook status for ${today} is now set to \`EDITING\`. Automatic submission is temporarily paused.\n` +
            `Submit your updated text to finalize the new revision.`,
        };
      }

      case 'logbook approve': {
        const today = args?.date || new Date().toISOString().slice(0, 10);
        const entry = this.logbookRepo.getEntryByUserAndDate(userId, today);
        if (!entry) return { content: `No logbook entry for ${today}.` };
        this.logbookRepo.updateStatus(entry.entryId, 'APPROVED');
        return { content: `Revision approved for ${today}. You can click Submit Now to send it to DERMAGA.` };
      }

      case 'logbook skip': {
        const today = args?.date || new Date().toISOString().slice(0, 10);
        const entry = this.logbookRepo.getOrCreateEntry(userId, today, userId);
        this.logbookRepo.updateStatus(entry.entryId, 'SKIPPED');
        return { content: `Logbook submission for ${today} has been skipped. No automatic submission will occur.` };
      }

      case 'settings view': {
        const s = this.settingsRepo.getSettings(userId);
        return {
          content:
            `**Your Logbook Settings:**\n` +
            `• Reminder Time: ${s.reminderTime}\n` +
            `• Working Hours: ${s.startTime} – ${s.endTime}\n` +
            `• Working Days: ${s.workingDays.join(', ')} (1=Mon ... 7=Sun)\n` +
            `• Auto-Submit: ${s.autoSubmitEnabled ? 'Enabled' : 'Disabled (Default)'}\n` +
            `• Timezone: ${s.timezone}`,
        };
      }

      case 'settings auto-submit': {
        const enabled = Boolean(args?.enabled);
        this.settingsRepo.saveSettings({ userId, autoSubmitEnabled: enabled });
        return {
          content: `Auto-submit preference updated: **${enabled ? 'ENABLED' : 'DISABLED'}**.`,
        };
      }

      default:
        return { content: `Unknown command: \`${command}\`. Use \`/help\` for assistance.` };
    }
  }

  /**
   * Handles conversational message mentioning or replying to Frieren.
   * Strictly English-only, calm, gently playful, factual.
   */
  public async handleMentionOrReply(
    userId: string,
    userMessage: string,
    history: { role: 'user' | 'model'; text: string }[] = []
  ): Promise<string> {
    const caller = async () => {
      // Mock caller for testing or default
      return "Oh? You called for me. I'm here, though I hope it's not something too troublesome.";
    };
    return this.persona.replyForChat(userMessage, history, caller);
  }
}
