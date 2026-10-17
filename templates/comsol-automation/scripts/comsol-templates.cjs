const path = require("node:path");
const GEOM_MOD = require(path.join(__dirname, "comsol-geometry.cjs"));
const PHYS_MOD = require(path.join(__dirname, "comsol-physics.cjs"));

const TEMPLATES = {
  "heat-transfer": {
    language: "java",
    description: "COMSOL 6.2 3D Stationary Heat Transfer in Solids with precision Box boundary selections and CSV export",
    physics: ["HeatTransfer"],
    code: `import com.comsol.model.*;
import com.comsol.model.util.*;

public class HeatTransferModel {
  public static Model run() {
    Model model = ModelUtil.create("Model");
    model.param().set("L", "10[mm]", "Block length");
    model.param().set("W", "5[mm]", "Block width");
    model.param().set("H", "2[mm]", "Block height");
    model.param().set("T_in", "300[K]", "Base temperature");
    model.param().set("q0", "5e4[W/m^2]", "Top heat flux");

    model.component().create("comp1", true);
    GeomSequence geom = model.component("comp1").geom().create("geom1", 3);
    geom.create("blk1", "Block");
    geom.feature("blk1").set("size", new String[]{"L", "W", "H"});
    geom.feature("blk1").set("selresult", true);
    geom.feature("blk1").set("selresultshow", "all");
    geom.run("fin");

    // Precision coordinate-based Box selections for bottom (z=0) and top (z=H) faces
    model.component("comp1").selection().create("sel_bottom", "Box");
    model.component("comp1").selection("sel_bottom").set("entitydim", 2);
    model.component("comp1").selection("sel_bottom").set("condition", "allvertices");
    model.component("comp1").selection("sel_bottom").set("zmin", "-1e-6[m]");
    model.component("comp1").selection("sel_bottom").set("zmax", "1e-6[m]");

    model.component("comp1").selection().create("sel_top", "Box");
    model.component("comp1").selection("sel_top").set("entitydim", 2);
    model.component("comp1").selection("sel_top").set("condition", "allvertices");
    model.component("comp1").selection("sel_top").set("zmin", "H-1e-6[m]");
    model.component("comp1").selection("sel_top").set("zmax", "H+1e-6[m]");

    model.component("comp1").material().create("mat1", "Common");
    model.component("comp1").material("mat1").propertyGroup("def").set("thermalconductivity", new String[]{"400[W/(m*K)]"});
    model.component("comp1").material("mat1").propertyGroup("def").set("density", "8960[kg/m^3]");
    model.component("comp1").material("mat1").propertyGroup("def").set("heatcapacity", "385[J/(kg*K)]");

    model.component("comp1").physics().create("ht", "HeatTransfer", "geom1");
    model.component("comp1").physics("ht").create("temp1", "TemperatureBoundary", 2);
    model.component("comp1").physics("ht").feature("temp1").selection().named("sel_bottom");
    model.component("comp1").physics("ht").feature("temp1").set("T0", "T_in");

    model.component("comp1").physics("ht").create("hf1", "HeatFluxBoundary", 2);
    model.component("comp1").physics("ht").feature("hf1").selection().named("sel_top");
    model.component("comp1").physics("ht").feature("hf1").set("q0", "q0");

    model.component("comp1").mesh().create("mesh1");
    model.component("comp1").mesh("mesh1").autoMeshSize(4);
    model.component("comp1").mesh("mesh1").run();

    model.study().create("std1");
    model.study("std1").create("stat", "Stationary");
    model.study("std1").run();

    model.result().export().create("data1", "Data");
    model.result().export("data1").set("expr", new String[]{"T"});
    model.result().export("data1").set("filename", "temperature_results.csv");
    model.result().export("data1").run();
    return model;
  }

  public static void main(String[] args) {
    run();
  }
}
`
  },

  "fluid-flow": {
    language: "java",
    description: "COMSOL 6.2 3D Stationary Laminar Flow in a Rectangular Microchannel with Box inlet/outlet selections",
    physics: ["LaminarFlow"],
    code: `import com.comsol.model.*;
import com.comsol.model.util.*;

public class LaminarFlowModel {
  public static Model run() {
    Model model = ModelUtil.create("Model");
    model.param().set("L", "5[mm]", "Channel length");
    model.param().set("W", "0.5[mm]", "Channel width");
    model.param().set("H", "0.2[mm]", "Channel height");
    model.param().set("U_in", "0.1[m/s]", "Inlet velocity");

    model.component().create("comp1", true);
    GeomSequence geom = model.component("comp1").geom().create("geom1", 3);
    geom.create("blk1", "Block");
    geom.feature("blk1").set("size", new String[]{"L", "W", "H"});
    geom.feature("blk1").set("selresult", true);
    geom.run("fin");

    model.component("comp1").selection().create("sel_inlet", "Box");
    model.component("comp1").selection("sel_inlet").set("entitydim", 2);
    model.component("comp1").selection("sel_inlet").set("condition", "allvertices");
    model.component("comp1").selection("sel_inlet").set("xmin", "-1e-6[m]");
    model.component("comp1").selection("sel_inlet").set("xmax", "1e-6[m]");

    model.component("comp1").selection().create("sel_outlet", "Box");
    model.component("comp1").selection("sel_outlet").set("entitydim", 2);
    model.component("comp1").selection("sel_outlet").set("condition", "allvertices");
    model.component("comp1").selection("sel_outlet").set("xmin", "L-1e-6[m]");
    model.component("comp1").selection("sel_outlet").set("xmax", "L+1e-6[m]");

    model.component("comp1").material().create("mat1", "Common");
    model.component("comp1").material("mat1").propertyGroup("def").set("density", "1000[kg/m^3]");
    model.component("comp1").material("mat1").propertyGroup("def").set("dynamicviscosity", "1e-3[Pa*s]");

    model.component("comp1").physics().create("spf", "LaminarFlow", "geom1");
    model.component("comp1").physics("spf").create("inl1", "InletBoundary", 2);
    model.component("comp1").physics("spf").feature("inl1").selection().named("sel_inlet");
    model.component("comp1").physics("spf").feature("inl1").set("U0in", "U_in");

    model.component("comp1").physics("spf").create("out1", "OutletBoundary", 2);
    model.component("comp1").physics("spf").feature("out1").selection().named("sel_outlet");
    model.component("comp1").physics("spf").feature("out1").set("p0", "0[Pa]");

    model.component("comp1").mesh().create("mesh1");
    model.component("comp1").mesh("mesh1").autoMeshSize(5);
    model.component("comp1").mesh("mesh1").run();

    model.study().create("std1");
    model.study("std1").create("stat", "Stationary");
    model.study("std1").run();
    return model;
  }

  public static void main(String[] args) {
    run();
  }
}
`
  },

  "solid-mechanics": {
    language: "java",
    description: "COMSOL 6.2 3D Stationary Solid Mechanics Cantilever Beam with Box selections",
    physics: ["SolidMechanics"],
    code: `import com.comsol.model.*;
import com.comsol.model.util.*;

public class SolidMechanicsModel {
  public static Model run() {
    Model model = ModelUtil.create("Model");
    model.param().set("L", "100[mm]", "Beam length");
    model.param().set("W", "10[mm]", "Beam width");
    model.param().set("H", "5[mm]", "Beam thickness");
    model.param().set("F_load", "-1e5[N/m^2]", "Tip surface load");

    model.component().create("comp1", true);
    GeomSequence geom = model.component("comp1").geom().create("geom1", 3);
    geom.create("blk1", "Block");
    geom.feature("blk1").set("size", new String[]{"L", "W", "H"});
    geom.feature("blk1").set("selresult", true);
    geom.run("fin");

    model.component("comp1").selection().create("sel_fixed_root", "Box");
    model.component("comp1").selection("sel_fixed_root").set("entitydim", 2);
    model.component("comp1").selection("sel_fixed_root").set("condition", "allvertices");
    model.component("comp1").selection("sel_fixed_root").set("xmin", "-1e-6[m]");
    model.component("comp1").selection("sel_fixed_root").set("xmax", "1e-6[m]");

    model.component("comp1").selection().create("sel_top_load", "Box");
    model.component("comp1").selection("sel_top_load").set("entitydim", 2);
    model.component("comp1").selection("sel_top_load").set("condition", "allvertices");
    model.component("comp1").selection("sel_top_load").set("zmin", "H-1e-6[m]");
    model.component("comp1").selection("sel_top_load").set("zmax", "H+1e-6[m]");

    model.component("comp1").material().create("mat1", "Common");
    model.component("comp1").material("mat1").propertyGroup("def").set("youngsmodulus", "200e9[Pa]");
    model.component("comp1").material("mat1").propertyGroup("def").set("poissonsratio", "0.3");
    model.component("comp1").material("mat1").propertyGroup("def").set("density", "7850[kg/m^3]");

    model.component("comp1").physics().create("solid", "SolidMechanics", "geom1");
    model.component("comp1").physics("solid").create("fix1", "Fixed", 2);
    model.component("comp1").physics("solid").feature("fix1").selection().named("sel_fixed_root");

    model.component("comp1").physics("solid").create("bndl1", "BoundaryLoad", 2);
    model.component("comp1").physics("solid").feature("bndl1").selection().named("sel_top_load");
    model.component("comp1").physics("solid").feature("bndl1").set("FperArea", new String[]{"0", "0", "F_load"});

    model.component("comp1").mesh().create("mesh1");
    model.component("comp1").mesh("mesh1").autoMeshSize(4);
    model.component("comp1").mesh("mesh1").run();

    model.study().create("std1");
    model.study("std1").create("stat", "Stationary");
    model.study("std1").run();
    return model;
  }

  public static void main(String[] args) {
    run();
  }
}
`
  },

  "acoustics": {
    language: "java",
    description: "COMSOL 6.2 3D Pressure Acoustics in an Air Cavity with SoundHardWall and NormalAcceleration",
    physics: ["PressureAcoustics"],
    code: `import com.comsol.model.*;
import com.comsol.model.util.*;

public class AcousticsModel {
  public static Model run() {
    Model model = ModelUtil.create("Model");
    model.param().set("L", "100[mm]", "Cavity length");
    model.param().set("W", "50[mm]", "Cavity width");
    model.param().set("H", "50[mm]", "Cavity height");
    model.param().set("a_in", "1[m/s^2]", "Inlet normal acceleration");

    model.component().create("comp1", true);
    GeomSequence geom = model.component("comp1").geom().create("geom1", 3);
    geom.create("blk1", "Block");
    geom.feature("blk1").set("size", new String[]{"L", "W", "H"});
    geom.feature("blk1").set("selresult", true);
    geom.run("fin");

    model.component("comp1").selection().create("sel_driver", "Box");
    model.component("comp1").selection("sel_driver").set("entitydim", 2);
    model.component("comp1").selection("sel_driver").set("condition", "allvertices");
    model.component("comp1").selection("sel_driver").set("xmin", "-1e-6[m]");
    model.component("comp1").selection("sel_driver").set("xmax", "1e-6[m]");

    model.component("comp1").selection().create("sel_wall", "Box");
    model.component("comp1").selection("sel_wall").set("entitydim", 2);
    model.component("comp1").selection("sel_wall").set("condition", "allvertices");
    model.component("comp1").selection("sel_wall").set("xmin", "L-1e-6[m]");
    model.component("comp1").selection("sel_wall").set("xmax", "L+1e-6[m]");

    model.component("comp1").material().create("mat1", "Common");
    model.component("comp1").material("mat1").propertyGroup("def").set("density", "1.204[kg/m^3]");
    model.component("comp1").material("mat1").propertyGroup("def").set("soundspeed", "343.2[m/s]");

    model.component("comp1").physics().create("acpr", "PressureAcoustics", "geom1");
    model.component("comp1").physics("acpr").create("acc1", "NormalAcceleration", 2);
    model.component("comp1").physics("acpr").feature("acc1").selection().named("sel_driver");
    model.component("comp1").physics("acpr").feature("acc1").set("an0", "a_in");

    model.component("comp1").physics("acpr").create("wall1", "SoundHardWall", 2);
    model.component("comp1").physics("acpr").feature("wall1").selection().named("sel_wall");

    model.component("comp1").mesh().create("mesh1");
    model.component("comp1").mesh("mesh1").autoMeshSize(4);
    model.component("comp1").mesh("mesh1").run();

    model.study().create("std1");
    model.study("std1").create("stat", "Stationary");
    model.study("std1").run();
    return model;
  }

  public static void main(String[] args) {
    run();
  }
}
`
  },

  "wave-optics": {
    language: "java",
    description: "COMSOL 6.2 3D Electromagnetic Waves Frequency Domain / Wave Optics with PEC and Scattering Boundary Conditions",
    physics: ["ElectromagneticWavesFrequencyDomain"],
    code: `import com.comsol.model.*;
import com.comsol.model.util.*;

public class WaveOpticsModel {
  public static Model run() {
    Model model = ModelUtil.create("Model");
    model.param().set("L", "20[um]", "Waveguide length");
    model.param().set("W", "2[um]", "Waveguide width");
    model.param().set("H", "1[um]", "Waveguide height");

    model.component().create("comp1", true);
    GeomSequence geom = model.component("comp1").geom().create("geom1", 3);
    geom.create("blk1", "Block");
    geom.feature("blk1").set("size", new String[]{"L", "W", "H"});
    geom.feature("blk1").set("selresult", true);
    geom.run("fin");

    model.component("comp1").selection().create("sel_inlet", "Box");
    model.component("comp1").selection("sel_inlet").set("entitydim", 2);
    model.component("comp1").selection("sel_inlet").set("condition", "allvertices");
    model.component("comp1").selection("sel_inlet").set("xmin", "-1e-9[m]");
    model.component("comp1").selection("sel_inlet").set("xmax", "1e-9[m]");

    model.component("comp1").selection().create("sel_outlet", "Box");
    model.component("comp1").selection("sel_outlet").set("entitydim", 2);
    model.component("comp1").selection("sel_outlet").set("condition", "allvertices");
    model.component("comp1").selection("sel_outlet").set("xmin", "L-1e-9[m]");
    model.component("comp1").selection("sel_outlet").set("xmax", "L+1e-9[m]");

    model.component("comp1").material().create("mat1", "Common");
    model.component("comp1").material("mat1").propertyGroup("def").set("relpermittivity", "11.68");
    model.component("comp1").material("mat1").propertyGroup("def").set("relpermeability", "1");

    model.component("comp1").physics().create("ewfd", "ElectromagneticWavesFrequencyDomain", "geom1");
    model.component("comp1").physics("ewfd").create("sbc1", "ScatteringBoundaryCondition", 2);
    model.component("comp1").physics("ewfd").feature("sbc1").selection().named("sel_inlet");
    model.component("comp1").physics("ewfd").feature("sbc1").set("WaveType", "PlaneWave");

    model.component("comp1").physics("ewfd").create("sbc2", "ScatteringBoundaryCondition", 2);
    model.component("comp1").physics("ewfd").feature("sbc2").selection().named("sel_outlet");
    model.component("comp1").physics("ewfd").feature("sbc2").set("WaveType", "PlaneWave");

    model.component("comp1").mesh().create("mesh1");
    model.component("comp1").mesh("mesh1").autoMeshSize(3);
    model.component("comp1").mesh("mesh1").run();

    model.study().create("std1");
    model.study("std1").create("stat", "Stationary");
    model.study("std1").run();
    return model;
  }

  public static void main(String[] args) {
    run();
  }
}
`
  },

  "magnetic-fields": {
    language: "java",
    description: "COMSOL 6.2 3D Magnetic Fields with Magnetic Insulation and Surface Current Excitation",
    physics: ["MagneticFields"],
    code: `import com.comsol.model.*;
import com.comsol.model.util.*;

public class MagneticFieldsModel {
  public static Model run() {
    Model model = ModelUtil.create("Model");
    model.param().set("L", "30[mm]", "Core length");
    model.param().set("W", "10[mm]", "Core width");
    model.param().set("H", "10[mm]", "Core height");
    model.param().set("Js0", "5000[A/m]", "Drive surface current");

    model.component().create("comp1", true);
    GeomSequence geom = model.component("comp1").geom().create("geom1", 3);
    geom.create("blk1", "Block");
    geom.feature("blk1").set("size", new String[]{"L", "W", "H"});
    geom.feature("blk1").set("selresult", true);
    geom.run("fin");

    model.component("comp1").selection().create("sel_ins", "Box");
    model.component("comp1").selection("sel_ins").set("entitydim", 2);
    model.component("comp1").selection("sel_ins").set("condition", "allvertices");
    model.component("comp1").selection("sel_ins").set("xmin", "-1e-6[m]");
    model.component("comp1").selection("sel_ins").set("xmax", "1e-6[m]");

    model.component("comp1").selection().create("sel_coil", "Box");
    model.component("comp1").selection("sel_coil").set("entitydim", 2);
    model.component("comp1").selection("sel_coil").set("condition", "allvertices");
    model.component("comp1").selection("sel_coil").set("zmin", "H-1e-6[m]");
    model.component("comp1").selection("sel_coil").set("zmax", "H+1e-6[m]");

    model.component("comp1").material().create("mat1", "Common");
    model.component("comp1").material("mat1").propertyGroup("def").set("relpermeability", "1000");
    model.component("comp1").material("mat1").propertyGroup("def").set("electricconductivity", "0.01[S/m]");

    model.component("comp1").physics().create("mf", "MagneticFields", "geom1");
    model.component("comp1").physics("mf").create("magins1", "MagneticInsulation", 2);
    model.component("comp1").physics("mf").feature("magins1").selection().named("sel_ins");

    model.component("comp1").physics("mf").create("sc1", "SurfaceCurrent", 2);
    model.component("comp1").physics("mf").feature("sc1").selection().named("sel_coil");
    model.component("comp1").physics("mf").feature("sc1").set("Js0", new String[]{"0", "Js0", "0"});

    model.component("comp1").mesh().create("mesh1");
    model.component("comp1").mesh("mesh1").autoMeshSize(4);
    model.component("comp1").mesh("mesh1").run();

    model.study().create("std1");
    model.study("std1").create("stat", "Stationary");
    model.study("std1").run();
    return model;
  }

  public static void main(String[] args) {
    run();
  }
}
`
  },

  "mph-python": {
    language: "python",
    description: "Python MPh runner for model inspection, parameter update, solving, and expression evaluation",
    physics: ["Any"],
    code: `import json
import sys
import mph

def run_mph(input_file, output_file=None, params=None, study=None, expressions=None, inspect_only=False):
    client = mph.start()
    model = client.load(input_file)
    info = {
        "input": input_file,
        "parameters": model.parameters(),
        "geometries": model.geometries(),
        "materials": model.materials(),
        "physics": model.physics(),
        "meshes": model.meshes(),
        "studies": model.studies(),
    }
    if inspect_only:
        print(json.dumps({"status": "INSPECTED", "model": info}, ensure_ascii=False))
        return

    for k, v in (params or {}).items():
        model.parameter(k, str(v))

    model.build()
    model.mesh()
    if study:
        model.solve(study)
    else:
        model.solve()

    if output_file:
        model.save(output_file)

    evaluations = {}
    for expr in (expressions or []):
        val = model.evaluate(expr)
        evaluations[expr] = val.tolist() if hasattr(val, "tolist") else val

    print(json.dumps({
        "status": "COMPLETED",
        "output": output_file or input_file,
        "parameters": model.parameters(),
        "evaluations": evaluations
    }, ensure_ascii=False))

if __name__ == "__main__":
    cfg = json.loads(sys.argv[1])
    run_mph(
        input_file=cfg["inputFile"],
        output_file=cfg.get("outputFile"),
        params=cfg.get("params"),
        study=cfg.get("study"),
        expressions=cfg.get("expressions"),
        inspect_only=cfg.get("inspectOnly", False),
    )
`
  }
};

