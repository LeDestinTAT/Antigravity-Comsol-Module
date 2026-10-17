# Antigravity COMSOL 6.2 Module

面向 [`Antigravity-Codex-Workspace`](https://github.com/LeDestinTAT/Antigravity-Codex-Workspace) 与独立环境的 **COMSOL Multiphysics 6.2 自动化模块**。

参考开源社区成熟方案（`COMSOL_Multiphysics_MCP`、`mph-agent`、`2p1c/comsol-skills` 与 `MPh`），并针对大模型最容易出错的 **COMSOL 6.2 精准几何建模（`global/comsol-geometry.cjs`）** 与 **多物理场理解、约束校验及增量调优（`global/comsol-physics.cjs`）** 内置了双核心引擎。

## 核心特性

1. **COMSOL 6.2 精准几何建模与拓扑校验引擎（`global/comsol-geometry.cjs`）**
   - **三维包围盒（AABB）与布尔运算预检**：支持解析 COMSOL 参数与单位表达式（如 `10[mm]`、`500[um]`），在调用 COMSOL 前直接计算所有几何特征的真实空间包围盒，自动拦截“布尔差集（`Difference`）工具体与目标体不相交”、“差集工具体完全吞没目标体”以及会导致网格畸变（`Inverted mesh element`）的微米级缝隙（Sliver / Micro-gap）。
   - **零硬编码面编号（Coordinate `FaceBox` & `selresult`）**：彻底摒弃在布尔/阵列操作后极易错位的 `selection().set(new int[]{1, 3})` 硬编码面序号，自动根据特征包围盒生成精确的坐标包围盒选择集（`Box` Selection：`xmin/xmax/ymin/ymax/zmin/zmax`）与特征选择集（`selresult = true`）。
   - **COMSOL 6.2 Java 几何源码审计（`audit-geometry`）**：自动拦截在 3D 几何序列下直接创建 2D `Rectangle`/`Circle`（未包裹在 `WorkPlane` 中）、误用 `.set("input", ...)` 替代 `.selection("input").set(...)`、以及 `Difference` 漏设 `input2` 等高频错误。
2. **COMSOL 6.2 多物理场理解、约束诊断与调优引擎（`global/comsol-physics.cjs`）**
   - **多物理场与控制方程理解**：内置固体力学（`SolidMechanics`）、层流（`LaminarFlow`）、固体/流体传热（`HeatTransfer`）、压力声学（`PressureAcoustics`）、电磁波与波动光学（`ElectromagneticWavesFrequencyDomain` / `WaveOptics`）、静电（`Electrostatics`）、电流（`ElectricCurrents`）及磁场（`MagneticFields`）的因变量、默认初值、必选材料属性及边界/域特征知识库。
   - **适定性（Well-Posedness）与约束校验（`validate-physics`）**：在求解前静态拦截会导致 `Singular matrix`（奇异矩阵）的欠约束稳态场（如固体力学缺少 `Fixed` 约束、传热缺少温度参考或对流边界、声学缺少声压或硬声场边界、电磁波缺少 PEC/端口边界、电流场缺少 `Ground`、层流缺少压力参考出口）、同一选择集上的 Dirichlet 边界冲突、边界/域维度错配，以及热膨胀耦合漏配热膨胀系数 `alpha` 等问题。
   - **多物理场耦合（Multiphysics Couplings）**：支持 `NonIsothermalFlow`（流-热）、`ThermalExpansion`（热-力）、`FluidStructureInteraction`（流-固）、`ElectromagneticHeating`（焦耳热 / 高频电磁加热）、`AcousticStructureBoundary`（声-固）、`Piezoelectricity`（压电 力-电）及 `LorentzForce`（洛伦兹力 电-力）的自动绑定与双向物理场校验。
   - **物理场增量调优（`tune-physics`）**：无需重写整个模型，通过声明式 Patch 即可精准调整全局参数、初值条件（支持 `autoAlignInitialValues` 自动对齐 Dirichlet 边界温度/电位以加速非线性收敛）、边界条件切换（如将定温边界无缝切换为对流换热 `ConvectiveHeatFlux`）、多物理场耦合开关及稳态载荷递增延拓（Continuation Ramp）。
3. **独立运行与双 Agent 架构双模支持**
   - **独立模式（`standalone`）**：在未安装主桥接器或外部 Agent 的电脑上亦可完全独立运行，完成几何校验、多物理场调优、Java 生成、编译、批处理与结构化日志诊断。
   - **附加模式（`merged-dual-agent`）**：挂载至主框架 `~/.dual-agent/addons/registry.json` 与 `~/.dual-agent/comsol.cjs`。当编译或求解失败时，传入 `--auto-fix` 会自动携带精简日志（`<= 800` 字符）与物理场修复提示（`Hint`）调用 `~/.dual-agent/client.cjs` 交由 Codex 闭环修复。

## 安装与挂载

```powershell
# 1. 作为附加模块挂载到当前环境的 ~/.dual-agent（或独立安装）
node deploy-comsol.cjs install

# 2. 如果将本模块文件直接复制合并到 Antigravity-Codex-Workspace 目录下，可一键安装主体+附加模块
node deploy-comsol.cjs install --with-core

# 3. 环境与挂载状态自检
node deploy-comsol.cjs doctor
```

## 常用 CLI 命令

### 1. 独立运行模式（无需全局桥接器）
```powershell
# 查看所有内置几何与多物理场预设
node templates/comsol-automation/scripts/comsol.cjs list-presets

# 校验模型
node templates/comsol-automation/scripts/comsol.cjs validate-model --preset acoustic-cavity-resonator

# 构建 Java 源码
node templates/comsol-automation/scripts/comsol.cjs build-model --preset optical-waveguide --out OpticalWaveguide.java

# 审计 Java 源码
node templates/comsol-automation/scripts/comsol.cjs audit-model --source OpticalWaveguide.java
```

### 2. 全局/附加模式（通过 Dual-Agent Bridge）
```powershell
# 1. 校验、调优并生成完整的 COMSOL 6.2 模型
node ~/.dual-agent/comsol.cjs validate-model --preset conjugate-heat-microchannel
node ~/.dual-agent/comsol.cjs tune-model --preset conjugate-heat-microchannel --param L_sink=25[mm] --param U_in=0.45[m/s] --auto-align-init --out tuned-model.json
node ~/.dual-agent/comsol.cjs build-model --spec tuned-model.json --out MicrochannelCHT.java

# 2. 一体化静态审计
node ~/.dual-agent/comsol.cjs audit-model --source MicrochannelCHT.java

# 3. 编译并运行批处理求解（失败时自动触发 Codex 闭环修复）
node ~/.dual-agent/comsol.cjs compile-java --source MicrochannelCHT.java --auto-fix
node ~/.dual-agent/comsol.cjs run-batch --input MicrochannelCHT.class --output MicrochannelCHT_solved.mph --auto-fix
```
