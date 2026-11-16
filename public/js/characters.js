// Shared browser/server allowlist. Model URLs never come from controller input.
export const DEFAULT_CHARACTER_ID = 'athlete';
export const CHARACTERS = Object.freeze([
  { id: 'athlete', name: '经典运动员', label: '默认', description: '经典球场搭档' },
  { id: 'rabbit-geo', name: '棉球 · 几何版', label: '几何风', description: '利落轮廓，轻巧有趣' },
  { id: 'rabbit-glb', name: '棉球 · 柔和版', label: '柔和风', description: '圆润脸型，微弯的耳朵' },
  ...[
    ['dino', '小焰', '活力小恐龙', 'kids', '0–8 岁', '橘色小恐龙，带着勇气上场'],
    ['kitten', '桃桃', '元气小猫', 'kids', '0–8 岁', '奶油小猫，把每一拍变成惊喜'],
    ['junior-boy', '追风', '热血少年', 'teens', '9–17 岁', '束起发带，追上下一颗球'],
    ['junior-girl', '星跃', '灵动少女', 'teens', '9–17 岁', '马尾轻扬，步法里藏着节奏'],
    ['young-man', '凌川', '都市运动员', 'young-adults', '18–30 岁', '冷静出手，在球场找回状态'],
    ['young-woman', '晴岚', '轻盈运动员', 'young-adults', '18–30 岁', '利落盘发，每一拍都很从容'],
  ].map(([id, name, label, group, audience, description]) => ({
    id, avatar:id, name, label, group, audience, description,
  })),
].map(character => Object.freeze({
  ...character,
  modelUrl: `/models/characters/${character.id}.glb`,
  appearance: 'imported',
  effectiveHeight: 1.82,
  thumbnail: `/images/characters/${character.id}.png`,
})));
export function isCharacterId(id) { return typeof id === 'string' && CHARACTERS.some(c => c.id === id); }
export function getCharacter(id) { return CHARACTERS.find(c => c.id === id) || CHARACTERS[0]; }
