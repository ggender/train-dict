import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test',
  testMatch: '**/*.spec.js',
  fullyParallel: true,
  workers: 4,
  timeout: 30_000,
  reporter: [['list']],
  use: {
    headless: true,
    trace: 'retain-on-failure',
  },

  /*
   * Один и тот же набор проходится дважды: за столом и с телефона.
   * Телефон — не другой движок, а узкое окно с тач-вводом на том же Chromium:
   * так ловятся обрезанные экраны и кнопки, до которых не дотянуться,
   * но не расхождения WebKit. Про это — в test/README.md.
   */
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 5'] },
    },
  ],
});
