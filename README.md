# COURTSIDE · 海岸羽毛球俱乐部

用手机当球拍，也能用键盘随时开一局。基于 Three.js 和 Socket.IO 的3D体感羽毛球小游戏，支持九位角色、单人对电脑、双人分屏和定点训练。

## 启动

```sh
npm install
npm start
```

大屏入口为 `http://localhost:3100/`，手机控制器通过同一WiFi扫描页面二维码进入HTTPS3543。可用环境变量 `PORT` 与 `PORT_HTTPS` 修改端口。本轮独立预览运行在3101/3544。

## 游戏流程

欢迎入场 → 选择搭档 → 选择单人/双人、难度、键盘/手机 → 进入球场 → 比赛结果 → 再来一局或回俱乐部。

- 单人键盘：空格挥拍，A/D调整方向。按住 Shift 打轻球，按住 Alt 杀球。
- 双人键盘：另一位使用回车挥拍，J/L调整方向，同样可组合 Shift 或 Alt。
- 手机：开启体感、校准并试挥后入场。手机与大屏同步选角。
- 球员自动跑位；先到7分获胜。对局中的“角色”可快速换搭档；“俱乐部”返回准备流程。
- `/characters.html` 保留角色图鉴与动作对照。

手机体感需要安全上下文。本地HTTPS证书由现有服务生成；公网部署需使用有效HTTPS和支持WebSocket的Node服务。当前为同一服务实例共享一场比赛，尚未实现多房间系统。本轮完成本地项目整合和验证，未执行公网发布。

## 开发与验证

```sh
npm test
npm run characters:build
```

浏览器回归：`npm run test:game:browser` 与 `npm run test:characters:browser`；需提供Playwright、pngjs及Chrome，可用 `NODE_PATH` 指向环境的工具包目录，`CHROME_PATH` 和 `CHARACTER_TEST_URL` 覆盖浏览器及测试地址。

125项Node测试覆盖玩法、网络、角色和动线状态；浏览器检查覆盖首页至比赛、快速选角、手机就绪、双人、移动布局，以及角色对照。另通过实际键盘对局验证7:6结算与续局归零。

说明见 [游戏动线](docs/game-experience.md)、[角色系统](docs/character-system-usage.md) 与 [海岸球场](docs/coastal-arena.md)。

## 动作研究室

`/motion.html` 可在相同输入下对照升级前后的挥拍、横移、急停与网前弓步，支持左右手、视角、慢放和拖动时间轴。新版动作已用于正式球场。

`node tools/motion-audit.mjs` 以30/60/120Hz检查真实骨骼支撑脚位移；结果见 [运动审计](docs/motion-audit.json)。这是合成输入下的运动学检查，当前未使用真人动捕或完整人体物理仿真。方案比较与后续素材路线见 [动作真实性调研](docs/motion-realism-research.md)。

`/shot-lab.html` 提供网前球和向前下压杀球的固定喂球。选择位置、球路、旧版或新版判定，手动挥拍或回放预设时机。按“跳到触球”可近看拍面，再拖动时间轴检查球路。新版拍面判定已接入正式比赛的网前球和杀球。

击球练习新增 `?shot=drive`，可回放后场正手被动抽球的后交叉、蹬跨和回中，并对照普通球、低球及远侧边线。正式比赛中，自动跑位进入后场正手低球时，普通挥拍会选用这套动作。

`/shot-lab.html?shot=slice` 可练后场反手被动切吊。对照直线、斜线与延后挥拍，拖动时间轴观察确认步和拍面。正式比赛自动识别适合这套动作的反手后场来球。

反手动作采样来自 Court Lab `678ded9` 导出的 Blender GLB。更新源资产后可运行 `npm run motion:sync -- <Court Lab 本地目录>`，重新生成浏览器和服务端共用的动作数据。

### 从 Court Lab 持续同步动作

在 Court Lab 里继续编辑、导出 `dist/models/athlete-animations.glb`。游戏端提供三条命令：

- `npm run motion:sync` 导入一次，并验证球路和骨骼回归。
- `npm run motion:watch` 自动检测导出文件更新。验证失败时保留上一次通过的游戏版本。
- `PORT=3103 PORT_HTTPS=3546 npm run dev:motion` 一起启动动作监听和开发预览。有效动作更新后服务会自动重载，重新打开或刷新页面即可试玩。服务器重载会重置当前本地对局，边打比赛时可只开 `motion:watch`，打完后重启预览。

若两个项目的位置不同，设置 `COURT_LAB_DIR` 为 Court Lab 的绝对路径。现有反手动作约定使用 `backhand_straight`、`backhand_cross` 两个片段，保留 Xbot 骨骼及 `RacketGrip`、`RacketContact`、`RacketFaceNormal` 标记。目前触球基准仍为片段 50%；同动作的关键帧、姿态和回中可以反复导出更新。新增另一种技术动作时，游戏端需为它登记动作名、触球阶段和触发条件，后续导出可以复用这条流程。

### 共用角色与动作校验

游戏项目维护 `art/characters/roster/*.blend` 和九套导出角色。Court Lab 可运行 `npm run characters:sync` 导入这些角色，在相同教学骨架上播放和检查技术动作。角色外形在本项目编辑，技术动作在 Court Lab 编辑，双方通过 GLB 复用资产。

动作同步默认查找同级 `forehand-lab`，也接受命令参数或 `COURT_LAB_DIR`。新版 Court Lab 每次导出会同时生成 `motion-manifest.json`。导入校验文件摘要、骨架协议、坐标、片段时长、球拍标记及反手触球时机，然后用待发布数据运行步法、骨骼和九角色回归。监听同时覆盖 GLB 与 manifest，两者导出完成后重试导入。历史 GLB 缺少 manifest 时使用原采样校验，并打印兼容模式提示。

目前此同步流程使用直线、斜线两个反手片段。Court Lab 的完整动作目录可作为后续技术接入依据，新增片段仍需结合游戏的来球判定、可达范围与触球逻辑接入。

### 柔光与织物效果

凌川和晴岚的 Blender 源文件已加入球衣 UV。`public/js/athlete-materials.js` 为球衣、皮肤、头发和眼睛设置独立表面参数，球衣叠加 ambientCG Fabric001 的 CC0 法线与粗糙度，场景使用 Poly Haven Studio Small 09 的 1K CC0 环境光。资源保存在 `public/assets`，来源与许可见其中的 `LICENSES.md`。

比赛默认启用升级材质，链接附加 `look=basic` 可查看基础效果。Court Lab 导入角色时同步材质模块和本地资源，页面可即时切换两种效果。`tools/refine-athlete-surfaces.py` 可在已保存的成人角色模型上补充缺少的 UV 并调整表面参数，之后仍由 `characters:build` 导出。当前提升覆盖材质、受光与近景观察，角色沿用现有风格化造型。
