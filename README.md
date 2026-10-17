# Antigravity COMSOL Automation Module (WIP / Private)

独立的 COMSOL Multiphysics 批处理与日志诊断模块。设计为**可独立安装运行**，也可与 [`Antigravity-Codex-Workspace`](https://github.com/LeDestinTAT/Antigravity-Codex-Workspace) **合并安装并联动运行**（无文件命名冲突）。

## 目录结构（零冲突设计）

```text
├── deploy-comsol.cjs                   # COMSOL 模块独立安装与诊断入口（不与核心 deploy.cjs 冲突）
├── global/
│   └── comsol.cjs                      # COMSOL 批处理驱动与日志解析核心（部署至 ~/.dual-agent/comsol.cjs）
├── templates/
│   └── comsol-automation/
│       └── SKILL.md                    # 独立技能文件（部署至 ~/.gemini/config/skills/comsol-automation/SKILL.md）
└── test/
    └── comsol-module.test.cjs          # 独立安装、合并联动与日志解析测试套件
```

## 安装方式

### 方式一：仅独立安装本模块（无需安装双智能体桥接器）

```powershell
node deploy-comsol.cjs install
node deploy-comsol.cjs doctor
```

- 自动检测本机 COMSOL 安装路径（支持环境变量 `COMSOL_ROOT` 或 `C:\Program Files\COMSOL\COMSOL*`、`D:\Program Files\COMSOL\COMSOL*` 等默认路径）。
- 若当前机器尚未安装 COMSOL，自动进入 `dry-run-only` 调试模式。

### 方式二：与 `Antigravity-Codex-Workspace` 合并运行

无论是**分别在两个目录先后执行安装**，还是**将本仓库文件直接合并复制到 `Antigravity-Codex-Workspace` 目录中**：

```powershell
# 若已合并至同一目录，可一键同时安装核心桥接器与 COMSOL 模块：
node deploy-comsol.cjs install --with-core

# 或先后独立安装（顺序任意，互不覆盖）：
node deploy.cjs install
node deploy-comsol.cjs install
```

合并后，`comsol.cjs doctor` 会自动识别 `integrationMode: "merged-dual-agent"`。当仿真出现网格错误（`MESH_ERROR`）、求解器不收敛（`SOLVER_NONCONVERGENCE`）或参数错误（`PARAMETER_ERROR`）时，传入 `--auto-fix` 即可自动将精简后的错误日志片段（`<= 800` 字符）通过 `~/.dual-agent/client.cjs` 派发给 Codex 进行修复。

## 常用命令

```powershell
# 1. 环境与合并状态自检
node ~/.dual-agent/comsol.cjs doctor

# 2. 执行批处理仿真（未安装 COMSOL 时自动或通过 --dry-run 预览参数）
node ~/.dual-agent/comsol.cjs run-batch --input model.mph --output out.mph --study std1 --param width=120[um] --param vel=0.8[m/s]

# 3. 批处理失败时自动联动 Codex 修复（合并模式下生效）
node ~/.dual-agent/comsol.cjs run-batch --input model.mph --study std1 --auto-fix --project .

# 4. 单独解析 COMSOL 日志文件
node ~/.dual-agent/comsol.cjs parse-log --log batch.log
```
