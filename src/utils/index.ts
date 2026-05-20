import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import archiver from "archiver";
import { stat } from "fs/promises";
import AdmZip from "adm-zip";

const execAsync = promisify(exec);

export class ShellUtils {
  static async run(cmd: string, cwd?: string) {
    try {
      const { stdout, stderr } = await execAsync(cmd, { cwd, timeout: 60000, maxBuffer: 10 * 1024 * 1024 });
      const out = (stdout || "").trim();
      const err = (stderr || "").trim();

      if (out && err) return `${out}\n\n[stderr]\n${err}`;
      if (out) return out;
      if (err) return `[stderr]\n${err}`;
      return "Execution successful (no output).";
    } catch (e: any) {
      const out = (e?.stdout || "").toString().trim();
      const err = (e?.stderr || "").toString().trim();
      const details = [out, err].filter(Boolean).join("\n\n[stderr]\n");
      const message = e?.killed ? "Command timed out." : (e?.message || "Command failed.");
      return `Error: ${message}${details ? `\n\n${details}` : ""}`;
    }
  }
}

export class FileUtils {
  static async zipFolder(sourceDir: string, outPath: string) {
    if (!fs.existsSync(sourceDir)) {
      throw new Error(`Source directory does not exist: ${sourceDir}`);
    }

    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(outPath);
      const archive = archiver("zip", { zlib: { level: 9 } });
      let settled = false;

      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        reject(err);
      };

      output.on("error", fail);
      archive.on("error", fail);
      archive.on("warning", (err: any) => {
        if (err?.code === "ENOENT") return;
        fail(err);
      });

      output.on("close", async () => {
        if (settled) return;
        try {
          const fileStat = await stat(outPath);
          if (fileStat.size <= 0) return fail(new Error(`Zip archive is empty: ${outPath}`));
          settled = true;
          resolve(true);
        } catch (e: any) {
          fail(e);
        }
      });

      archive.pipe(output);
      archive.directory(sourceDir, false);
      void archive.finalize();
    });
  }

  static unzip(zipPath: string, targetPath: string) {
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(targetPath, true);
  }

  static listZipContent(zipPath: string): string[] {
    const zip = new AdmZip(zipPath);
    return zip.getEntries().map(e => e.entryName);
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

  static listFiles(dirPath: string): string[] {
    if (!fs.existsSync(dirPath)) return [];
    return fs.readdirSync(dirPath);
  }



  static listFilesRecursive(dirPath: string, baseDir: string = dirPath): string[] {
    if (!fs.existsSync(dirPath)) return [];

    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    const results: string[] = [];

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        results.push(`${relativePath}/`);
        results.push(...this.listFilesRecursive(fullPath, baseDir));
      } else {
        results.push(relativePath);
      }
    }

    return results;
  }

  static formatPathListForMarkdown(items: string[], header: string, maxChars = 3500): string[] {
    if (!items.length) return [`${header}\n\n\`\`\`\n(empty)\n\`\`\``];

    const chunks: string[] = [];
    let current = `${header}\n\n\`\`\`\n`;

    for (const item of items) {
      const line = `${item}\n`;
      if ((current + line + "\`\`\`").length > maxChars) {
        chunks.push(`${current}\`\`\``);
        current = `${header} (cont.)\n\n\`\`\`\n${line}`;
      } else {
        current += line;
      }
    }

    chunks.push(`${current}\`\`\``);
    return chunks;
  }

  static searchContent(dirPath: string, query: string): { path: string; line: number; content: string }[] {
    const results: { path: string; line: number; content: string }[] = [];
    const files = this.getAllFiles(dirPath);
    
    for (const file of files) {
      const content = this.readFile(file);
      if (content && content.includes(query)) {
        const lines = content.split("\n");
        lines.forEach((lineText, index) => {
          if (lineText.includes(query)) {
            results.push({ path: file, line: index + 1, content: lineText.trim() });
          }
        });
      }
    }
    return results;
  }

  private static getAllFiles(dirPath: string, fileList: string[] = []): string[] {
    const files = fs.readdirSync(dirPath);
    files.forEach((file) => {
      const name = path.join(dirPath, file);
      if (fs.statSync(name).isDirectory()) {
        if (!name.includes("node_modules") && !name.includes(".git")) {
          this.getAllFiles(name, fileList);
        }
      } else {
        fileList.push(name);
      }
    });
    return fileList;
  }

  static parseProjectCode(raw: string) {
    const files: { name: string; content: string }[] = [];
    const regex = /===\s*([^\n=]+?)\s*===\s*([\s\S]*?)(?=\n===\s*[^\n=]+?\s*===|$)/g;
    let match;
    while ((match = regex.exec(raw)) !== null) {
      files.push({
        name: match[1].trim(),
        content: match[2].trim()
      });
    }
    return files;
  }
}
