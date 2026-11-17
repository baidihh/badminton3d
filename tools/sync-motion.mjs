import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { courtLabDirectory, stagedModuleImport } from './motion-import.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const serve = args.includes('--serve');
const watch = serve || args.includes('--watch');
const flags = args.filter(arg => arg.startsWith('--') && !['--serve', '--watch'].includes(arg));
if (flags.length) throw new Error(`未知参数 ${flags.join(' ')}`);
const source = courtLabDirectory(args.find(arg => !arg.startsWith('--')));
const asset = join(source, 'dist/models/athlete-animations.glb');
const manifest = join(source, 'dist/models/motion-manifest.json');
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
const readManifest = () => readFile(manifest).catch(error => {
  if (error.code === 'ENOENT') return Buffer.alloc(0);
  throw error;
});
async function sync() {
  // Stage next to the published file so the final rename stays on one volume.
  const stage = await mkdtemp(join(dirname(output), '.motion-import-'));
  const staged = join(stage, 'backhand.mjs');
  try {
    const hash = digest(await readFile(asset));
    const manifestHash = digest(await readManifest());
    const published = await readFile(output, 'utf8').catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return '';
    });
    await run([importer, source, staged]);
    const ready = await readFile(staged, 'utf8');
    if (!ready.startsWith(`// Source GLB sha256: ${hash}\n`)) throw new Error('导出仍在写入，稍后重试');
    // Test against the staged module without changing what the live game imports.
    await run(['--import', stagedModuleImport(output, staged), '--test', 'test/rear-forehand.test.js', 'test/motion-rig.test.js', 'test/roster.test.js']);
    if (stopping || digest(await readFile(asset)) !== hash || digest(await readManifest()) !== manifestHash) throw new Error('导出已变化，保留上一次验证通过的版本');
    if (ready === published) return;
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
    const infos = await Promise.all([asset, manifest].map(file => stat(file).catch(() => null)));
    const revision = infos.map(info => info ? `${info.ino}:${info.size}:${info.mtimeMs}` : 'missing').join('|');
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
