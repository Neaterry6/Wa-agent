import { ShellUtils, FileUtils } from "../utils/index.ts";
import path from "path";
import fs from "fs";

export class Sandbox {
  static async runCode(lang: string, code: string) {
    const tempDir = path.join(process.cwd(), "sandbox_temp");
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
    
    let filename = `execution_${Date.now()}`;
    let cmd = "";

    switch (lang.toLowerCase()) {
      case "python":
      case "py":
        filename += ".py";
        cmd = `python3 ${filename}`;
        break;
      case "javascript":
      case "js":
      case "node":
        filename += ".js";
        cmd = `node ${filename}`;
        break;
      default:
        return "Language not supported in sandbox yet.";
    }

    const filePath = path.join(tempDir, filename);
    FileUtils.writeFile(filePath, code);

    const output = await ShellUtils.run(cmd, tempDir);
    
    // Cleanup
    fs.unlinkSync(filePath);
    
    return output;
  }
}
