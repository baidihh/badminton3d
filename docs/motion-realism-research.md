# 手部、步法与身体真实性调研

日期：2026-11-03。用户重点：先让画面里的挥拍、步法和重心像真人；不要求本轮做手机到全身的逐关节跟踪。

## 推荐结论

继续使用Three.js，采用“羽毛球专用动作素材 + 分层动作混合 + 触球约束 + 脚底接触与骨盆修正”的混合方案。先改掉当前程序动作的滑步、发力脱节与摆拍问题，再用真人动捕/精修动画提高动作风格和细节上限。

本轮已落地一版接触感更强的程序驱动；它没有引入真人动捕，也不是完整人体动力学。纯刚体布娃娃、装上物理引擎或换一款角色模型，都不会自动生成专业羽毛球动作。

## 当前实现为什么看起来不够真实

检查位置：`public/js/player.js`、`stroke.js`、`game/game.js`、已有技术动作映射文档及Xbot动作片段。

1. 拍头沿少量关键点移动，再从拍头反推手腕和手肘。拍杆基本与肩到拍头连线共线，缺少引拍时的手拍夹角、前臂旋转和收拍。
2. 上身主要追球扭转，非持拍手保持近似固定位置；髋、胸、肩、肘、前臂没有共同的发力阶段。
3. 脚步目标追随根节点，超出腿长后直接拉近目标；代码认为在支撑的脚也可能发生位移。快速移动时两只脚可能同时摆动。
4. 脚部朝向主要继承原有动画，没有完整的落脚朝向、脚跟/脚尖滚动和支撑定义。
5. 启动小跳在球进入本方半场时触发，容易晚于对手击球；脚的上抬和身体离地也没有统一处理。
6. Xbot只有通用idle/walk/run等片段，不含羽毛球专用高远、杀球、弓步、蹬转和回中片段。通用跑步不能自动变成专业球场步法。
7. 多数现有角色的手掌是整体几何形状，没有会变形的手指。骨架含手指骨，不代表当前手部网格能表现真实握拍。

## 一、原地程序动作 + 接触约束

做法：明确支撑/摆动阶段；支撑足保持世界位置，抬脚时冻结本次落点；用骨盆平移、下沉和身体倾斜表现承重。挥拍使用分阶段参考姿态，最后用IK修正拍面中心。

优点是无需外部服务、轻量、容易保持服务端命中一致，适合现在的九个角色。代价是动作风格仍由开发者手工定义，专业动作的细节上限有限。

