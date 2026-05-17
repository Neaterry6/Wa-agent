import fs from "fs";
import path from "path";

export interface Task {
  id: number;
  description: string;
  completed: boolean;
  createdAt: string;
}

export class TaskManager {
  private filePath: string;

  constructor() {
    this.filePath = path.join(process.cwd(), "tasks.json");
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, JSON.stringify([]));
    }
  }

  getTasks(): Task[] {
    const data = fs.readFileSync(this.filePath, "utf-8");
    return JSON.parse(data);
  }

  addTask(description: string): Task {
    const tasks = this.getTasks();
    const newTask: Task = {
      id: Date.now(),
      description,
      completed: false,
      createdAt: new Date().toISOString(),
    };
    tasks.push(newTask);
    fs.writeFileSync(this.filePath, JSON.stringify(tasks, null, 2));
    return newTask;
  }

  completeTask(id: number): boolean {
    const tasks = this.getTasks();
    const task = tasks.find((t) => t.id === id);
    if (task) {
      task.completed = true;
      fs.writeFileSync(this.filePath, JSON.stringify(tasks, null, 2));
      return true;
    }
    return false;
  }

  deleteTask(id: number): boolean {
    const tasks = this.getTasks();
    const filtered = tasks.filter((t) => t.id !== id);
    if (filtered.length < tasks.length) {
      fs.writeFileSync(this.filePath, JSON.stringify(filtered, null, 2));
      return true;
    }
    return false;
  }
}
