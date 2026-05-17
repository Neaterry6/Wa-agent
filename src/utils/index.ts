import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import archiver from "archiver";
import AdmZip from "adm-zip";

const execAsync = promisify(exec);

export class ShellUtils {
  static async run(cmd: string, cwd?: string) {
    try {
      const { stdout, stderr } = await execAsync(cmd, { cwd, timeout: 60000 });
      return stdout || stderr || "Execution successful (no output).";
    } catch (e: any) {
      return `Error: ${e.message}`;
    }
  }
}

export class FileUtils {
  static async zipFolder(sourceDir: string, outPath: string) {
    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(outPath);
      const archive = archiver("zip", { zlib: { level: 9 } });

      output.on("close", resolve);
      archive.on("error", reject);

      archive.pipe(output);
      archive.directory(sourceDir, false);
      archive.finalize();
    });
  }

  static unzip(zipPath: string, targetPath: string) {
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(targetPath, true);
  }

  static writeFile(filePath: string, content: string) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content);
  }

  static readFile(filePath: string) {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, "utf-8");
  }
}
