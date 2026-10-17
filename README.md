# Antigravity COMSOL 6.2 Add-On Module (Private / WIP)

面向 [`Antigravity-Codex-Workspace`](https://github.com/LeDestinTAT/Antigravity-Codex-Workspace) 的 **COMSOL Multiphysics 6.2 自动化附加模块（Add-On）**。

参考开源社区成熟方案（`COMSOL_Multiphysics_MCP`、`mph-agent`、`2p1c/comsol-skills` 与 `MPh`），并针对大模型最容易出错的 **COMSOL 6.2 几何建模与边界选择（Selection）** 专门内置了精准几何辅助引擎（`global/comsol-geometry.cjs`）。

## 核心特性

1. **COMSOL 6.2 精准几何建模与拓扑校验引擎（`global/comsol-geometry.cjs`）**
   - **三维包围盒（AABB）与布尔运算预检**：支持解析 COMSOL 参数与单位表达式（如 `10[mm]`、`500[um]`），在调用 COMSOL 前直接计算所有几何特征的真实空间包围盒，自动拦截“布尔差集（`Difference`）工具体与目标体不相交”、“差集工具体完全吞没目标体”以及会导致网格畸变（`Inverted mesh element`）的微米级缝隙（Sliver / Micro-gap）。
   - **零硬编码面编号（Coordinate `FaceBox` & `selresult`）**：彻底摒弃在布尔/阵列操作后极易错位的 `selection().set(new int[]{1, 3})` 硬编码面序号，自动根据特征包围盒生成精确的坐标包围盒选择集（`Box` Selection：`xmin/xmax/ymin/ymax/zmin/zmax`）与特征选择集（`selresult = true`）。
   - **COMSOL 6.2 Java 几何源码审计（`audit-geometry`）**：自动拦截在 3D 几何序列下直接创建 2D `Rectangle`/`Circle`（未包裹在 `WorkPlane` 中）、误用 `.set("input", ...)` 替代 `.selection("input").set(...)`、以及 `Difference` 漏设 `input2` 等高频错误。
2. **插件式附加架构（Add-On & Standalone 双模）**
   - **附加模式（`merged-dual-agent`）**：挂载至主框架 `~/.dual-agent/addons/registry.json` 与 `~/.dual-agent/comsol.cjs`。当编译或求解失败时，传入 `--auto-fix` 会自动携带精简日志（`<= 800` 字符）与物理场修复提示（`Hint`）调用 `~/.dual-agent/client.cjs` 交由 Codex 闭环修复。
   - **独立模式（`standalone`）**：在未安装主桥接器的电脑上亦可单独安装并完成几何生成、编译、批处理与日志诊断。

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

```powershell
# 1. 查看内置的精准几何预设（微通道散热器 microchannel-heatsink / 同轴核壳圆柱 core-shell-cylinder）
node ~/.dual-agent/comsol.cjs list-geometry-presets

# 2. 将声明式几何 JSON 或内置预设编译为 COMSOL 6.2 精准 Java 几何源码（自动生成 FaceBox 坐标选择集）
node ~/.dual-agent/comsol.cjs build-geometry --preset microchannel-heatsink --out MicrochannelSink.java

# 3. 审计任意 COMSOL 6.2 Java 源码中的几何与 API 错误
node ~/.dual-agent/comsol.cjs audit-geometry --source MicrochannelSink.java

# 4. 从零生成 3D 物理场模板、编译并运行批处理求解（失败时自动触发 Codex 修复）
node ~/.dual-agent/comsol.cjs scaffold-java --domain heat-transfer --out HeatSink.java
node ~/.dual-agent/comsol.cjs compile-java --source HeatSink.java --auto-fix
node ~/.dual-agent/comsol.cjs run-batch --input HeatSink.class --output HeatSink_solved.mph --auto-fix
```
