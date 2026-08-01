import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
/**
 * В облаке (Vercel, Netlify — там функции живут в AWS Lambda) папка деплоя
 * только для чтения, писать можно лишь в /tmp — а он пустеет при перезапуске
 * инстанса. То есть в облаке состояние эфемерно; долгая память потребует
 * внешнего хранилища.
 */
const IN_CLOUD = Boolean(process.env.VERCEL || process.env.LAMBDA_TASK_ROOT);
const DATA_DIR = IN_CLOUD ? join(tmpdir(), 'train-dict-data') : join(root, 'data');
const FILE = join(DATA_DIR, 'state.json');

export function emptyState() {
  return {
    version: 1,
    stage: 'goal', // goal -> proposal -> study
    goal: { messages: [], brief: null, missing: [] },
    proposal: null,
    words: [],
    cards: [],
  };
}

let state = null;
let writing = Promise.resolve();

export async function load() {
  try {
    state = JSON.parse(await readFile(FILE, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    state = emptyState();
  }
  return state;
}

export function get() {
  if (!state) throw new Error('store.load() не вызван');
  return state;
}

/** Пишем через временный файл, чтобы не оставить обрезанный state.json. */
export function save() {
  const snapshot = JSON.stringify(state, null, 2);
  writing = writing.then(async () => {
    await mkdir(DATA_DIR, { recursive: true });
    const tmp = `${FILE}.tmp`;
    await writeFile(tmp, snapshot, 'utf8');
    await rename(tmp, FILE);
  });
  return writing;
}

export async function reset() {
  state = emptyState();
  await save();
  return state;
}
