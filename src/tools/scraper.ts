import axios from "axios";
import * as cheerio from "cheerio";

export class Scraper {
  static async scrape(url: string) {
    try {
      const { data } = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });
      const $ = cheerio.load(data);
      
      // Auto-extract meta and title
      const title = $("title").text();
      const description = $("meta[name='description']").attr("content");
      
      return {
        title,
        description,
        text: $("body").text().slice(0, 5000), // First 5k chars for AI context
        status: "success"
      };
    } catch (e: any) {
      return { status: "error", message: e.message };
    }
  }
}
