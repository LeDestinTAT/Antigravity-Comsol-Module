---
name: comsol-automation
description: Automate COMSOL 6.2 precision geometry generation, physics understanding & tuning, Java/MPh model compilation, batch solving, and closed-loop auto-fix with the Dual-Agent Bridge.
---

# COMSOL 6.2 Add-On (`~/.dual-agent/comsol.cjs`)

- **Architecture**: Attaches to `~/.dual-agent` as an add-on (`merged-dual-agent` when `client.cjs` is present, or `standalone` when installed alone).
- **COMSOL 6.2 Precision Geometry Engine (`comsol-geometry.cjs`)**:
  - Evaluates COMSOL unit expressions (`10[mm]`, `500[um]`) into 3D bounding boxes (`AABB`) before running COMSOL.
  - Verifies boolean `Difference`/`Union`/`Intersection` overlap (prevents disjoint subtraction, complete target erasure, and micro-gap sliver faces).
  - Replaces fragile hardcoded face IDs (`new int[]{1}`) with coordinate-based `Box` / `FaceBox` selections (`xmin/xmax/ymin/ymax/zmin/zmax`) and `set("selresult", true)`.
- **COMSOL 6.2 Physics Understanding & Tuning Engine (`comsol-physics.cjs`)**:
  - Understands PDE governing equations, dependent variables (`T`, `u/p`, `u_solid`, `V`), boundary conditions, initial values, constraints, and multiphysics couplings (`NonIsothermalFlow`, `ThermalExpansion`, `ElectromagneticHeating`, `FluidStructureInteraction`).
  - Validates well-posedness (catches unconstrained stationary PDEs causing `Singular matrix`, conflicting Dirichlet boundaries, dimension mismatches, and missing coupled material properties).
  - Supports targeted tuning (`tune-physics`) of initial values, boundary overrides, couplings, and continuation study ramps.

## COMSOL 6.2 Anti-Hallucination Rules

- **Boolean & Extrude Inputs**: Always use `geom.feature(tag).selection("input").set(new String[]{...})` (and `.selection("input2").set(...)` for `"Difference"`). Never use `.set("input", ...)`.
- **2D Sketching in 3D**: Never create `"Rectangle"` or `"Circle"` directly on a 3D geometry; wrap inside `"WorkPlane"` (`geom.feature("wp1").geom().create("r1", "Rectangle")`) followed by `"Extrude"` or `"Revolve"`.
- **Boundary Selections**: After booleans/arrays, COMSOL 6.2 renumbers boundaries. Always use `Box` selections (`model.component("comp1").selection().create(tag, "Box")`) and `.selection().named(tag)`.
- **Physics & Couplings**:
  - Every `Stationary` physics interface requires at least one reference constraint (`Fixed` for `SolidMechanics`, `Temperature1`/`ConvectiveHeatFlux` for `HeatTransfer`, `ElectricPotential`/`Ground` for `ElectricCurrents`/`Electrostatics`, `Outlet` for `LaminarFlow`).
  - `BoundaryLoad` (`FperArea`) and `BodyLoad` (`FperVol`) in 3D `SolidMechanics` require a 3-component vector `new String[]{"Fx", "Fy", "Fz"}`.
  - Multiphysics couplings require `model.component("comp1").multiphysics().create(tag, type, 3)` followed by `.set(" HeatTransfer_physics", ...)` / `.set("Fluid_physics", ...)` and `.selection().all()`.

## CLI Commands (`node ~/.dual-agent/comsol.cjs`)

1. `doctor [--check-python]` | `list-templates` | `list-geometry-presets` | `list-physics-presets`
2. **Precision Geometry**:
   - `validate-geometry --spec <spec.json> | --preset <microchannel-heatsink|core-shell-cylinder>`
   - `build-geometry (--spec <spec.json> | --preset <name>) [--out <GeomModel.java>] [--class <Name>]`
   - `audit-geometry --source <Model.java>`
3. **Physics Understanding & Tuning**:
   - `validate-physics --spec <spec.json> | --preset <conjugate-heat-microchannel|thermo-mechanical-bracket|joule-heating-busbar>`
   - `tune-physics (--spec <spec.json> | --preset <name>) --patch <patch.json> [--out <tuned.json>]`
   - `build-physics (--spec <spec.json> | --preset <name>) [--patch <patch.json>] [--out <PhysicsModel.java>] [--class <Name>]`
   - `audit-physics --source <Model.java>`
4. **Model Compile & Solve**:
   - `scaffold-java --domain <heat-transfer|fluid-flow|solid-mechanics> --out <Model.java>`
   - `validate-java --source <Model.java>` | `compile-java --source <Model.java> [--auto-fix] [--project <dir>]`
   - `run-batch --input <model.mph|Model.class> [--output <out.mph>] [--study <std1>] [--param k=v ...] [--dry-run] [--auto-fix] [--project <dir>]`
   - `parse-log --log <run.log>`
