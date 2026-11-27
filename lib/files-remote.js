/**
 * Archivos binarios (fotos subidas y Excel de pedidos) en la misma rama `data`
 * que db.json. En Vercel /tmp se borra en cada cold start, así que GitHub es
 * la copia permanente y /tmp queda solo como caché.
 */
const { USE_REMOTE_DB, BRANCH, githubFetch, ensureDataBranch } = require('./db-remote');

const USE_REMOTE_FILES = USE_REMOTE_DB;
let branchReady = null;

function encodePath(repoPath) {
  return String(repoPath).split('/').map(encodeURIComponent).join('/');
}

function readyBranch() {
  if (!branchReady) branchReady = ensureDataBranch().catch(err => { branchReady = null; throw err; });
  return branchReady;
}

async function shaFromJson(repoPath) {
  const res = await githubFetch(`/contents/${encodePath(repoPath)}?ref=${BRANCH}`, {
    headers: { Accept: 'application/vnd.github.object+json' }
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub sha ${repoPath}: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return json.sha || null;
}

async function putRemoteFile(repoPath, buffer, message) {
  if (!USE_REMOTE_FILES) throw new Error('Falta GITHUB_TOKEN para guardar archivos.');
  await readyBranch();
  const content = Buffer.from(buffer).toString('base64');
  let sha;
  for (let attempt = 0; attempt < 5; attempt++) {
    const body = { message: message || `chore: upload ${repoPath}`, content, branch: BRANCH };
    if (sha) body.sha = sha;
    const res = await githubFetch(`/contents/${encodePath(repoPath)}`, {
      method: 'PUT',
      body: JSON.stringify(body)
    });
    if (res.ok) return;
    if (res.status === 409 || res.status === 422) {
      // 409: la rama se movió (otro guardado en paralelo). 422: el archivo ya existe y falta sha.
      sha = await shaFromJson(repoPath).catch(() => undefined) || undefined;
      await new Promise(r => setTimeout(r, 250 * (attempt + 1)));
      continue;
    }
    throw new Error(`GitHub upload ${repoPath}: ${res.status} ${await res.text()}`);
  }
  throw new Error(`GitHub upload ${repoPath}: conflicto de versión`);
}

async function getRemoteFile(repoPath) {
  if (!USE_REMOTE_FILES) return null;
  const res = await githubFetch(`/contents/${encodePath(repoPath)}?ref=${BRANCH}`, {
    headers: { Accept: 'application/vnd.github.raw' }
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub read ${repoPath}: ${res.status} ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

async function deleteRemoteFile(repoPath) {
  if (!USE_REMOTE_FILES) return;
  for (let attempt = 0; attempt < 4; attempt++) {
    const sha = await shaFromJson(repoPath);
    if (!sha) return;
    const res = await githubFetch(`/contents/${encodePath(repoPath)}`, {
      method: 'DELETE',
      body: JSON.stringify({ message: `chore: delete ${repoPath}`, sha, branch: BRANCH })
    });
    if (res.ok || res.status === 404) return;
    if (res.status === 409 || res.status === 422) {
      await new Promise(r => setTimeout(r, 250 * (attempt + 1)));
      continue;
    }
    throw new Error(`GitHub delete ${repoPath}: ${res.status} ${await res.text()}`);
  }
}

module.exports = {
  USE_REMOTE_FILES,
  putRemoteFile,
  getRemoteFile,
  deleteRemoteFile
};
