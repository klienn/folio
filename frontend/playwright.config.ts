import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:8001",
    viewport: { width: 1440, height: 1000 },
  },
  webServer: {
    command: "uv run python scripts/e2e_server.py",
    cwd: "..",
    wait: { stderr: /Uvicorn running on/ },
    reuseExistingServer: false,
    timeout: 30000,
  },
});
