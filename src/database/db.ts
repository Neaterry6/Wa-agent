import Database from "better-sqlite3";
import path from "path";

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
  logChat: (userId: number, role: string, content: string) => {
    db.prepare("INSERT INTO chat_history (user_id, role, content) VALUES (?, ?, ?)").run(userId, role, content);
  },
  getHistory: (userId: number, limit = 20) => {
    return db.prepare("SELECT role, content FROM chat_history WHERE user_id = ? ORDER BY timestamp DESC LIMIT ?").all(userId, limit).reverse() as any[];
  },
  getAllUsers: () => db.prepare("SELECT * FROM users").all() as any[]
};
