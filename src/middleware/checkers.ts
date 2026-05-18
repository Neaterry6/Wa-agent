import { Context } from "telegraf";
import { config } from "../config/index.ts";
import { DB } from "../database/db.ts";
import logger from "../utils/logger.ts";

export async function channelCheckMiddleware(ctx: Context, next: () => Promise<void>) {
  if (ctx.from?.id === undefined) return;

  // Internal bots and services skip
  if (ctx.chat?.type === "channel") return next();

  const userId = ctx.from.id;
  
  // Log incoming message
  logger.info(`Message from ${userId} (@${ctx.from.username || 'N/A'}): ${ctx.message && 'text' in ctx.message ? ctx.message.text : '[Media/Other]'}`);

  // Skip check for admins
  if (config.adminIds.includes(userId)) {
    logger.info(`User ${userId} is admin, skipping channel check.`);
    DB.saveUser(ctx.from);
    return next();
  }

  // Initialize/Update User in DB
  DB.saveUser(ctx.from);

  // Check Ban
  const user = DB.getUser(userId);
  if (user?.is_banned) {
    logger.warn(`Banned user ${userId} tried to access bot.`);
    return ctx.reply("🚫 Custom access restricted. Contact support.");
  }

  // Force Channel Check (Only if configured)
  const channelId = process.env.REQUIRED_CHANNEL_ID;
  if (channelId) {
    try {
      const member = await ctx.telegram.getChatMember(channelId, userId);
      const allowed = ["member", "administrator", "creator"];
      if (!allowed.includes(member.status)) {
         logger.info(`User ${userId} not in channel ${channelId}. Blocking access.`);
         return ctx.reply(
           `🚨 *Access Denied*\n\nYou must join our official channel to use this bot.\n\nJoin here: ${process.env.CHANNEL_LINK || '[@BrokenVzn]'}`,
           { parse_mode: 'Markdown' }
         );
      }
      logger.info(`User ${userId} membership verified in ${channelId}.`);
    } catch (e: any) {
      logger.error(`Channel check error for ${userId}: ${e.message}`);
      // If bot is not admin in channel, might fail. Gracefully handle or skip if desired.
      // For strict enforcement, we might want to block if check fails.
    }
  }

  return next();
}

export function isAdmin(ctx: Context) {
  return config.adminIds.includes(ctx.from?.id || 0);
}
