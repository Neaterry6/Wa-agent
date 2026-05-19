import axios from 'axios';

const SUNO_WRAPPER_BASE = process.env.SUNO_WRAPPER_BASE || 'https://api.sunoapi.org';
const SUNO_ACCESS_TOKEN = process.env.SUNO_ACCESS_TOKEN || '';
const DEFAULT_MODEL = process.env.SUNO_MODEL || 'V4_5';
const POLL_INTERVAL_MS = 7000;
const MAX_POLLS = 35; // ~4 minutes

function parsePrompt(text = '') {
  const input = String(text || '').trim();
  const byMatch = input.match(/\bby\s+(.+)$/i);
  const artist = byMatch ? byMatch[1].trim() : '';
  const core = byMatch ? input.slice(0, byMatch.index).trim() : input;

  const styleKeywords = [
    'afrobeat', 'drill', 'hip hop', 'rap', 'trap', 'pop', 'rock', 'rnb', 'r&b', 'jazz',
    'blues', 'reggae', 'dancehall', 'country', 'edm', 'house', 'techno', 'amapiano',
    'gospel', 'soul', 'funk', 'lofi', 'lo-fi', 'classical', 'metal', 'punk', 'indie',
    'folk', 'kpop', 'afropop', 'highlife', 'soca', 'dubstep', 'grime'
  ];

  let style = '';
  let prompt = core;
  const lc = core.toLowerCase();
  for (const keyword of styleKeywords) {
    const idx = lc.indexOf(keyword);
    if (idx !== -1) {
      style = keyword;
      prompt = `${core.slice(0, idx)} ${core.slice(idx + keyword.length)}`.replace(/\s+/g, ' ').trim();
      break;
    }
  }

  if (!prompt) prompt = 'a creative song';
  return {
    prompt,
    style,
    title: prompt.slice(0, 60),
    artist
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickAudioUrl(payload) {
  const data = payload?.data || payload?.result || payload;
  if (!data) return '';

  if (Array.isArray(data?.songs)) {
    const first = data.songs[0] || {};
    return first.audioUrl || first.audio_url || first.url || first.streamUrl || '';
  }

  if (Array.isArray(data?.clips)) {
    const first = data.clips[0] || {};
    return first.audio_url || first.audioUrl || first.url || '';
  }

  return data.audioUrl || data.audio_url || data.streamUrl || data.url || '';
}

function buildAuthHeaders() {
  return {
    Authorization: `Bearer ${SUNO_ACCESS_TOKEN}`,
    'X-API-KEY': SUNO_ACCESS_TOKEN,
    'X-Access-Token': SUNO_ACCESS_TOKEN,
    'User-Agent': 'Asta-Bot/1.0'
  };
}

async function startGeneration({ prompt, style, title }) {
  const { data } = await axios.post(
    `${SUNO_WRAPPER_BASE}/api/v1/generate`,
    {
      customMode: true,
      instrumental: false,
      model: DEFAULT_MODEL,
      prompt,
      style: style || undefined,
      title: title || undefined
    },
    {
      timeout: 45000,
      headers: {
        'Content-Type': 'application/json',
        ...buildAuthHeaders()
      }
    }
  );

  const taskId = data?.data?.taskId || data?.taskId || data?.result?.taskId;
  if (!taskId) throw new Error('Suno wrapper did not return a task ID');
  return taskId;
}

async function waitForSong(taskId) {
  let lastStatus = 'pending';

  for (let i = 0; i < MAX_POLLS; i += 1) {
    await sleep(POLL_INTERVAL_MS);

    const { data } = await axios.get(`${SUNO_WRAPPER_BASE}/api/v1/generate/record-info`, {
      params: { taskId },
      timeout: 45000,
      headers: buildAuthHeaders()
    });

    const raw = data?.data || data?.result || data;
    const status = String(raw?.status || raw?.state || '').toLowerCase();
    if (status) lastStatus = status;

    const audioUrl = pickAudioUrl(data);
    if (audioUrl) return { audioUrl, meta: raw };

    if (['failed', 'error', 'cancelled'].includes(status)) {
      const reason = raw?.errorMessage || raw?.message || 'generation failed';
      throw new Error(reason);
    }
  }

  throw new Error(`Generation timeout (last status: ${lastStatus})`);
}

export default {
  name: 'suno',
  aliases: ['songgen', 'musicgen', 'musica'],
  category: 'ai',
  description: 'Generate AI music via Suno third-party wrapper API',
  usage: 'suno <description> <genre> by <artist>',
  example: 'suno I love you afrobeat by Kenzy',
  cooldown: 60,
  args: true,
  minArgs: 1,

  async execute({ sock, message, from, args }) {
    if (!SUNO_ACCESS_TOKEN) {
      return sock.sendMessage(from, {
        text: '❌ SUNO_ACCESS_TOKEN is missing in env.'
      }, { quoted: message });
    }

    const text = args.join(' ').trim();
    if (!text) {
      return sock.sendMessage(from, {
        text: '🎵 *Suno Music Generator*\n\nUsage:\n`.suno <description> <genre> by <artist>`\n\nExample:\n`.suno calm piano classical by Mozart`'
      }, { quoted: message });
    }

    const parsed = parsePrompt(text);
    await sock.sendMessage(from, { react: { text: '🎵', key: message.key } });

    const progress = await sock.sendMessage(from, {
      text: [
        '🎶 *Suno Generation Started*',
        `📝 Prompt: ${parsed.prompt}`,
        `🎼 Style: ${parsed.style || 'auto'}`,
        `👤 Artist: ${parsed.artist || 'auto'}`,
        '',
        '⏳ Please wait 1-4 minutes...'
      ].join('\n')
    }, { quoted: message });

    try {
      const taskId = await startGeneration(parsed);
      const { audioUrl } = await waitForSong(taskId);

      await sock.sendMessage(from, {
        audio: { url: audioUrl },
        mimetype: 'audio/mpeg',
        ptt: false,
        fileName: `${(parsed.title || 'suno_track').replace(/[^a-z0-9_-]/gi, '_')}.mp3`,
        caption: `🎵 *${parsed.title}*\n🆔 Task: ${taskId}`
      }, { quoted: message });

      try { await sock.sendMessage(from, { delete: progress.key }); } catch {}
      await sock.sendMessage(from, { react: { text: '✅', key: message.key } });
    } catch (error) {
      try { await sock.sendMessage(from, { delete: progress.key }); } catch {}
      await sock.sendMessage(from, { react: { text: '❌', key: message.key } });
      await sock.sendMessage(from, {
        text: `❌ Suno generation failed: ${error.message}`
      }, { quoted: message });
    }

    return null;
  }
};
