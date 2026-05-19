import Database from "better-sqlite3";
import path from "path";
import axios from "axios";
import { config } from "../config/index.ts";

const db = new Database(path.join(process.cwd(), "agent.db"));

// Initialize Schema
 db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT,
    first_name TEXT,
    github_token TEXT,
    github_repo TEXT,
    preferred_model TEXT DEFAULT 'gemini',
    is_banned INTEGER DEFAULT 0,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_active DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS chat_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    role TEXT,
    content TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    name TEXT,
    path TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

const FIREBASE_MAX_CHATS = 50;
const hasFirebaseConfig = Boolean(config.firebaseProjectId && config.firebaseApiKey && config.firebaseDatabaseId);

function getFirestoreBaseUrl() {
  const dbId = config.firebaseDatabaseId || "(default)";
  return `https://firestore.googleapis.com/v1/projects/${config.firebaseProjectId}/databases/${dbId}/documents`;
}

async function saveChatToFirebase(userId: number, role: string, content: string) {
  if (!hasFirebaseConfig) return;

  const base = getFirestoreBaseUrl();
  const now = new Date().toISOString();
  const collectionPath = `${base}/users/${userId}/chats`;

  await axios.post(`${collectionPath}?key=${config.firebaseApiKey}`, {
    fields: {
      user_id: { integerValue: String(userId) },
      role: { stringValue: role },
      content: { stringValue: content },
      created_at: { timestampValue: now }
    }
  });

  const listRes = await axios.get(`${collectionPath}?orderBy=created_at&key=${config.firebaseApiKey}`);
  const docs = listRes.data?.documents || [];

  if (docs.length > FIREBASE_MAX_CHATS) {
    const toDelete = docs.slice(0, docs.length - FIREBASE_MAX_CHATS);
    await Promise.all(toDelete.map((doc: any) => axios.delete(`${doc.name}?key=${config.firebaseApiKey}`)));
  }
}

async function getChatsFromFirebase(userId: number, limit = 20): Promise<{ role: string; content: string }[]> {
  if (!hasFirebaseConfig) return [];
  const base = getFirestoreBaseUrl();
  const collectionPath = `${base}/users/${userId}/chats`;
  const listRes = await axios.get(`${collectionPath}?orderBy=created_at%20desc&pageSize=${Math.min(limit, FIREBASE_MAX_CHATS)}&key=${config.firebaseApiKey}`);
  const docs = listRes.data?.documents || [];

  return docs
    .map((doc: any) => ({
      role: doc.fields?.role?.stringValue || "user",
      content: doc.fields?.content?.stringValue || ""
    }))
    .reverse();
}

export const DB = {
  getUser: (id: number) => db.prepare("SELECT * FROM users WHERE id = ?").get(id) as any,
  saveUser: (user: any) => {
    db.prepare(`
      INSERT OR REPLACE INTO users (id, username, first_name, last_active) 
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `).run(user.id, user.username, user.first_name);
  },
  updateGithub: (id: number, token: string, repo: string) => {
    db.prepare("UPDATE users SET github_token = ?, github_repo = ? WHERE id = ?").run(token, repo, id);
  },
  updateModel: (id: number, model: string) => {
    db.prepare("UPDATE users SET preferred_model = ? WHERE id = ?").run(model, id);
  },
  banUser: (id: number, ban: boolean) => {
    db.prepare("UPDATE users SET is_banned = ? WHERE id = ?").run(ban ? 1 : 0, id);
  },
  logChat: async (userId: number, role: string, content: string) => {
    db.prepare("INSERT INTO chat_history (user_id, role, content) VALUES (?, ?, ?)").run(userId, role, content);
    try {
      await saveChatToFirebase(userId, role, content);
    } catch {
      // Keep local memory as fallback when firebase write fails.
    }
  },
  getHistory: async (userId: number, limit = 20) => {
    try {
      const firebaseHistory = await getChatsFromFirebase(userId, limit);
      if (firebaseHistory.length) return firebaseHistory;
    } catch {
      // Fall back to local sqlite history when firebase read fails.
    }

    return db.prepare("SELECT role, content FROM chat_history WHERE user_id = ? ORDER BY id DESC LIMIT ?").all(userId, Math.min(limit, FIREBASE_MAX_CHATS)).reverse() as any[];
  },
  getAllUsers: () => db.prepare("SELECT * FROM users").all() as any[]
};
