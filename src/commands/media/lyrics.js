import axios from 'axios';

export default {
  name: 'lyrics', aliases: ['lyric', 'ly'], category: 'media', description: 'Fetch song lyrics with thumbnail', usage: 'lyrics <song name>', cooldown: 5, args: true, minArgs: 1,
  async execute({ sock, message, args, from }) {
    const query = args.join(' ');
    await sock.sendMessage(from, { react: { text: '🔍', key: message.key } });
    try {
      const res = await axios.get(`https://api.popcat.xyz/v2/lyrics?song=${encodeURIComponent(query)}`, { timeout: 30000 });
      if (res.data.error || !res.data.message) {
        await sock.sendMessage(from, { react: { text: '❌', key: message.key } });
        return sock.sendMessage(from, { text: `❌ No lyrics found for: ${query}` }, { quoted: message });
      }
      const { title, artist, image, lyrics, url } = res.data.message;
      const finalLyrics = lyrics.length > 3900 ? `${lyrics.substring(0, 3900)}\n\n...[Lyrics Truncated]` : lyrics;
      const msg = `🎶 *${String(title).toUpperCase()}*\n👤 Artist: ${artist}\n────────────────────\n\n${finalLyrics}`;
      await sock.sendMessage(from, { text: msg, contextInfo: { externalAdReply: { title, body: artist, thumbnailUrl: image, sourceUrl: url, mediaType: 1, renderLargerThumbnail: true, showAdAttribution: false } } }, { quoted: message });
      await sock.sendMessage(from, { react: { text: '✅', key: message.key } });
    } catch (error) {
      await sock.sendMessage(from, { react: { text: '❌', key: message.key } });
      await sock.sendMessage(from, { text: `❌ Failed: ${error.message}` }, { quoted: message });
    }
    return null;
  }
};
