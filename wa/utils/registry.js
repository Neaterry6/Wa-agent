export const pluginRegistry = {
  chat: true,
  system: true,
  files: true,
  workspace: true
};

export function isOwnerJid(message, ownerNumber = '') {
  const sender = String(message?.key?.participant || message?.key?.remoteJid || '');
  const senderPhone = sender.split('@')[0].split(':')[0];
  const normalizedOwner = String(ownerNumber || '').replace(/\D/g, '');
  return Boolean(normalizedOwner && senderPhone === normalizedOwner);
}
