import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function courtLabDirectory(argument, environment = process.env) {
  return path.resolve(argument || environment.COURT_LAB_DIR || fileURLToPath(new URL('../../forehand-lab/', import.meta.url)));
}

export function stagedModuleImport(published, candidate) {
  const target = pathToFileURL(published).href;
  const replacement = pathToFileURL(candidate).href;
  const hook = `export async function resolve(id, ctx, next) { const result = await next(id, ctx); return result.url === ${JSON.stringify(target)} ? {...result, url:${JSON.stringify(replacement)}} : result; }`;
  const setup = `import { register } from 'node:module'; register(${JSON.stringify('data:text/javascript,' + encodeURIComponent(hook))});`;
  return 'data:text/javascript,' + encodeURIComponent(setup);
}

export function validateMotionManifest(manifest, bytes) {
  if (manifest.schemaVersion !== 1 || manifest.rig !== 'xbot-world-bind-v1') throw new Error('动作包骨架或协议版本不兼容');
  if (manifest.sha256 !== createHash('sha256').update(bytes).digest('hex')) throw new Error('动作包校验失败，请重新导出 GLB 和 manifest');
  const coordinate = manifest.coordinates;
  if (coordinate?.up !== '+Y' || coordinate.net !== '-Z' || coordinate.racketSide !== '+X' || coordinate.unit !== 'meter') throw new Error('动作包坐标约定不兼容');
  for (const name of ['backhand_straight', 'backhand_cross']) {
    const clip = manifest.clips?.find(clip => clip.name === name);
    if (!clip || !Number.isFinite(clip.duration) || clip.duration <= 0 || clip.contact !== .5) {
      throw new Error(`动作 ${name} 触球时机不兼容，请同步调整游戏触球阶段后导入`);
    }
  }
  for (const name of ['RacketRoot', 'RacketGrip', 'RacketContact', 'RacketFaceNormal']) {
    if (!manifest.markers?.includes(name)) throw new Error(`动作包缺少球拍标记 ${name}`);
  }
}
