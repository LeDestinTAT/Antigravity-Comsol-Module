---
name: comsol-automation
description: >-
  Automate COMSOL 6.2 precision geometry generation, physics understanding & tuning,
  Java/MPh model compilation, batch solving, and closed-loop auto-fix with the Dual-Agent Bridge.
  Use this skill whenever the user asks to create, validate, tune, compile, or solve COMSOL Multiphysics
  models, troubleshoot simulation non-convergence or singular matrices, generate COMSOL Java API scripts,
  or run automated COMSOL batch workflows.
---

# COMSOL 6.2 Add-On (`~/.dual-agent/comsol.cjs`)

The `comsol-automation` skill equips the agent to perform end-to-end COMSOL 6.2 modeling, verification, solving, and automated debugging through the Global Dual-Agent Bridge (`~/.dual-agent/client.cjs`).

- **Architecture**: Operates as a dual-agent add-on (`merged-dual-agent` when `client.cjs` is present, or `standalone` fallback).
- **Core Submodules**:
  - `comsol-geometry.cjs`: AABB unit-expression evaluator, boolean overlap verification, and coordinate-based selection engine (`FaceBox`/`Box`).
  - `comsol-physics.cjs`: Multiphysics PDE well-posedness validator, boundary constraint checker, and declarative tuning engine.
  - `comsol-templates.cjs`: Verified Java API & Python MPh scaffolds and remediation taxonomy.
  - `comsol.cjs`: Unified CLI runner, compiler, batch solver, log parser, and Codex auto-fix orchestrator.
- **Reference Docs & Examples**:
  - [JSON Spec & Patch Schema](./references/spec-schema.md)
  - [Error Diagnostics & Auto-Fix Remediation Guide](./references/remediation-guide.md)
  - [Example Conjugate Heat Transfer Spec](./examples/conjugate-heat-microchannel.spec.json)
  - [Example Acoustic Cavity Spec (Acoustics)](./examples/acoustic-cavity.spec.json)
  - [Example Optical Waveguide Spec (Wave Optics)](./examples/optical-waveguide.spec.json)
  - [Example Piezoelectric Transducer Spec (Piezoelectricity)](./examples/piezoelectric-transducer.spec.json)
  - [Example Physics Tuning Patch](./examples/tuning-patch.json)

---

## Standard Operating Procedures (SOPs)

### SOP 1: Declarative Multiphysics Modeling (End-to-End Pipeline)
1. **Prepare Spec**: Draft a declarative `spec.json` (or pick a built-in `--preset`) matching the [Spec Schema](./references/spec-schema.md).
2. **Pre-Validation**: Validate geometry bounds and physics well-posedness without starting COMSOL:
   ```powershell
   node .agents/skills/comsol-automation/scripts/comsol.cjs validate-model --spec <spec.json>
   # or globally: node ~/.dual-agent/comsol.cjs validate-model --spec <spec.json>
   ```
3. **Build Java Source**: Generate verified COMSOL 6.2 Java code:
   ```powershell
   node .agents/skills/comsol-automation/scripts/comsol.cjs build-model --spec <spec.json> --out <Model.java>
   ```
4. **Audit Source Code**: Audit the Java file against COMSOL 6.2 anti-hallucination rules:
   ```powershell
   node .agents/skills/comsol-automation/scripts/comsol.cjs audit-model --source <Model.java>
   ```
5. **Compile to Class**: Compile with `comsolcompile.exe`:
   ```powershell
   node .agents/skills/comsol-automation/scripts/comsol.cjs compile-java --source <Model.java> [--auto-fix]
   ```
6. **Execute Batch Solve**: Run `comsolbatch.exe` and produce `.mph` solution:
   ```powershell
   node .agents/skills/comsol-automation/scripts/comsol.cjs run-batch --input <Model.class> --output <out.mph> [--study <std1>] [--auto-fix]
   ```

### SOP 2: Closed-Loop Auto-Fix via Dual-Agent Bridge or Standalone Diagnostics
When `compile-java` or `run-batch` fails:
1. `comsol.cjs` automatically parses the failure log with `parseComsolLog`, extracting signals (e.g. `MESH_ERROR`, `SOLVER_NONCONVERGENCE`, `SCIENTIFIC_INTEGRITY_VIOLATION`).
2. If `--auto-fix` is enabled:
   - **Dual-Agent Mode**: Dispatches an automated fix request to Codex via `client.cjs submit --task-type FIX_REQUEST`. If Codex exits `7` (`FALLBACK_TO_GEMINI`), Gemini immediately takes over the fix directly.
   - **Standalone Mode**: Emits structured diagnostic insights and precise remediation prompts without requiring external bridges or agents.
3. Consult the remediation hints in [Remediation Guide](./references/remediation-guide.md).
   - Apply corrections to boundary constraints, mesh repair tolerances, or initial values.
   - Re-run `compile-java` or `run-batch`.

### SOP 3: Physics Tuning & Parametric Continuation
To resolve non-convergence or perform parametric studies:
1. Apply a patch JSON containing updated parameters, boundary conditions, or continuation ramps:
   ```powershell
   node .agents/skills/comsol-automation/scripts/comsol.cjs tune-model --spec <spec.json> --patch <patch.json> --auto-align-init --out <tuned.json>
   ```
2. Re-build and solve the updated model with continuation parameters enabled.

### SOP 4: Python MPh Automation
For post-processing, parameter extraction, or rapid model inspection without compiling Java:
1. Verify Python mph availability via:
   ```powershell
   node .agents/skills/comsol-automation/scripts/comsol.cjs doctor --check-python
   ```
