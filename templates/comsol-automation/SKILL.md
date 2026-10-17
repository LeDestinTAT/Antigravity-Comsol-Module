---
name: comsol-automation
description: Automate COMSOL Multiphysics model generation (Java API & Python MPh), batch solving, and closed-loop auto-fix with the Dual-Agent Bridge.
---

# COMSOL Multiphysics Add-On (`~/.dual-agent/comsol.cjs`)

- **Architecture**: Attaches to `~/.dual-agent` as an add-on (`merged-dual-agent` when `client.cjs` is present, or `standalone` when installed alone).
- **3 Execution Pipelines**:
  1. **From-Scratch Model Generation (`Java API`)**: `scaffold-java` -> `validate-java` -> `compile-java` (`comsolcompile.exe`) -> `run-batch` (`comsolbatch.exe -inputfile Model.class -outputfile solved.mph`). Zero Python dependency required.
  2. **Existing `.mph` Batch & Parameter Sweep**: `run-batch --input model.mph --param k=v ...`
  3. **Python `MPh` Inspection & Expression Evaluation**: Use `template --domain mph-python` when Python `mph` is installed.

## Verified COMSOL Java API Rules (Anti-Hallucination)

- Always include `import com.comsol.model.*;` and `import com.comsol.model.util.*;` and initialize via `Model model = ModelUtil.create("Model");`.
- Use `.create(tag, type)` (never `.add()`):
  - Component & 3D Geom: `model.component().create("comp1", true); model.component("comp1").geom().create("geom1", 3);`
  - Physics: `model.component("comp1").physics().create("ht", "HeatTransfer", "geom1");` (or `"LaminarFlow"`, `"SolidMechanics"`, `"Electrostatics"`).
  - Mesh & Study: `model.component("comp1").mesh().create("mesh1"); model.study().create("std1"); model.study("std1").create("stat", "Stationary");`
  - Vector properties (`size`, `FperArea`, `thermalconductivity`) require `new String[]{...}`; boundary selections require `.selection().set(new int[]{...})`.

## CLI Commands (`node ~/.dual-agent/comsol.cjs`)

1. `doctor [--check-python]`: Detects COMSOL binaries, Python `mph`, and Dual-Agent attachment state.
2. `list-templates` | `template --domain <heat-transfer|fluid-flow|solid-mechanics|mph-python>`
3. `scaffold-java --domain <domain> --out <Model.java> [--class <ClassName>]`
4. `validate-java --source <Model.java>` | `compile-java --source <Model.java> [--auto-fix] [--project <dir>]`
5. `run-batch --input <model.mph|Model.class> [--output <out.mph>] [--study <std1>] [--param k=v ...] [--batch-log <run.log>] [--dry-run] [--auto-fix] [--project <dir>]`
6. `parse-log --log <run.log>`: Classifies `COMPLETED`, `GEOMETRY_ERROR`, `MESH_ERROR`, `PARAMETER_ERROR`, `SOLVER_NONCONVERGENCE` with domain remediation hints.
