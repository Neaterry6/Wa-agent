# BrokenVzn Agent v3.0 🦾

The ultimate, "dirty" coding and automation agent bot for Telegram. 

## Features
- **Project Scaffold Generator**: Generate entire directory structures with a single prompt.
- **Multi-Model Routing**: Switch between Qwen Coder, Gemini Pro, and Groq Llama 3 via `/model`.
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

## Warning
This bot is designed for advanced development and automation. User responsibly.

Created with 💀 by BrokenVzn.