2. Generate Python MPh runner:
   ```powershell
   node .agents/skills/comsol-automation/scripts/comsol.cjs template --domain mph-python
   ```

---

## COMSOL 6.2 Anti-Hallucination Rules

1. **Boolean & Extrude Inputs**:
   - Always use `.selection("input").set(new String[]{...})` (and `.selection("input2").set(...)` for `Difference`). Never use `.set("input", ...)`.
2. **2D Primitives in 3D**:
   - Never instantiate `Rectangle` or `Circle` directly on a 3D geometry sequence. Always wrap inside a `WorkPlane` (`geom.feature("wp1").geom().create("r1", "Rectangle")`) followed by `Extrude` or `Revolve`.
3. **Coordinate-Based Boundary Selections**:
   - COMSOL 6.2 renumbers entity indices after booleans. Never hardcode boundary IDs (`new int[]{1}`). Use `Box` or `FaceBox` coordinate selections (`xmin/xmax/ymin/ymax/zmin/zmax`) with `condition: "allvertices"` or `"somevertices"`.
4. **Mandatory Dirichlet Reference Constraints (Multiphysics Domain Coverage)**:
   - Every stationary PDE interface requires at least one reference constraint to prevent singular matrices:
     - **Mechanics & Fluid**: `SolidMechanics` (`Fixed`, `PrescribedDisplacement`, `Roller`, `Symmetry`); `LaminarFlow` (`OutletBoundary` / `PressurePointConstraint` + `InletBoundary` / `MovingWall`).
     - **Thermal**: `HeatTransfer` (`TemperatureBoundary`, `ConvectiveHeatFlux`, `DiffuseSurface`, `ThermalInsulation`).
     - **Acoustics**: `PressureAcoustics` (`SoundHardWall`, `SoundSoftWall`, `Pressure`, `NormalAcceleration`, `NormalVelocity`, `Impedance`, `RadiationCondition`).
     - **Wave Optics & RF**: `ElectromagneticWavesFrequencyDomain` / `WaveOptics` (`PerfectElectricConductor`, `PerfectMagneticConductor`, `Port`, `ScatteringBoundaryCondition`, `ElectricField`, `MagneticField`).
     - **Electromagnetics**: `Electrostatics` / `ElectricCurrents` (`Ground`, `ElectricPotential`, `NormalCurrentDensity`); `MagneticFields` (`MagneticInsulation`, `MagneticPotential`, `SurfaceCurrent`).
5. **Vector vs. Scalar Properties**:
   - Loads and vector fields (`FperArea`, `Ftot`, `FperVol`, `u0`, `u_wall`, `thermalconductivity`) must be passed as `new String[]{"Fx", "Fy", "Fz"}`. Scalar `String` causes compilation failure.
6. **Material Property Groups**:
   - Always set properties via `material.propertyGroup("def").set("<prop>", ...)`, not directly on `material.set(...)`.
7. **Multiphysics Couplings**:
   - Create couplings via `model.component("comp1").multiphysics().create(tag, type, 3)` and explicitly bind interfaces via `.set("Fluid_physics", ...)` / `.set("HeatTransfer_physics", ...)` and `.selection().all()`.
8. **Scientific Integrity**:
   - Enforce passivity and conservation of energy. If integrated boundary fluxes do not balance domain sources, `parseComsolLog` flags `SCIENTIFIC_INTEGRITY_VIOLATION`.

---

## Complete CLI Reference

Commands can be invoked directly from the skill folder (Standalone) or globally via Dual-Agent Bridge:
- **Standalone**: `node <skill-path>/scripts/comsol.cjs <command>` (e.g. `node .agents/skills/comsol-automation/scripts/comsol.cjs <command>`)
- **Dual-Agent**: `node ~/.dual-agent/comsol.cjs <command>`

### 1. Diagnostics & Exploration
- `doctor [--check-python]`: Check COMSOL installation, bin paths, MPh, and Dual-Agent Bridge.
- `list-presets`: List all unified geometry and physics presets.
- `list-templates`: List available Java and Python MPh domain templates.
- `list-geometry-presets` / `list-physics-presets`: List sub-module presets.

### 2. Unified Model Pipeline
- `validate-model (--spec <file> | --preset <name>)`: Validate geometry AABB bounds & physics constraints.
- `tune-model (--spec <file> | --preset <name>) [--patch <patch.json>] [--auto-align-init] [--out <tuned.json>]`: Adjust parameters/boundaries/studies.
- `build-model (--spec <file> | --preset <name>) [--patch <patch.json>] [--out <Model.java>] [--class <Name>]`: Generate complete COMSOL 6.2 Java file.
- `audit-model --source <Model.java>`: Audit Java source for anti-hallucination compliance.

### 3. Compilation & Batch Solving
- `scaffold-java --domain <heat-transfer|fluid-flow|solid-mechanics> [--out <Model.java>]`: Generate template code.
- `validate-java --source <Model.java>`: Check Java class name and imports.
- `compile-java --source <Model.java> [--auto-fix] [--project <dir>]`: Compile `.java` to `.class` via `comsolcompile.exe`.
- `run-batch --input <model.mph|Model.class> [--output <out.mph>] [--study <std>] [--param k=v ...] [--auto-fix]`: Execute batch simulation via `comsolbatch.exe`.
- `parse-log --log <run.log>`: Parse COMSOL batch log and extract diagnostic signal summary.
