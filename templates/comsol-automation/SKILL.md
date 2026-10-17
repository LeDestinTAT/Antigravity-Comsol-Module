---
name: comsol-automation
description: Automate COMSOL 6.2 precision geometry generation, Java/MPh model compilation, batch solving, and closed-loop auto-fix with the Dual-Agent Bridge.
---

# COMSOL 6.2 Add-On (`~/.dual-agent/comsol.cjs`)

- **Architecture**: Attaches to `~/.dual-agent` as an add-on (`merged-dual-agent` when `client.cjs` is present, or `standalone` when installed alone).
- **COMSOL 6.2 Precision Geometry Engine (`comsol-geometry.cjs`)**:
  - Evaluates COMSOL unit expressions (`10[mm]`, `500[um]`) into 3D bounding boxes (`AABB`) before running COMSOL.
  - Verifies boolean `Difference`/`Union`/`Intersection` overlap (prevents disjoint subtraction, complete target erasure, and micro-gap sliver faces).
  - Replaces fragile hardcoded face IDs (`new int[]{1}`) with coordinate-based `Box` / `FaceBox` selections (`xmin/xmax/ymin/ymax/zmin/zmax`) and `set("selresult", true)`.

## COMSOL 6.2 Anti-Hallucination Rules

- **Boolean & Extrude Inputs**: Always use `geom.feature(tag).selection("input").set(new String[]{...})` (and `.selection("input2").set(...)` for `"Difference"`). Never use `.set("input", ...)`.
- **2D Sketching in 3D**: Never create `"Rectangle"` or `"Circle"` directly on a 3D geometry; wrap inside `"WorkPlane"` (`geom.feature("wp1").geom().create("r1", "Rectangle")`) followed by `"Extrude"` or `"Revolve"`.
- **Boundary Selections**: After booleans/arrays, COMSOL 6.2 renumbers boundaries. Always use `Box` selections (`model.component("comp1").selection().create(tag, "Box")`) and `.selection().named(tag)`.

## CLI Commands (`node ~/.dual-agent/comsol.cjs`)

1. `doctor [--check-python]` | `list-templates` | `list-geometry-presets`
2. **Precision Geometry**:
   - `validate-geometry --spec <spec.json> | --preset <microchannel-heatsink|core-shell-cylinder>`
   - `build-geometry (--spec <spec.json> | --preset <name>) [--out <GeomModel.java>] [--class <Name>]`
   - `audit-geometry --source <Model.java>`
3. **Model Compile & Solve**:
   - `scaffold-java --domain <heat-transfer|fluid-flow|solid-mechanics> --out <Model.java>`
   - `validate-java --source <Model.java>` | `compile-java --source <Model.java> [--auto-fix] [--project <dir>]`
   - `run-batch --input <model.mph|Model.class> [--output <out.mph>] [--study <std1>] [--param k=v ...] [--dry-run] [--auto-fix] [--project <dir>]`
   - `parse-log --log <run.log>`
