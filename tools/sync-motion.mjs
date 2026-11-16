import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const serve = args.includes('--serve');
const watch = serve || args.includes('--watch');
const flags = args.filter(arg => arg.startsWith('--') && !['--serve', '--watch'].includes(arg));
if (flags.length) throw new Error(`未知参数 ${flags.join(' ')}`);
const source = resolve(args.find(arg => !arg.startsWith('--')) || process.env.COURT_LAB_DIR || join(root, '../ai_mac/development/forehand-motion-lab'));
const asset = join(source, 'dist/models/athlete-animations.glb');
const output = join(root, 'public/js/backhand-clip-data.js');
const importer = join(root, 'tools/build-backhand-motion.mjs');
let server;
let child;
let stopping = false;

function run(args, options = {}) {
  return new Promise((accept, reject) => {
    child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit', ...options });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      child = null;
      if (code === 0) accept();
      else reject(new Error(`命令退出 ${code ?? signal}`));
    });
  });
}

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function sync() {
  // Stage next to the published file so the final rename stays on one volume.
  const stage = await mkdtemp(join(dirname(output), '.motion-import-'));
  const staged = join(stage, 'backhand.mjs');
  try {
    const hash = digest(await readFile(asset));
    const published = await readFile(output, 'utf8').catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return '';
    });
    if (published.startsWith(`// Source GLB sha256: ${hash}\n`)) return;
    await run([importer, source, staged]);
    const ready = await readFile(staged, 'utf8');
    if (!ready.startsWith(`// Source GLB sha256: ${hash}\n`)) throw new Error('导出仍在写入，稍后重试');
    // Test against the staged module without changing what the live game imports.
    const target = pathToFileURL(output).href;
    const candidate = pathToFileURL(staged).href;
    const hook = `export function resolve(id, ctx, next) { const result = next(id, ctx); return result.url === ${JSON.stringify(target)} ? {...result, url:${JSON.stringify(candidate)}} : result; }`;
    const setup = `import { register } from 'node:module'; register(${JSON.stringify('data:text/javascript,' + encodeURIComponent(hook))});`;
    await run(['--import', 'data:text/javascript,' + encodeURIComponent(setup), '--test', 'test/rear-forehand.test.js', 'test/motion-rig.test.js']);
    if (stopping || digest(await readFile(asset)) !== hash) throw new Error('导出已变化，保留上一次验证通过的版本');
    await rename(staged, output);
    console.log(`动作已更新 ${hash.slice(0, 12)}`);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

if (!watch) {
  await sync();
  console.log('动作数据已与 Court Lab 导出同步。');
} else {
  // Watch the published asset, not Blender's working file. Polling also handles
  // atomic moves, git checkouts and export tools that replace the inode.
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    stopping = true;
    child?.kill();
    server?.kill();
  });
  let observed, handled, sameSince = 0;
  console.log(`监看 ${asset}`);
  while (!stopping) {
    const info = await stat(asset).catch(() => null);
    const revision = info ? `${info.ino}:${info.size}:${info.mtimeMs}` : 'missing';
    if (revision !== observed) { observed = revision; sameSince = Date.now(); }
    if (revision !== handled && Date.now() - sameSince >= 900) {
      handled = revision;
      try {
        await sync();
        if (serve && !server && !stopping) {
          server = spawn(process.execPath, ['--watch', 'server.js'], { cwd: root, stdio: 'inherit' });
          server.once('exit', code => { stopping = true; if (code) process.exitCode = code; });
        }
      } catch (error) { if (!stopping) console.error(`导入未发布：${error.message}`); }
    }
    if (!stopping) await delay(450);
  }
}
