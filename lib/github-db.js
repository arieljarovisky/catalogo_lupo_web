/**
 * Persistencia remota de db.json vía GitHub Contents API.
 * Usa la rama `data` para no triggerear redeploys de Vercel en main.
 */
const REPO = process.env.GITHUB_REPO || 'arieljarovisky/catalogo_lupo_web';
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const DB_FILE = process.env.GITHUB_DB_PATH || 'db.json';
const BRANCH = process.env.GITHUB_BRANCH || 'data';

const USE_GITHUB_DB = Boolean(TOKEN && REPO);

let cachedSha = null;

function apiUrl(pathname) {
  return `https://api.github.com/repos/${REPO}${pathname}`;
}

async function githubFetch(pathname, options = {}) {
  const res = await fetch(apiUrl(pathname), {
    ...options,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'catalogo-lupo-web',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  return res;
}

async function ensureDataBranch() {
  const refRes = await githubFetch(`/git/ref/heads/${BRANCH}`);
  if (refRes.ok) return;
  if (refRes.status !== 404) {
    throw new Error(`GitHub ref ${BRANCH}: ${refRes.status} ${await refRes.text()}`);
  }
  const mainRes = await githubFetch('/git/ref/heads/main');
  if (!mainRes.ok) {
    throw new Error(`GitHub ref main: ${mainRes.status} ${await mainRes.text()}`);
  }
  const main = await mainRes.json();
  const create = await githubFetch('/git/refs', {
    method: 'POST',
    body: JSON.stringify({
      ref: `refs/heads/${BRANCH}`,
      sha: main.object.sha
    })
  });
  if (!create.ok && create.status !== 422) {
    throw new Error(`GitHub create branch ${BRANCH}: ${create.status} ${await create.text()}`);
  }
}

async function fetchRemoteDb() {
  if (!USE_GITHUB_DB) return null;
  await ensureDataBranch();
  const res = await githubFetch(`/contents/${encodeURIComponent(DB_FILE)}?ref=${BRANCH}`);
  if (res.status === 404) {
    cachedSha = null;
    return null;
  }
  if (!res.ok) {
    throw new Error(`GitHub read ${DB_FILE}: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  cachedSha = json.sha || null;
  const raw = String(json.content || '').replace(/\n/g, '');
  return JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
}

async function saveRemoteDb(data) {
  if (!USE_GITHUB_DB) {
    throw new Error('Falta GITHUB_TOKEN para persistir en producción.');
  }
  await ensureDataBranch();
  const content = Buffer.from(`${JSON.stringify(data, null, 2)}\n`, 'utf8').toString('base64');
  for (let attempt = 0; attempt < 4; attempt++) {
    if (!cachedSha) {
      try {
        await fetchRemoteDb();
      } catch {
        cachedSha = null;
      }
    }
    const body = {
      message: `chore: sync db.json ${new Date().toISOString()}`,
      content,
      branch: BRANCH
    };
    if (cachedSha) body.sha = cachedSha;
    const res = await githubFetch(`/contents/${encodeURIComponent(DB_FILE)}`, {
      method: 'PUT',
      body: JSON.stringify(body)
    });
    if (res.status === 409 || res.status === 422) {
      cachedSha = null;
      continue;
    }
    if (!res.ok) {
      throw new Error(`GitHub save ${DB_FILE}: ${res.status} ${await res.text()}`);
    }
    const json = await res.json();
    cachedSha = json.content?.sha || cachedSha;
    return;
  }
  throw new Error('GitHub save db.json: no se pudo resolver el conflicto de versión');
}

module.exports = {
  USE_GITHUB_DB,
  REPO,
  BRANCH,
  fetchRemoteDb,
  saveRemoteDb
};
