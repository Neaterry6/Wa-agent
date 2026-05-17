import { Octokit } from "octokit";

export class GitHubService {
  private octokit: Octokit;

  constructor(token: string) {
    this.octokit = new Octokit({ auth: token });
  }

  async createRepo(name: string, description: string = "Created by BrokenVzn Agent") {
    const response = await this.octokit.rest.repos.createForAuthenticatedUser({
      name,
      description,
      private: true,
    });
    return response.data;
  }

  async uploadFile(owner: string, repo: string, path: string, content: string, message: string = "Update from BrokenVzn Agent") {
    // Basic implementation for single file
    // For full zip push, we'd need to iterate or use Git data API
    try {
        const { data } = await this.octokit.rest.repos.getContent({ owner, repo, path });
        const sha = (data as any).sha;
        return await this.octokit.rest.repos.createOrUpdateFileContents({
          owner, repo, path, message, content: Buffer.from(content).toString("base64"), sha
        });
    } catch (e) {
        return await this.octokit.rest.repos.createOrUpdateFileContents({
          owner, repo, path, message, content: Buffer.from(content).toString("base64")
        });
    }
  }
}
