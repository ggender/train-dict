import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { cp, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** Свободный порт: занимаем и тут же отпускаем. */
async function freePort() {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function waitUntilUp(url, child) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`приложение упало на старте (код ${child.exitCode})`);
    try {
      const res = await fetch(`${url}/api/state`);
      if (res.ok) return;
    } catch {
      /* ещё не поднялось */
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('приложение не поднялось за 15 секунд');
}

/**
 * Поднимает приложение во временной копии проекта.
 *
 * Копия нужна, чтобы тесты не трогали рабочее состояние человека: приложение
 * определяет каталог данных по своему расположению, поэтому во временном каталоге
 * оно пишет во временный же файл. Настоящий .env туда не попадает — значит, в тестах
 * приложение физически не может обратиться к живой модели.
 */
export async function startApp({ stubUrl, withKey = true, env: extraEnv } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'train-dict-test-'));

  await Promise.all([
    cp(join(ROOT, 'server.js'), join(dir, 'server.js')),
    cp(join(ROOT, 'package.json'), join(dir, 'package.json')),
    cp(join(ROOT, 'lib'), join(dir, 'lib'), { recursive: true }),
    cp(join(ROOT, 'public'), join(dir, 'public'), { recursive: true }),
  ]);
  await symlink(join(ROOT, 'node_modules'), join(dir, 'node_modules'), 'dir');

  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  let child = null;

  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    PORT: String(port),
    ...(stubUrl ? { ANTHROPIC_BASE_URL: stubUrl } : {}),
    ...(withKey ? { ANTHROPIC_API_KEY: 'sk-ant-stub-key' } : {}),
    ...extraEnv,
  };

  const logs = [];
  const launch = async () => {
    child = spawn(process.execPath, ['server.js'], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => logs.push(String(d)));
    child.stderr.on('data', (d) => logs.push(String(d)));
    await waitUntilUp(url, child);
  };

  const kill = async () => {
    if (!child || child.exitCode !== null) return;
    const ended = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGKILL');
    await ended;
  };

  await launch();

  return {
    url,
    dir,
    logs,

    /** Подложить состояние и перезапустить приложение — так делается «вчера» и «просрочено». */
    async seed(state) {
      await kill();
      await writeFile(join(dir, 'data', 'state.json'), JSON.stringify(state, null, 2), 'utf8').catch(
        async (err) => {
          if (err.code !== 'ENOENT') throw err;
          const { mkdir } = await import('node:fs/promises');
          await mkdir(join(dir, 'data'), { recursive: true });
          await writeFile(join(dir, 'data', 'state.json'), JSON.stringify(state, null, 2), 'utf8');
        },
      );
      await launch();
    },

    /** Прервать и снова запустить сервис — как будто его перезапустили. */
    async restart() {
      await kill();
      await launch();
    },

    async stop() {
      await kill();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
