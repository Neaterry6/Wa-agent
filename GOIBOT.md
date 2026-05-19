# GOIBOT

## Natural-language intent map (no slash prefix required)
- "send me song ..." / "play song ..." -> `/play <query>` (Spotify lookup flow)
- "send me video ..." -> `/video <query>`
- "generate song ..." / "make a song ..." -> `/suno <prompt>`
- "send me anime vid" / "anime video" -> `/anivid`

## Multi-repo merge behavior
- If user sends 2-3 GitHub repo URLs with words like *clone / merge / combine / one project*, bot runs the multi-repo merge flow.
- Flow clones each repo, copies files into a namespaced merged workspace, writes `MERGE_REPORT.md`, and returns a zip.

## Safety policy
- Do **not** provide malware creation, exploit payloads, credential theft, botnet logic, or stealth persistence.
- Do **not** perform or assist with “deep web/dark web” scraping, illegal scraping, bypassing auth, or data exfiltration.
- Allowed: legal/public-web scraping, defensive security guidance, and secure automation patterns.
