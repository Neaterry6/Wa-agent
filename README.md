# Axon Telegram AI Worker Bot

AI-first Telegram bot where admin can ask naturally and the bot executes terminal/git/media/screenshot/image tasks itself.

## Core abilities
- Natural-language CLI execution in workspace (git, npm, shell, scripts)
- Queue system with `/status`
- GitHub push automation (`/push <repo> <token>`)
- Screenshot capture from URL using ScreenshotOne API
- Image generation from prompt using fast image API
- Web browsing/search summaries
- Song/video download support via `yt-dlp` and sends media back to Telegram
- File sendback (`/sendfile`)
- General AI coding help across major languages

## Env
```env
TELEGRAM_BOT_TOKEN=
TELEGRAM_ADMIN_IDS=12345
GEMINI_API_KEY=
GROQ_API_KEY=
SCREENSHOTONE_ACCESS_KEY=KN3bMn5VoWZIWw
```

## Run
```bash
npm install
npm run start:telegram
```

## Natural admin prompts (no slash command needed)
- `screenshot https://example.com`
- `generate image neon cyberpunk city`
- `search latest firebase auth docs`
- `play song https://youtube.com/watch?v=...`
- `download video https://youtube.com/watch?v=...`
- `git status` / `npm install` / `run this command ...`
