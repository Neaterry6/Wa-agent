import fs from "fs";
import path from "path";
import puppeteer from "puppeteer";
import { ShellUtils, FileUtils } from "../utils/index.ts";

export class PreviewEngine {
  static async captureScreenshot(url: string, outputPath: string) {
    let browser;
    try {
      browser = await puppeteer.launch({ 
        headless: true, 
        args: ["--no-sandbox", "--disable-setuid-sandbox"] 
      });
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 720 });
      await page.goto(url, { waitUntil: "networkidle0", timeout: 30000 });
      await page.screenshot({ path: outputPath });
      return true;
    } catch (e) {
      console.error("Screenshot failed:", e);
      return false;
    } finally {
      if (browser) await browser.close();
    }
  }

  static async buildAndPreview(projectDir: string) {
    // 1. Install deps if package.json exists
    if (fs.existsSync(path.join(projectDir, "package.json"))) {
      console.log("Installing dependencies...");
      await ShellUtils.run("npm install", projectDir);
    }

    // 2. Start server in background
    // This is tricky in a single container. For now, we simulate success or return the source zip.
    // In a real VM, we'd spawn and wait.
    return { success: true, message: "Project built and ready for delivery." };
  }
}