const REMEDIATION_HINTS = {
  MESH_ERROR:
    "Hint: Adjust mesh size (autoMeshSize(3..6)), check geometry boolean overlaps/sliver faces, or set geom.feature('fin').set('repairtol', '1e-5') before meshing.",
  GEOMETRY_ERROR:
    "Hint: Verify primitive dimensions are positive, boolean 'Difference' sets both .selection('input') and .selection('input2'), 2D primitives in 3D are wrapped inside a 'WorkPlane', and geom.run('fin') is called.",
  PARAMETER_ERROR:
    "Hint: Ensure all referenced parameters are defined via model.param().set(name, expr) with valid COMSOL units (e.g. '10[mm]', '300[K]') and correct physics scope prefix (e.g. comp1.ht.T).",
  SOLVER_NONCONVERGENCE:
    "Hint: Check for missing boundary constraints causing a singular matrix (verify Box selections actually capture boundary entities), check material properties on all domains, or use auxiliary continuation sweep.",
  COMPILE_ERROR:
    "Hint: Ensure 'import com.comsol.model.*;' and 'import com.comsol.model.util.*;' are present, class name matches filename, and COMSOL 6.2 API uses .create(tag, type), .selection('input').set(new String[]{...}), and String[] for vector properties.",
  SCIENTIFIC_INTEGRITY_VIOLATION:
    "Hint: General scientific rigor check failed (non-physical gain, violation of energy conservation/passivity, singular/unphysical fields, or boundary truncation artifacts). Adjust model parameters, boundary conditions, or sweep bounds to restore physical validity."
};

