import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test',
  testMatch: '**/*.spec.js',
  fullyParallel: true,
  workers: 4,
  timeout: 30_000,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    headless: true,
    trace: 'retain-on-failure',
  },
});
