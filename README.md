# Axon Telegram Terminal Bot

Simple Telegram bot (no agent orchestration):
- Replies to normal text from everyone (no prefix needed)
- Blunt/rude style responses (still useful)
- Gemini chat (`/ai` and normal text)
- Groq chat (`/grok`)
- Admin shell (`/shell`) for git/terminal commands
- Zip support: upload, list, unzip, re-zip, and send back to Telegram chat
- Can generate and send scripts from plain text requests

## Env
```env
TELEGRAM_BOT_ID=8472557033
TELEGRAM_BOT_TOKEN=
TELEGRAM_ADMIN_IDS=8586943787
GEMINI_API_KEY=
GROQ_API_KEY=
```

## Run
```bash
npm install
npm run start:telegram
```

## Commands
- `/shell <command>` run shell as admin
- `/ai <prompt>` Gemini
- `/grok <prompt>` Groq
- `/zipls` reply to a zip and list its contents
- `/unzip` reply to a zip and extract it
- `/sendzip <path-in-workspace>` zip and send to chat

## No-prefix behavior
- Any normal message gets a reply.
- For admins, messages that look like terminal/git requests are auto-converted to commands and executed.
- For admins, messages like “write script for ...” generate a script file and send it back.