function validateJavaModelSource(sourceCode, expectedClassName = null) {
  const code = GEOM_MOD.stripJavaComments(sourceCode);
  const issues = [];

  if (!/import\s+com\.comsol\.model\.\*\s*;/.test(code)) {
    issues.push("Missing 'import com.comsol.model.*;'");
  }
  if (!/import\s+com\.comsol\.model\.util\.\*\s*;/.test(code)) {
    issues.push("Missing 'import com.comsol.model.util.*;'");
  }
  if (!/ModelUtil\.create\s*\(/.test(code)) {
    issues.push("Missing 'ModelUtil.create(...)' initialization");
  }
  if (expectedClassName) {
    const classRegex = new RegExp(`public\\s+class\\s+${expectedClassName}\\b`);
    if (!classRegex.test(code)) {
      issues.push(`Public class name does not match expected '${expectedClassName}'`);
    }
  }
  if (/\.geom\([^)]*\)\.add\s*\(/.test(code) || /\.physics\([^)]*\)\.add\s*\(/.test(code)) {
    issues.push("Invalid COMSOL Java API call '.add(...)'; use '.create(tag, type)' instead");
  }

  const geomAudit = GEOM_MOD.auditJavaGeometryCode(code);
  const physAudit = PHYS_MOD.auditJavaPhysicsCode(code);
  issues.push(...geomAudit.errors, ...physAudit.errors);

  return {
    valid: issues.length === 0,
    issues,
    warnings: [...geomAudit.warnings, ...physAudit.warnings]
  };
}

function getTemplate(domain) {
  const key = String(domain || "").toLowerCase().trim();
  if (!Object.prototype.hasOwnProperty.call(TEMPLATES, key)) {
    const available = Object.keys(TEMPLATES).join(", ");
    throw new Error(`Unknown COMSOL template '${domain}'. Available: ${available}`);
  }
  return {
    domain: key,
    ...TEMPLATES[key]
  };
}

function listTemplates() {
  return Object.entries(TEMPLATES).map(([domain, info]) => ({
    domain,
    language: info.language,
    physics: info.physics,
    description: info.description
  }));
}

module.exports = {
  TEMPLATES,
  REMEDIATION_HINTS,
  validateJavaModelSource,
  getTemplate,
  listTemplates
};
