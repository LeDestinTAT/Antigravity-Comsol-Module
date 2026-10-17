---
name: comsol-automation
description: Automate COMSOL Multiphysics batch simulations, parameter sweeps, and solver log diagnostics (standalone or merged with Dual-Agent Codex Bridge).
---

# COMSOL Multiphysics Automation (`~/.dual-agent/comsol.cjs`)

- **Modes**:
  - **Standalone**: Runs COMSOL batch jobs (`comsolbatch.exe`), parameter sweeps (`-pname`/`-plist`), `--dry-run` validation (when COMSOL is uninstalled), and structured solver log classification (`COMPLETED`, `MESH_ERROR`, `SOLVER_NONCONVERGENCE`, `PARAMETER_ERROR`).
  - **Merged (`merged-dual-agent`)**: When installed alongside Dual-Agent Bridge (`~/.dual-agent/client.cjs`), passing `--auto-fix` on mesh/solver/parameter failures automatically delegates a compact (`<=800` char log excerpt) `FIX_REQUEST` to Codex.

## CLI Commands

1. **Check Environment**: `node ~/.dual-agent/comsol.cjs doctor [--comsol-root <dir>]`
   - Reports `installed`, `version`, `binaries.comsolbatch`, `readyMode` (`comsolbatch` | `dry-run-only`), and `dualAgentBridge.integrationMode` (`standalone` | `merged-dual-agent`).
2. **Run Batch Simulation**:
   `node ~/.dual-agent/comsol.cjs run-batch --input <model.mph> [--output <out.mph>] [--study <std1>] [--param key=val ...] [--batch-log <run.log>] [--dry-run] [--auto-fix] [--project <dir>]`
   - Exits `0` on `COMPLETED` or `DRY_RUN`; exits `2` on `MESH_ERROR`, `SOLVER_NONCONVERGENCE`, `PARAMETER_ERROR`, or `UNKNOWN_ERROR`.
3. **Parse Solver Log**: `node ~/.dual-agent/comsol.cjs parse-log --log <run.log>`
