import axios from 'axios';

const allowedTypes = ['Visa', 'MasterCard', 'American Express', 'JCB'];
const userLimits = {};
const canonicalType = (input) => {
  if (!input) return null;
  const norm = input.replace(/[\s\-_.]/g, '').toLowerCase();
  for (const type of allowedTypes) {
    if (type.replace(/[\s\-_.]/g, '').toLowerCase() === norm) return type;
    if (norm === 'amex' && type === 'American Express') return type;
  }
  return null;
};
const getLimitByRank = (rank) => ((rank || '').toUpperCase() === 'PREMIUM' ? 20 : ['OWNER', 'ADMIN'].includes((rank || '').toUpperCase()) ? 3 : 90);
const box = (text) => `*╔════⟪ 𝐜𝐜𝐠𝐞𝐧 ⟫════╗*\n${text}\n╚════════════════════╝`;

export default { name: 'ccgen', aliases: ['cardgen'], category: 'utility', description: 'Fake card generator .ccgen <type> <amount>', usage: 'ccgen <type> <amount>', cooldown: 2,
  async execute({ sock, message, from, args, sender, isOwner, isSudo }) {
    const [rawType, amt] = args; const amount = Math.max(5, Math.min(parseInt(amt, 10) || 5, 20)); const type = canonicalType(rawType);
    if (!rawType) return sock.sendMessage(from, { text: box([`┃  *Usage*: .ccgen <type> <amount>`, `┃  *Types*: ${allowedTypes.join(', ')}`].join('\n')) }, { quoted: message });
    if (!type) return sock.sendMessage(from, { text: box([`┃  *Error*: invalid card type "${rawType}"`, `┃  *Types*: ${allowedTypes.join(', ')}`].join('\n')) }, { quoted: message });
    const chatId = sender || from || 'anon';
    let userRank = 'FREE'; if (isOwner) userRank = 'OWNER'; else if (isSudo) userRank = 'ADMIN';
    const now = Date.now(); const waitSec = getLimitByRank(userRank); const until = userLimits[chatId] || 0;
    if (now < until) return sock.sendMessage(from, { text: box([`┃  *Rate limited*: wait ${Math.ceil((until - now) / 1000)}s`, `┃  *Rank*: ${userRank}`].join('\n')) }, { quoted: message });
    try {
      const apiUrl = `https://apis.davidcyril.name.ng/tools/ccgen?type=${encodeURIComponent(type)}&amount=${amount}`;
      const { data } = await axios.get(apiUrl, { timeout: 10000 });
      if (!data?.status || !Array.isArray(data.cards) || !data.cards.length) throw new Error('Could not generate cards');
      userLimits[chatId] = Date.now() + waitSec * 1000;
      const cardsText = data.cards.map((card) => [`┃  *Name*: ${card.name}`, `┃  *Number*: \`${card.number}\``, `┃  *Expiry*: \`${card.expiry}\``, `┃  *CVV*: \`${card.cvv}\``, '┃'].join('\n')).join('\n');
      return sock.sendMessage(from, { text: box([`┃  *Card type*: ${data.card_type || type}`, `┃  *Total*: ${data.total || data.cards.length}`, cardsText].join('\n')) }, { quoted: message });
    } catch (e) {
      return sock.sendMessage(from, { text: box([`┃  *Error*: ${e.response?.data?.message || e.message || 'unknown'}`].join('\n')) }, { quoted: message });
    }
  }
};
