// Legacy source archives have no publisher SHA256SUMS. Pin the commit first,
// then verify every file against the active source's Git tree, before copying
// any code.
//
// Both providers expose the same shape — commit → tree sha → recursive tree of
// Git blob SHA-1s — so one verifier serves both. The only differences are the
// API base (api.github.com/repos/… vs gitee.com/api/v5/repos/…) and the tree
// mode spelling ("040000" on GitHub, "40000" on Gitee). A provider without a
// tree API fails closed instead of silently skipping verification.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fetchJson } from './update-net.js';
import { releaseSource } from './update-source.js';

const shaPattern = /^[0-9a-f]{40}$/i;
const treeModes = new Set(['040000', '40000']);

/** Git tree API base for the active source; throws a readable error when it has none. */
function treeApi(env) {
  const source = releaseSource(env);
  if (typeof source.gitApiBaseUrl !== 'function') {
    throw Error(`${source.label || '当前发行源'} 不支持 Git tree 逐文件校验；请改走发行包（.tgz + SHA256SUMS）通道`);
  }
  return { source, base: source.gitApiBaseUrl(source.repo) };
}

export async function sourceManifest(ref, { json = fetchJson, ms = 45000, env = process.env } = {}) {
  const { source, base } = treeApi(env);
  const commit = await json(`${base}/commits/${encodeURIComponent(ref)}`, ms);
  if (!shaPattern.test(commit?.sha || '') || !shaPattern.test(commit?.commit?.tree?.sha || ''))
    throw Error(`${source.label} 无法验证 commit/tree；未下载或安装`);
  if (shaPattern.test(ref) && ref.toLowerCase() !== commit.sha.toLowerCase()) throw Error(`${source.label} commit 不匹配`);
  const tree = await json(`${base}/git/trees/${commit.commit.tree.sha}?recursive=1`, ms);
  if (tree?.truncated || tree?.sha !== commit.commit.tree.sha || !Array.isArray(tree.tree) || !tree.tree.length)
    throw Error(`${source.label} Git tree 不完整；未安装`);
  const files = new Map();
  for (const entry of tree.tree) {
    const rel = entry.path;
    if (typeof rel !== 'string' || !rel || /[\\\x00-\x1f:]/.test(rel) || rel.split('/').some(x => !x || x === '.' || x === '..'))
      throw Error(`${source.label} Git tree 路径无效`);
    if (entry.type === 'tree' && treeModes.has(entry.mode)) continue;
    if (entry.type !== 'blob' || !['100644','100755'].includes(entry.mode) || !shaPattern.test(entry.sha) || files.has(rel))
      throw Error(`${source.label} Git tree 含不支持的文件类型或重复文件；未安装`);
    files.set(rel, entry);
  }
  if (!files.has('package.json')) throw Error(`${source.label} Git tree 缺少 package.json`);
  return { sha: commit.sha, files, provider: source.name, method: `${source.name}-git-tree` };
}
export function verifySourceTree(root, manifest) {
  const seen = new Set();
  function visit(dir, prefix = '') {
    for (const name of fs.readdirSync(dir)) {
      const rel = prefix + name, file = path.join(dir, name), stat = fs.lstatSync(file);
      if (stat.isDirectory()) { visit(file, rel + '/'); continue; }
      if (!stat.isFile()) throw Error(`归档含非普通文件：${rel}`);
      const entry = manifest.files.get(rel);
      if (!entry) throw Error(`归档含未登记文件：${rel}`);
      const bytes = fs.readFileSync(file);
      const hash = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
      if (hash !== entry.sha) throw Error(`归档完整性校验失败：${rel}`);
      seen.add(rel);
      if (process.platform !== 'win32') fs.chmodSync(file, entry.mode === '100755' ? 0o755 : 0o644);
    }
  }
  visit(root);
  for (const file of manifest.files.keys()) if (!seen.has(file)) throw Error(`归档缺失文件：${file}`);
  return { sha: manifest.sha, verifiedFiles: seen.size, method: manifest.method || 'git-tree' };
}
