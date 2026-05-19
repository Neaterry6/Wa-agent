# BrokenVzn Agent v3.0 🦾

The ultimate, "dirty" coding and automation agent bot for Telegram. 

## Features
- **Project Scaffold Generator**: Generate entire directory structures with a single prompt.
- **Multi-Model Routing**: Switch between Qwen Coder, Gemini Pro, and Grog (Groq Llama 3.3 70B) via `/model`.
- **Force Join Membership**: Secure your community by requiring users to join your channel.
- **Interactive Terminal**: Run real shell commands directly from Telegram (Admin only).
- **GitHub Sync**: Clone, push, and manage repos from chat.
- **Session Intelligence**: Per-user memory of current projects and settings.

## Setup
1. Fill `.env` with your API keys.
2. Ensure you are an Admin in your force-join channel.
3. Add `REQUIRED_CHANNEL_ID` and `ADMIN_ID` to `.env`.
4. Run `npm start`.

## Admin Dirty Commands
- `/adminusers`: Full user registry and details.
- `/adminstats`: System-wide statistics.
- `/broadcast`: Send messages to all users.
- `/terminal`: Real-time shell access.

## Dependency Notes
- You may see this npm warning during install: `node-domexception@1.0.0 is deprecated`.
- This warning is **non-fatal** and comes from a transitive dependency chain (`node-fetch` -> `fetch-blob` -> `node-domexception`), not from a direct dependency in this project.
- No action is required to run the bot. The warning should disappear once upstream packages finish migrating fully to the platform-native `DOMException`.

## Warning
This bot is designed for advanced development and automation. User responsibly.

Created with 💀 by BrokenVzn.
