# Antigravity COMSOL Add-On Module (Private / WIP)

面向 [`Antigravity-Codex-Workspace`](https://github.com/LeDestinTAT/Antigravity-Codex-Workspace) 的 **COMSOL Multiphysics 自动化附加模块（Add-On）**。

参考开源社区成熟方案（`COMSOL_Multiphysics_MCP`、`mph-agent`、`2p1c/comsol-skills` 与 `MPh`），本模块不仅支持对已有 `.mph` 文件的参数扫描与批处理求解，还内置了**防幻觉 COMSOL Java API 模板库**、**编译前静态语法校验**、**`comsolcompile` 从零建模流水线**、**Python `MPh` 表达式求值模板**以及**领域级报错修复提示（Remediation Hints）**。

## 核心特性

1. **插件式附加架构（Add-On & Standalone 双模）**
   - **附加模式（`merged-dual-agent`）**：挂载至主框架 `~/.dual-agent/addons/registry.json` 与 `~/.dual-agent/comsol.cjs`。当编译或求解失败时，传入 `--auto-fix` 会自动携带精简日志（`<= 800` 字符）与物理场修复提示（`Hint`）调用 `~/.dual-agent/client.cjs` 交由 Codex 闭环修复。
   - **独立模式（`standalone`）**：在未安装主桥接器的电脑上亦可单独安装并完成建模编译、批处理与日志诊断。
2. **三条全周期执行流水线**
   - **Java API 从零建模（零 Python 依赖）**：`scaffold-java` 生成标准模板 -> `validate-java` 静态拦截 `.add()` 等常见大模型 API 幻觉 -> `compile-java` 调用 `comsolcompile.exe` 编译为 `.class` -> `run-batch` 生成并求解 `.mph` 并导出 CSV 数据。
   - **已有 `.mph` 批处理与参数扫描**：`run-batch --input model.mph --param k=v ...`
   - **Python `MPh` 模型树检索与后处理求值**：通过 `template --domain mph-python` 导出标准 `mph` 脚本，支持读取模型树与 `model.evaluate()` 数值提取。

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
# 查看内置的防幻觉物理场模板（heat-transfer / fluid-flow / solid-mechanics / mph-python）
node ~/.dual-agent/comsol.cjs list-templates

# 从零生成 3D 传热 Java 建模源码并执行静态校验与编译
node ~/.dual-agent/comsol.cjs scaffold-java --domain heat-transfer --out HeatSink.java
node ~/.dual-agent/comsol.cjs compile-java --source HeatSink.java --auto-fix

# 运行批处理求解（支持 .mph 或编译后的 .class），失败时自动触发 Codex 修复
node ~/.dual-agent/comsol.cjs run-batch --input HeatSink.class --output HeatSink_solved.mph --auto-fix

# 单独解析 COMSOL 求解器日志并获取修复建议
node ~/.dual-agent/comsol.cjs parse-log --log batch.log
```
