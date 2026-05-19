import axios from 'axios';

export default {
  name: 'ssweb', aliases: ['screenshot', 'webss'], category: 'utility', description: 'Takes a full-page screenshot of a website and sends the image.', usage: 'ssweb <url>', cooldown: 5, args: true, minArgs: 1, maxArgs: 1,
  async execute({ sock, message, args, from }) {
    let url = args[0];
    if (!url.startsWith('http://') && !url.startsWith('https://')) url = `https://${url}`;
    try {
      const apiUrl = `https://api.screenshotone.com/take?access_key=KN3bMn5VoWZIWw&url=${encodeURIComponent(url)}&format=jpg&full_page=true&block_ads=true&block_cookie_banners=true&block_trackers=true&image_quality=80&response_type=by_format`;
      const response = await axios.get(apiUrl, { responseType: 'arraybuffer', timeout: 60000 });
      await sock.sendMessage(from, { image: Buffer.from(response.data), mimetype: 'image/jpeg', caption: `🖼️ Full-page screenshot of:\n${url}` }, { quoted: message });
    } catch (err) {
      await sock.sendMessage(from, { text: `❌ Failed to capture screenshot.\n\n${err.response?.data?.message || err.message}` }, { quoted: message });
    }
  }
};
