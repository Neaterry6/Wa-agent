import fs from "fs";
import path from "path";

export interface UserProfile {
  id: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  lastActive: string;
  isBanned: boolean;
}

export interface ChatMessage {
  userId: number;
  role: "user" | "model";
  content: string;
  timestamp: string;
}

export class UserLog {
  private static profilesPath = path.join(process.cwd(), "users.json");
  private static logsPath = path.join(process.cwd(), "chat_logs.json");

  static init() {
    if (!fs.existsSync(this.profilesPath)) fs.writeFileSync(this.profilesPath, JSON.stringify({}));
    if (!fs.existsSync(this.logsPath)) fs.writeFileSync(this.logsPath, JSON.stringify([]));
  }

  static getProfiles(): Record<number, UserProfile> {
    const data = fs.readFileSync(this.profilesPath, "utf-8");
    return JSON.parse(data);
  }

  static updateProfile(user: { id: number; username?: string; first_name?: string; last_name?: string }) {
    const profiles = this.getProfiles();
    profiles[user.id] = {
      ...profiles[user.id],
      id: user.id,
      username: user.username,
      firstName: user.first_name,
      lastName: user.last_name,
      lastActive: new Date().toISOString(),
      isBanned: profiles[user.id]?.isBanned || false,
    };
    fs.writeFileSync(this.profilesPath, JSON.stringify(profiles, null, 2));
  }

  static banUser(userId: number, ban: boolean = true) {
    const profiles = this.getProfiles();
    if (profiles[userId]) {
      profiles[userId].isBanned = ban;
      fs.writeFileSync(this.profilesPath, JSON.stringify(profiles, null, 2));
      return true;
    }
    return false;
  }

  static logChat(userId: number, role: "user" | "model", content: string) {
    const logs: ChatMessage[] = JSON.parse(fs.readFileSync(this.logsPath, "utf-8"));
    logs.push({
      userId,
      role,
      content,
      timestamp: new Date().toISOString(),
    });
    // Keep logs manageable (last 5000)
    if (logs.length > 5000) logs.shift();
    fs.writeFileSync(this.logsPath, JSON.stringify(logs, null, 2));
  }

  static getUserLogs(userId: number): ChatMessage[] {
    const logs: ChatMessage[] = JSON.parse(fs.readFileSync(this.logsPath, "utf-8"));
    return logs.filter(l => l.userId === userId);
  }
}
