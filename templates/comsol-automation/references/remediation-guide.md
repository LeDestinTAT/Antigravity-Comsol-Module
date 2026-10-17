# COMSOL 6.2 Error Diagnostics, Remediation & Closed-Loop Auto-Fix

This reference details the failure signal classification, error taxonomy, exit codes, and closed-loop remediation procedures used by `comsol.cjs` and the Dual-Agent Bridge.

---

## 1. CLI Exit Codes

| Exit Code | Classification | Meaning | Action Required |
| :---: | :--- | :--- | :--- |
| `0` | `SUCCESS` / `COMPLETED` | Operation succeeded cleanly. | Proceed to next stage in pipeline. |
| `1` | `USAGE_OR_FILE_ERROR` | Missing CLI arguments, non-existent files, or syntax/eval failure. | Verify CLI arguments, flags, and file paths. |
| `2` | `DOMAIN_OR_SOLVER_ERROR` | Model validation failed, `comsolcompile` failed, solver non-convergence, or scientific integrity violation. | Inspect JSON error log; trigger `--auto-fix` or apply `patch.json`. |
| `5` | `RETRY_LIMIT_EXCEEDED` | Auto-fix retries exceeded maximum allowable limit (3 retries). | Escalate to user or trigger architectural refactor. |
| `6` | `ESCALATION_LIMIT_EXCEEDED`| Technical escalation rounds exceeded limit (2 rounds). | Escalate to user. |
| `7` | `FALLBACK_TO_GEMINI` | Codex encountered quota exhaustion or rate limits. | Gemini immediately takes over coding and fixing directly. |

---

## 2. Failure Classification & Remediation Taxonomy

When `parse-log`, `compile-java`, or `run-batch` detects an issue, it classifies the error into one of six categories:

### 1. `COMPILE_ERROR`
- **Signals**: `cannot find symbol`, `incompatible types`, `package com.comsol.model does not exist`, `exit 1` from `comsolcompile`.
- **Causes**: Missing imports (`import com.comsol.model.*;`), mismatch between class name and `.java` file name, obsolete API calls (e.g. `.geom().add()` instead of `.geom().create()`), or passing scalar strings to vector properties (e.g. `FperArea`).
- **Remediation**:
  - Run `node ~/.dual-agent/comsol.cjs audit-model --source <Model.java>` to locate syntax/API errors before compilation.
  - Ensure all vector properties use `new String[]{"Fx", "Fy", "Fz"}`.

### 2. `GEOMETRY_ERROR`
- **Signals**: `internal error in geometry engine`, `boolean difference resulted in empty entity`, `face not found`, `non-manifold topology`.
- **Causes**: Over-subtraction (difference tool completely swallowed base volume), disjoint subtraction (tool does not intersect base), zero-thickness sliver faces, or 2D sketch primitive instantiated in 3D without `WorkPlane`.
- **Remediation**:
  - Run `node ~/.dual-agent/comsol.cjs validate-geometry --spec <spec.json>` to check AABB bounding box overlaps before generating geometry.
  - Replace hardcoded entity indexes with `FaceBox` or `Box` coordinate selections.

### 3. `MESH_ERROR`
- **Signals**: `failed to generate mesh`, `edge too short`, `inverted mesh elements`, `sliver face detected`.
- **Causes**: Micro-gaps caused by non-aligned boolean boundaries or inappropriate element sizing.
- **Remediation**:
  - Adjust `autoMeshSize(3..6)` (1=extremely fine, 5=normal, 9=extremely coarse).
  - Add geometry repair tolerance: `geom.feature("fin").set("repairtol", "1e-5[m]");` before meshing.

### 4. `PARAMETER_ERROR`
- **Signals**: `undefined variable`, `syntax error in expression`, `unknown model parameter`, `inconsistent units`.
- **Causes**: Typo in parameter name, missing unit bracket (e.g. `10mm` instead of `10[mm]`), or referencing variable before definition.
- **Remediation**:
  - Inspect `model.param().set(name, expr)` definitions.
  - In multiphysics models, qualify variable scopes where ambiguous (e.g., `comp1.ht.T`).

### 5. `SOLVER_NONCONVERGENCE`
- **Signals**: `singular matrix`, `nonlinear solver did not converge`, `maximum number of newton iterations reached`, `undefined value found (NaN)`.
- **Causes**: Unconstrained stationary PDE (e.g., zero Dirichlet boundaries in Heat Transfer, Solid Mechanics, Acoustics, Wave Optics, or Electromagnetics), highly non-linear initial state, or zero fluid density/viscosity.
- **Remediation Across Multiphysics Domains**:
  - **Mechanics & Fluid**: Ensure `Fixed`/`PrescribedDisplacement` on solid structures; ensure `OutletBoundary` (or `PressurePointConstraint`) + `InletBoundary` on fluid domains.
  - **Thermal**: Ensure at least one `TemperatureBoundary` or `ConvectiveHeatFlux` with ambient reference $T_{\text{ext}}$.
  - **Acoustics**: Ensure domain enclosure has `SoundHardWall`, `Pressure`, `NormalAcceleration`, or absorbing `RadiationCondition`/`Impedance`.
  - **Wave Optics & RF**: Ensure bounded cavity has `PerfectElectricConductor`/`PerfectMagneticConductor`, or open boundaries use `ScatteringBoundaryCondition` / `Port`.
  - **Electromagnetics**: Ensure electrostatic/current domains have a reference `Ground` or `ElectricPotential`; ensure magnetic domains have `MagneticInsulation` or `MagneticPotential`.
  - Run `tune-model --auto-align-init` to align initial field values with boundary conditions.
  - Add auxiliary continuation study ramp (e.g., ramping inlet velocity or electric drive voltage).

### 6. `SCIENTIFIC_INTEGRITY_VIOLATION`
- **Signals**: `scientific integrity violation`, `unphysical gain detected`, `violation of energy conservation`, `passivity violation`, `unphysical negative dissipation`.
- **Causes**: Passive device showing net amplification, outgoing thermal/Poynting flux exceeding incoming flux without internal source, or critical resonance peak truncated at sweep boundary.
- **Remediation**:
  - Verify boundary fluxes balance internal generation/dissipation ($\int_{\partial \Omega} \mathbf{q} \cdot \mathbf{n} \, dA = \int_\Omega Q \, dV$).
  - Expand parameter sweep bounds to capture true resonance roll-off without boundary clipping.

---

## 3. Dual-Agent Closed-Loop Auto-Fix Procedure

When `compile-java --auto-fix` or `run-batch --auto-fix` is invoked:
1. `parseComsolLog` compacts error output into a concise summary ($\le 800$ characters).
2. `buildCodexFixPrompt` formats an actionable auto-fix task.
3. `delegateFixToDualAgent` invokes `client.cjs` with `--mode write --task-type FIX_REQUEST --retry-count <N> --reuse-session`.
4. If Codex exits `0` with status `IMPLEMENTATION_COMPLETE`:
   - System re-runs compile or batch solve.
5. If Codex exits `7` (`FALLBACK_TO_GEMINI`):
   - Gemini immediately takes over the fix directly without blocking the user.