Daniel Holden给出的脚底锁定方法同样区分接触状态：接触时跟随固定地面目标，离地后回到动画目标，并用惯性过渡避免切换跳变。这是本项目支撑约束的参考方向。[Inverse Kinematics and Foot Locking](https://theorangeduck.com/page/inverse-kinematics-foot-locking)。

Three.js的CCDIKSolver是骨链IK求解器；它解决关节对目标的几何关系，不包含身体承重和主动站立控制。现有两骨解析IK可以继续用，不必为了“更真实”直接替换成CCD。[CCDIKSolver](https://threejs.org/docs/pages/CCDIKSolver.html)。

## 二、专用动作素材 + Warping + IK（主路线）

离线准备真实的羽毛球动作片段，运行时根据方向、触球高度、速度、持拍手选择和混合；在触球附近对手、拍和身体进行有限修正，移动时按实际位移调整步幅与脚底接触。

可参考Epic的Orientation/Stride Warping和Motion Warping：分别调整朝向、步幅或一段动作的目标变换。它们是UE功能，不能直接安装进Three.js；本项目要实现对应思路。[Pose Warping](https://dev.epicgames.com/documentation/unreal-engine/pose-warping-in-unreal-engine)、[Motion Warping](https://dev.epicgames.com/documentation/unreal-engine/motion-warping-in-unreal-engine)。

切换时用惯性过渡保留位置/角速度的连续性，比生硬重置姿势自然。Epic也将Inertialization用于动作过渡；本项目第一轮只使用平滑参考曲线和状态连续性，并未完整实现该引擎节点。[Animation Blend Nodes](https://dev.epicgames.com/documentation/unreal-engine/animation-blueprint-blend-nodes-in-unreal-engine)。

这是工程推荐，不是某个工具经过本项目画质实测后的排名。可靠的脚接触标注、统一骨架和足够好的动作素材，是它能否成功的关键。

## 三、视频动捕：更容易获得动作素材

Rokoko Vision官方提供视频到动作流程，并能经Studio清理、重定向后导出FBX/BVH，支持Mixamo等骨架。它适合作为离线制作动作的起点，不应被理解为视频上传后即可直接用于游戏。[Vision官方说明](https://www.rokoko.com/products/vision)、[导出说明](https://support.rokoko.com/hc/en-us/articles/18877624744721-Rokoko-Studio-Export-options-and-file-formats)。

DeepMotion提供不同脚底锁定模式，包括自动、总是、从不与贴地模式。错误地把“总是锁定”用到跳跃上会破坏动作，因此仍须按接触阶段验收。[Foot Locking Modes](https://www.deepmotion.com/post/animate-3d-v2-6-release-foot-locking-modes)。

建议用获得授权的自己/合作球员视频制作素材。全身、脚底和球拍尽量完整入镜，保留固定地面与尺度参照；高速拍头与遮挡的肩肘需要人工检查。单目重建的深度、接触和高速前臂旋转可能出错，不能把生成结果当物理真值。

本轮未付费试跑这些服务，未上传玩家视频，未声称其中某家能自动还原专业羽毛球动作。供应商套餐/导出权限应在实际制作时重新确认。

## 四、Motion Matching：动作库成熟后再考虑

根据当前姿势、脚接触、未来移动轨迹等特征，持续在动作库中搜索合适的后续姿势。Ubisoft的研究展示了这一思路及其学习式压缩方案。[Learned Motion Matching论文](https://staticctf.ubisoft.com/J3yJr34U2pZ2Ieem48Dwy9uqj5PNUQTn/2EVXGPN6ynTrrJaaAUHmZS/060e223cce6a84e47e925105cac5e17f/Learned_Motion_Matching.pdf)。

本项目目前缺的是羽毛球专用动作数据，而不是搜索器；七个通用片段不足以覆盖急停、跨步、后退、蹬转和击球。先做小而好的动作集合，后续再评估动作匹配，收益更稳妥。

## 五、主动布娃娃 / 强化学习物理角色

Rapier能提供关节和运动学角色控制等基础设施，但它的运动学角色控制器主要处理移动与环境碰撞，不是会自主保持平衡的人体。[Joints](https://rapier.rs/docs/user_guides/javascript/joints/)、[Character Controller](https://rapier.rs/docs/user_guides/javascript/character_controller/)。

DeepMimic通过参考动作与任务目标训练物理角色控制策略，能表现受扰恢复和复杂技能；Ubisoft DReCon结合动作匹配与强化学习来控制物理角色。这类路线具有潜力，也意味着训练、碰撞体、质量/惯量、关节驱动和目标控制等额外系统。[DeepMimic](https://xbpeng.github.io/projects/DeepMimic/)、[DReCon](https://www.ubisoft.com/en-us/studio/laforge/news/VjEIwquaIyEZZSw5RZI0V/drecon-datadriven-responsive-control-of-physicsbased-characters)。

项目判断：浏览器双人分屏、实时体感和九个卡通角色的当前阶段，先做接触约束与好动作素材更划算。完整物理驱动适合单独实验，不应直接替换现有对局主链路。

## 六、手机与摄像头输入的边界

单部手机不能独立观测肩、肘、骨盆和双脚的位置；手机姿态和挥拍信号不足以唯一确定全身动作。当前“像真人”应优先指角色运动可信，不能称为玩家全身动作的一比一捕捉。

如果以后增加摄像头，MediaPipe Pose Landmarker能输出图像/三维世界坐标中的身体关键点，但仍需置信度、遮挡、尺度和脚接触处理，也不直接输出真实地面反力或关节力矩。[官方文档](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker)。

## 羽毛球动作需要遵循什么

BWF教学材料中的正手杀球包含侧身准备、后腿承重、抬肘、前臂旋转、击球与落地恢复；弓步强调领先脚、膝与脚的方向及身体平衡。项目应表现这些可读的协调关系，而不是只让球拍碰到球。[BWF Shuttle Time教师手册（澳大利亚羽协提供）](https://www.badminton.org.au/wp-content/uploads/2022/11/1.-BWF-ST-Teachers-Manual_Inclusivity_ENGLISH.pdf)。

下一批素材建议：准备姿势、启动步、左右并步、交叉步、后退蹬转、左右网前弓步、回中、高远/吊球/杀球、正反侧接球姿势。各片段标记加载、脚接触、起跳/落地、触球、收拍和可中断窗口，配正侧背视角与不同触球高度验收。

## 本轮已实现与未实现

已实现：独立支撑与摆动规划、固定落点、脚部朝向和滚动、骨盆支撑转移及加速倾斜、对手击球事件启动提示、协调的髋/胸/前臂与平衡手阶段，以及经过权威触球点的连续轨迹。新版用于正式球场，`/motion.html` 可与冻结旧版同条件对照。

未实现：真实羽毛球动捕、全身碰撞防穿模、完整手指握拍变形、地面反作用力、关节力矩和经过验证的真实人体重心模型。当前骨盆偏移是视觉承重近似，不能称为生物力学仿真。

对手击球事件受网络延迟影响，本轮比“球过半场才启动”更早，但尚不等于对手触球前预测启动；空中双脚与身体统一抬升也只是受控的启动小跳，尚未制作完整跳杀动作。

诊断命令：`node tools/motion-audit.mjs`。脚滑检查用连续支撑帧的真实踝关节世界位置，不只读规划目标；它是合成输入下的运动学回归，不是所有比赛姿态的保证。完整数据与验证结论见 `docs/motion-audit.json` 和后续验收记录。

## 本轮验收

- 125项Node测试全部通过，涵盖左右手及现有角色触球、支撑脚、延迟触球确认、鞋底贴地、低球准备姿势和事件时效。
- 30/60/120Hz合成横移审计完成。60Hz、1.6m/s下旧版支撑踝平均每帧移动16.44mm，新版低于0.001mm；3.6m/s下旧版33.94mm，新版低于0.001mm。这只说明连续支撑帧的位置锁定有效，不表示真实人体运动误差达到该精度。
- Chrome WebGL检查确认实际角色可见，慢放/暂停/时间轴/左右手/视角切换可用，390px布局无横向溢出，无页面脚本错误。截图保存在本目录的motion-*.png。
- 画面仍采用统一可爱运动员比例，真实动作节奏和关节细节需要专用素材继续提升。
