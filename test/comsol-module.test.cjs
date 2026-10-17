const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const DEPLOY_COMSOL = path.resolve(__dirname, "..", "deploy-comsol.cjs");
const COMSOL_SCRIPT = path.resolve(__dirname, "..", "global", "comsol.cjs");
const comsol = require(COMSOL_SCRIPT);

function makeTempDir(prefix = "comsol-addon-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanupDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 4, retryDelay: 40 });
  } catch (_) {}
}

test("1. Standalone add-on install & uninstalled --dry-run work without Dual-Agent Bridge or COMSOL", t => {
  const root = makeTempDir();
  t.after(() => cleanupDir(root));

  const homeDir = path.join(root, "home");
  const skillPath = path.join(root, "skills", "comsol-automation", "SKILL.md");

  const installRes = spawnSync(process.execPath, [DEPLOY_COMSOL, "install"], {
    env: {
      ...process.env,
      DUAL_AGENT_HOME: homeDir,
      COMSOL_AGENT_SKILL_PATH: skillPath,
      COMSOL_DISABLE_SYSTEM_SCAN: "1",
      COMSOL_ROOT: ""
    },
    encoding: "utf8"
  });
  assert.equal(installRes.status, 0, installRes.stderr);
  const installed = JSON.parse(installRes.stdout);
  assert.equal(installed.status, "INSTALLED");
  assert.equal(installed.role, "addon");
  assert.equal(installed.skillVerified.ok, true);
  assert.equal(installed.comsolEnvironment.installed, false);
  assert.equal(installed.comsolEnvironment.readyMode, "dry-run-only");
  assert.equal(installed.comsolEnvironment.dualAgentBridge.integrationMode, "standalone");

  const addonRegistry = JSON.parse(
    fs.readFileSync(path.join(homeDir, "addons", "registry.json"), "utf8")
  );
  assert.ok(addonRegistry.addons["comsol-automation"]);

  const batchRes = comsol.runComsolBatch({
    inputFile: path.join(root, "chip_cooling.mph"),
    outputFile: path.join(root, "chip_cooling_out.mph"),
    study: "std1",
    params: ["width=120[um]", "inlet_v=0.8[m/s]"],
    batchLog: path.join(root, "batch.log"),
    homeDir,
    comsolRoot: path.join(root, "nonexistent-comsol")
  });
  assert.equal(batchRes.status, "DRY_RUN");
  assert.equal(batchRes.integrationMode, "standalone");
  assert.deepEqual(batchRes.parsedParams, { width: "120[um]", inlet_v: "0.8[m/s]" });
  assert.ok(batchRes.args.includes("-pname"));
  assert.ok(batchRes.args.includes("width,inlet_v"));
});

test("2. Verified COMSOL Java API scaffolding, anti-hallucination static validation & compilation", t => {
  const root = makeTempDir();
  t.after(() => cleanupDir(root));

  const templates = comsol.listTemplates();
  assert.ok(templates.some(tpl => tpl.domain === "heat-transfer"));
  assert.ok(templates.some(tpl => tpl.domain === "fluid-flow"));
  assert.ok(templates.some(tpl => tpl.domain === "mph-python"));

  const javaPath = path.join(root, "ChipHeatSink.java");
  const scaffold = comsol.scaffoldJavaModel({
    domain: "heat-transfer",
    outputFile: javaPath
  });
  assert.equal(scaffold.status, "SCAFFOLDED");
  assert.equal(scaffold.className, "ChipHeatSink");
  assert.equal(scaffold.validation.valid, true);

  // Dry-run compile when COMSOL is not installed
  const dryCompile = comsol.compileComsolJava({
    sourceFile: javaPath,
    comsolRoot: path.join(root, "no-comsol")
  });
  assert.equal(dryCompile.status, "DRY_RUN");
  assert.equal(dryCompile.staticValidation.valid, true);

  // Catch hallucinated COMSOL Java API syntax (.add() instead of .create() and missing imports)
  const badJavaPath = path.join(root, "HallucinatedModel.java");
  fs.writeFileSync(
    badJavaPath,
    `public class HallucinatedModel { void build() { model.geom("geom1").add("blk1", "Block"); } }`
  );
  const badCompile = comsol.compileComsolJava({
    sourceFile: badJavaPath,
    comsolRoot: path.join(root, "no-comsol")
  });
  assert.equal(badCompile.status, "COMPILE_ERROR");
  assert.equal(badCompile.staticValidation.valid, false);
  assert.ok(badCompile.staticValidation.issues.some(i => i.includes(".create(tag, type)")));
});

test("3. Simulated COMSOL 6.2 discovery, log classification & remediation hints", t => {
  const root = makeTempDir();
  t.after(() => cleanupDir(root));

  const fakeComsolRoot = path.join(root, "COMSOL62", "Multiphysics");
  const binDir = path.join(fakeComsolRoot, "bin", process.platform === "win32" ? "win64" : "glnxa64");
  fs.mkdirSync(binDir, { recursive: true });
  const batchExe = process.platform === "win32" ? "comsolbatch.exe" : "comsolbatch";
  const compileExe = process.platform === "win32" ? "comsolcompile.exe" : "comsolcompile";
  fs.writeFileSync(path.join(binDir, batchExe), "mock-binary");
  fs.writeFileSync(path.join(binDir, compileExe), "mock-compiler");

  const env = comsol.detectComsolEnvironment({
    homeDir: path.join(root, "home"),
    comsolRoot: fakeComsolRoot
  });
  assert.equal(env.installed, true);
  assert.equal(env.version, "6.2");
  assert.ok(env.capabilities.includes("java-api-compile"));

  const geomErr = comsol.parseComsolLog("Error: Boolean operation failed in geometry.", 1);
  assert.equal(geomErr.status, "GEOMETRY_ERROR");
  assert.ok(geomErr.remediationHint.includes("geom.run"));

  const meshErr = comsol.parseComsolLog("Failed to generate mesh for domain 2.\nInverted mesh element.", 1);
  assert.equal(meshErr.status, "MESH_ERROR");
  assert.ok(meshErr.remediationHint.includes("autoMeshSize"));

  const solverErr = comsol.parseComsolLog("Nonlinear solver did not converge.\nSingular matrix.", 1);
  assert.equal(solverErr.status, "SOLVER_NONCONVERGENCE");
  assert.ok(solverErr.remediationHint.includes("singular matrix"));
});

test("4. Add-on attachment to Dual-Agent Host + closed-loop auto-fix with remediation hints", t => {
  const root = makeTempDir();
  t.after(() => cleanupDir(root));

  const homeDir = path.join(root, "home");
  const skillPath = path.join(root, "skills", "comsol-automation", "SKILL.md");
  fs.mkdirSync(homeDir, { recursive: true });

  const mockClientPath = path.join(homeDir, "client.cjs");
  const mockBridgePath = path.join(homeDir, "bridge.cjs");
  fs.writeFileSync(
    mockClientPath,
    `console.log(JSON.stringify({ submitted: true, args: process.argv.slice(2) }));`
  );
  fs.writeFileSync(mockBridgePath, "// mock bridge");

  const installRes = spawnSync(process.execPath, [DEPLOY_COMSOL, "install"], {
    env: {
      ...process.env,
      DUAL_AGENT_HOME: homeDir,
      COMSOL_AGENT_SKILL_PATH: skillPath,
      COMSOL_DISABLE_SYSTEM_SCAN: "1"
    },
    encoding: "utf8"
  });
  assert.equal(installRes.status, 0);

  const failRun = comsol.runComsolBatch({
    inputFile: path.join(root, "model.mph"),
    study: "std1",
    params: { mesh_scale: "0.2" },
    autoFix: true,
    homeDir,
    projectDir: root,
    mockCmd: `echo Nonlinear solver did not converge & exit /b 1`
  });
  assert.equal(failRun.status, "SOLVER_NONCONVERGENCE");
  assert.equal(failRun.integrationMode, "merged-dual-agent");
  assert.equal(failRun.delegatedFix.delegated, true);
  assert.ok(failRun.delegatedFix.suggestedPrompt.includes("Hint:"));

  const uninst = JSON.parse(
    spawnSync(process.execPath, [DEPLOY_COMSOL, "uninstall"], {
      env: { ...process.env, DUAL_AGENT_HOME: homeDir, COMSOL_AGENT_SKILL_PATH: skillPath },
      encoding: "utf8"
    }).stdout
  );
  assert.equal(uninst.status, "UNINSTALLED");
  assert.equal(uninst.dualAgentBridgePreserved, true);
  assert.equal(fs.existsSync(mockClientPath), true);
});

test("5. COMSOL 6.2 Precision Geometry Engine: AABB validation, boolean overlap checks, FaceBox selections & Java geometry audit", () => {
  const presets = comsol.listGeometryPresets();
  assert.ok(presets.some(p => p.name === "microchannel-heatsink"));

  const preset = comsol.getGeometryPreset("microchannel-heatsink");
  const compiled = comsol.compileGeometrySpecToJava(preset.spec);
  assert.equal(compiled.status, "COMPILED_GEOMETRY_JAVA");
  assert.equal(compiled.validation.valid, true);
  assert.ok(compiled.javaCode.includes('.selection("input").set(new String[]{"blk_sink"})'));
  assert.ok(compiled.javaCode.includes('.selection("input2").set(new String[]{"blk_chan1", "blk_chan2"})'));
  assert.ok(compiled.javaCode.includes('.selection().create("sel_heated_base", "Box")'));
  assert.ok(compiled.javaCode.includes('.set("selresult", true)'));

  // Generated Java code passes both static validation and geometry audit
  const staticCheck = comsol.validateJavaModelSource(compiled.javaCode, "MicrochannelHeatSinkGeom");
  assert.equal(staticCheck.valid, true);

  // Detect disjoint boolean Difference (subtracted tool completely outside target block)
  const disjointSpec = {
    dimension: 3,
    parameters: { L: "10[mm]" },
    features: [
      { tag: "blk1", type: "Block", size: ["L", "L", "L"], pos: ["0[mm]", "0[mm]", "0[mm]"] },
      { tag: "cyl_outside", type: "Cylinder", r: "1[mm]", h: "5[mm]", pos: ["50[mm]", "50[mm]", "0[mm]"] },
      { tag: "dif1", type: "Difference", input: ["blk1"], input2: ["cyl_outside"] }
    ]
  };
  const disjointVal = comsol.validateGeometrySpec(disjointSpec);
  assert.equal(disjointVal.valid, false);
  assert.ok(disjointVal.errors.some(e => e.includes("does not intersect target")));

  // Detect 2D primitive placed directly in 3D geometry and wrong .set("input", ...) syntax
  const buggyJava = `
    import com.comsol.model.*;
    import com.comsol.model.util.*;
    public class BuggyGeom {
      public static void run() {
        Model model = ModelUtil.create("Model");
        GeomSequence geom = model.component("comp1").geom().create("geom1", 3);
        geom.create("r1", "Rectangle");
        geom.create("dif1", "Difference");
        geom.feature("dif1").set("input", "r1");
      }
    }
  `;
  const audit = comsol.auditJavaGeometryCode(buggyJava);
  assert.equal(audit.valid, false);
  assert.ok(audit.errors.some(e => e.includes("WorkPlane")));
  assert.ok(audit.errors.some(e => e.includes('.selection("input").set')));
  assert.ok(audit.errors.some(e => e.includes('selection("input2")')));
});



test("6. WorkPlane and signed extrusion bounds follow orientation and offset", () => {
  const rect = { tag: "r", type: "Rectangle", size: [2, 4], pos: [1, 2] };
  for (const [plane, expected] of Object.entries({
    xy: { xmin: 1, xmax: 3, ymin: 2, ymax: 6, zmin: 4, zmax: 9 },
    yz: { xmin: 4, xmax: 9, ymin: 1, ymax: 3, zmin: 2, zmax: 6 },
    zx: { xmin: 2, xmax: 6, ymin: 4, ymax: 9, zmin: 1, zmax: 3 }
  })) {
    const wp = comsol.computeFeatureAABB({ type: "WorkPlane", quickplane: plane, quickz: 7, sketch: [rect] });
    const extruded = comsol.computeFeatureAABB({ type: "Extrude", input: ["wp"], distance: [-3, 2] }, {}, { wp });
    assert.deepEqual(extruded, expected);
  }
  const wp = comsol.computeFeatureAABB({ type: "WorkPlane", sketch: [{ type: "Circle", r: 2 }] });
  assert.deepEqual(comsol.computeFeatureAABB({ type: "Extrude", input: "wp", distance: 3 }, {}, { wp }),
    { xmin: -2, xmax: 2, ymin: -2, ymax: 2, zmin: 0, zmax: 3 });
  assert.equal(comsol.computeFeatureAABB({ type: "WorkPlane", sketch: [rect, { type: "Ellipse" }] }), null);
  assert.equal(comsol.computeFeatureAABB({ type: "Extrude", input: ["wp", "unknown"], distance: 1 }, {}, { wp }), null);
  assert.equal(comsol.computeFeatureAABB({ type: "WorkPlane", quickplane: "bad", sketch: [rect] }), null);
});

test("7. Array, Move and Revolve include negative displacements and angular extrema", () => {
  const b = { xmin: 1, xmax: 2, ymin: 0, ymax: 1, zmin: 0, zmax: 3 };
  assert.deepEqual(comsol.computeFeatureAABB({ type: "Array", input: ["b"], size: [3, 2, 1], displ: [-2, 4, 7] }, {}, { b }),
    { xmin: -3, xmax: 2, ymin: 0, ymax: 5, zmin: 0, zmax: 3 });
  assert.deepEqual(comsol.computeFeatureAABB({ type: "Move", input: ["b"], displ: [-2, 4, -1] }, {}, { b }),
    { xmin: -1, xmax: 0, ymin: 4, ymax: 5, zmin: -1, zmax: 2 });
  for (const size of [[0, 1, 1], [-2, 1, 1], [1.5, 1, 1]]) {
    assert.equal(comsol.computeFeatureAABB({ type: "Array", input: "b", size }, {}, { b }), null);
  }
  for (const type of ["Union", "Difference", "Move", "Array", "Revolve"]) {
    assert.equal(comsol.computeFeatureAABB({ type, input: ["b", "missing"] }, {}, { b }), null);
  }
  const full = comsol.computeFeatureAABB({ type: "Revolve", input: "b", angle: 360 }, {}, { b });
  assert.ok(Math.abs(full.xmax - Math.sqrt(5)) < 1e-12);
  assert.ok(Math.abs(full.ymin + Math.sqrt(5)) < 1e-12);
  const partial = comsol.computeFeatureAABB({ type: "Revolve", input: "b", angle: 180 }, {}, { b });
  assert.ok(Math.abs(partial.ymax - Math.sqrt(5)) < 1e-12);
  assert.equal(partial.zmax, 3);
  const invalid = comsol.validateGeometrySpec({
    features: [{ tag: "wp", type: "WorkPlane", sketch: [{ type: "Ellipse" }] },
      { tag: "ex", type: "Extrude", input: ["wp"], distance: 2 }],
    selections: [{ tag: "face", type: "FaceBox", feature: "ex", face: "top" }]
  });
  assert.equal(invalid.valid, false);
});

test("8. Java generation uses rotation, edge-operation and component Cylinder properties", () => {
  const compiled = comsol.compileGeometrySpecToJava({
    features: [
      { tag: "wp", type: "WorkPlane", quickplane: "yz", quickz: 3, sketch: [{ tag: "r", type: "Rectangle", size: [2, 4] }] },
      { tag: "rev", type: "Revolve", input: ["wp"], angle: 270, axis: [0, 0, 1], pos: [0, 0, 0] },
      { tag: "fil", type: "Fillet", input: ["rev"], edges: [1, 2], radius: "1[mm]" },
      { tag: "ch", type: "Chamfer3D", input: ["fil"], entities: [3], distance: "2[mm]" },
      { tag: "mv", type: "Move", input: ["ch"], displ: [-1, 0, 0] }
    ],
    selections: [{ tag: "csel", type: "CylinderSelection", pos: [1, 2, 3], axis: [0, 0, 1], r: 4, bottom: -1, top: 5 }]
  });
  assert.equal(compiled.status, "COMPILED_GEOMETRY_JAVA");
  for (const expected of [
    'geom.feature("wp").set("quickx", "3")',
    'geom.create("fil", "Fillet3D")',
    'geom.feature("rev").set("angle2", "270")',
    'geom.feature("rev").set("axis", new String[]{"0", "0", "1"})',
    'geom.feature("fil").selection("input").set("rev", new int[]{1, 2})',
    'geom.feature("fil").set("radius", "1[mm]")',
    'geom.feature("ch").set("distance", "2[mm]")',
    '.selection().create("csel", "Cylinder")',
    '.selection("csel").set("pos", new String[]{"1", "2", "3"})',
    '.selection("csel").set("bottom", "-1")',
    '.selection("csel").set("top", "5")',
    'geom.feature("mv").set("displ", new String[]{"-1", "0", "0"})'
  ]) assert.ok(compiled.javaCode.includes(expected), expected);
  assert.equal(comsol.auditJavaGeometryCode(compiled.javaCode).valid, true);
  assert.deepEqual(comsol.auditJavaGeometryCode(compiled.javaCode).warnings, []);
});

test("9. Java audit ignores comments and requires final builds and vector Block size", t => {
  const head = 'GeomSequence geom = model.component("comp1").geom().create("geom1", 3); geom.create("blk", "Block");';
  for (const scalar of ['"L"', '2', '2.5']) {
    assert.ok(comsol.auditJavaGeometryCode(head + 'geom.feature("blk").set("size", ' + scalar + '); geom.run();').errors.some(e => e.includes("scalar size")));
  }
  for (const suffix of ['', '// geom.run("fin");', '/* geom.run(); */', 'geom.run("blk");']) {
    assert.ok(comsol.auditJavaGeometryCode(head + suffix).errors.some(e => e.includes("Missing final geometry build")));
  }
  const valid = head + 'geom.feature("blk").set("size", new String[]{"1", "2", "3"}); geom.run("fin");';
  assert.equal(comsol.auditJavaGeometryCode(valid).valid, true);
  assert.equal(comsol.auditJavaGeometryCode(valid + '/* geom.create("r", "Rectangle"); */').valid, true);
  assert.equal(comsol.auditJavaGeometryCode('geom.run();' + head).valid, false);
  assert.equal(comsol.auditJavaGeometryCode('String url = "https://example.test";').valid, true);
  for (const domain of ["heat-transfer", "fluid-flow", "solid-mechanics"]) {
    assert.equal(comsol.validateJavaModelSource(comsol.getTemplate(domain).code).valid, true);
  }
  assert.throws(() => comsol.getTemplate("constructor"), /Unknown COMSOL template/);
  assert.throws(() => comsol.getGeometryPreset("toString"), /Unknown geometry preset/);
  const root = makeTempDir();
  t.after(() => cleanupDir(root));
  const file = path.join(root, "BadSize.java");
  fs.writeFileSync(file, 'import com.comsol.model.*; import com.comsol.model.util.*; public class BadSize { void build() { Model model = ModelUtil.create("Model"); ' +
    head + 'geom.feature("blk").set("size", "1"); geom.run(); }}');
  assert.equal(comsol.compileComsolJava({ sourceFile: file, comsolRoot: path.join(root, "absent") }).status, "COMPILE_ERROR");
});

test("10. Geometry CLI rejects missing, bare and conflicting input options", () => {
  for (const command of ["validate-geometry", "build-geometry"]) {
    for (const args of [[], ["--spec"], ["--preset"], ["--input"], ["--spec", "x.json", "--preset", "core-shell-cylinder"]]) {
      const res = spawnSync(process.execPath, [COMSOL_SCRIPT, command, ...args], { encoding: "utf8" });
      assert.equal(res.status, 1);
      assert.match(res.stderr, /requires --spec|Choose either/);
      assert.doesNotMatch(res.stderr, /TypeError|ERR_INVALID_ARG_TYPE/);
    }
  }
});

test("11. Physics Understanding & Well-Posedness Validation: catches underconstrained PDEs, conflicting BCs, dimension mismatches & missing coupled properties", () => {
  const presets = comsol.listPhysicsPresets();
  assert.equal(presets.length, 3);
  for (const p of presets) {
    const presetObj = comsol.getPhysicsPreset(p.name);
    const val = comsol.validatePhysicsSpec(presetObj.spec);
    assert.equal(val.valid, true, `Preset ${p.name} should be valid: ${val.errors.join("; ")}`);
  }

  // Construct an ill-posed physics spec with:
  // 1) SolidMechanics without Fixed/PrescribedDisplacement in Stationary study -> UNDERCONSTRAINED_PHYSICS
  // 2) Duplicate Dirichlet TemperatureBoundary on sel_left -> CONFLICTING_BOUNDARY_CONDITIONS
  // 3) Boundary feature HeatFluxBoundary applied to a 3D domain selection -> DIMENSION_MISMATCH
  // 4) ThermalExpansion coupling missing thermalexpansioncoefficient in material -> MISSING_MATERIAL_PROPERTY
  // 5) NonIsothermalFlow referencing nonexistent LaminarFlow tag -> MISSING_COUPLED_PHYSICS
  const badSpec = {
    dimension: 3,
    study: { type: "Stationary" },
    geometry: {
      parameters: { L: "10[mm]" },
      features: [{ tag: "blk1", type: "Block", size: ["L", "L", "L"], selresult: true }],
      selections: [
        { tag: "sel_left", type: "FaceBox", feature: "blk1", face: "left" },
        { tag: "sel_right", type: "FaceBox", feature: "blk1", face: "right" }
      ]
    },
    materials: [
      {
        tag: "mat1",
        selection: "all",
        properties: {
          thermalconductivity: "100[W/(m*K)]",
          density: "2700[kg/m^3]",
          heatcapacity: "900[J/(kg*K)]",
          youngsmodulus: "70e9[Pa]",
          poissonsratio: "0.33"
          // missing thermalexpansioncoefficient!
        }
      }
    ],
    physics: [
      {
        tag: "ht",
        type: "HeatTransfer",
        features: [
          { tag: "temp_a", type: "TemperatureBoundary", selection: "sel_left", props: { T0: "300[K]" } },
          { tag: "temp_b", type: "TemperatureBoundary", selection: "sel_left", props: { T0: "400[K]" } },
          { tag: "hf_wrong_dim", type: "HeatFluxBoundary", selection: "blk1", props: { q0: "1000[W/m^2]" } }
        ]
      },
      {
        tag: "solid",
        type: "SolidMechanics",
        features: [
          { tag: "load1", type: "BoundaryLoad", selection: "sel_right", props: { FperArea: ["0", "0", "-1e5[Pa]"] } }
        ]
      }
    ],
    couplings: [
      { tag: "te1", type: "ThermalExpansion", physics: { HeatTransfer: "ht", SolidMechanics: "solid" } },
      { tag: "nitf_bad", type: "NonIsothermalFlow", physics: { HeatTransfer: "ht", LaminarFlow: "spf_missing" } }
    ]
  };

  const check = comsol.validatePhysicsSpec(badSpec);
  assert.equal(check.valid, false);
  assert.ok(check.errors.some(e => e.includes("UNDERCONSTRAINED_PHYSICS") && e.includes("solid")));
  assert.ok(check.errors.some(e => e.includes("CONFLICTING_BOUNDARY_CONDITIONS") && e.includes("sel_left")));
  assert.ok(check.errors.some(e => e.includes("DIMENSION_MISMATCH") && e.includes("hf_wrong_dim")));
  assert.ok(check.errors.some(e => e.includes("MISSING_MATERIAL_PROPERTY") && e.includes("thermalexpansioncoefficient")));
  assert.ok(check.errors.some(e => e.includes("MISSING_COUPLED_PHYSICS") && e.includes("spf_missing")));
});

test("12. Physics Tuning Engine (tunePhysicsSpec): adjusts parameters, initial values, boundary overrides, couplings & continuation study ramps", () => {
  const basePreset = comsol.getPhysicsPreset("thermo-mechanical-bracket");
  const patch = {
    parameters: { T_root: "450[K]", F_tip: "-8e5[N/m^2]" },
    autoAlignInitialValues: true,
    boundaryOverrides: [
      {
        physicsTag: "ht",
        featureTag: "conv1",
        type: "ConvectiveHeatFlux",
        selection: "sel_top",
        props: { h: "120[W/(m^2*K)]", Text: "293.15[K]" }
      }
    ],
    studyTuning: {
      rampParam: "F_tip",
      rampValues: ["-1e5[N/m^2]", "-4e5[N/m^2]", "-8e5[N/m^2]"]
    }
  };

  const tunedRes = comsol.tunePhysicsSpec(basePreset.spec, patch);
  assert.equal(tunedRes.status, "TUNED_PHYSICS_SPEC");
  assert.equal(tunedRes.validation.valid, true, tunedRes.validation.errors.join("; "));
  assert.equal(tunedRes.tunedSpec.parameters.T_root, "450[K]");
  // autoAlignInitialValues sets ht initialValues.T to the first TemperatureBoundary T0 ("T_root")
  assert.equal(tunedRes.tunedSpec.physics.find(p => p.tag === "ht").initialValues.T, "T_root");

  // Verify conv1 was updated with h = 120[W/(m^2*K)]
  const htFeatures = tunedRes.tunedSpec.physics.find(p => p.tag === "ht").features;
  const convFeat = htFeatures.find(f => f.tag === "conv1");
  assert.equal(convFeat.type, "ConvectiveHeatFlux");
  assert.equal(convFeat.props.h, "120[W/(m^2*K)]");

  // Verify compiled Java includes continuation ramp and Robin convective boundary condition
  const compiled = comsol.compilePhysicsSpecToJava(tunedRes.tunedSpec);
  assert.equal(compiled.status, "COMPILED_PHYSICS_JAVA");
  assert.ok(compiled.javaCode.includes('.set("FluxType", "ConvectiveHeatFlux")'));
  assert.ok(compiled.javaCode.includes('.set("useparam", true)'));
  assert.ok(compiled.javaCode.includes('.set("pname", new String[]{"F_tip"})'));
  assert.equal(comsol.validateJavaModelSource(compiled.javaCode, compiled.className).valid, true);
});

test("13. Multiphysics Java Generation across all 3 presets (Conjugate Heat Transfer, Thermo-Mechanical, Joule Heating) passes full Geometry + Physics audits", () => {
  for (const presetName of ["conjugate-heat-microchannel", "thermo-mechanical-bracket", "joule-heating-busbar"]) {
    const preset = comsol.getPhysicsPreset(presetName);
    const compiled = comsol.compilePhysicsSpecToJava(preset.spec);
    assert.equal(compiled.status, "COMPILED_PHYSICS_JAVA");
    assert.equal(compiled.validation.valid, true);
    assert.equal(compiled.geometryAudit.valid, true);
    assert.equal(compiled.physicsAudit.valid, true);
    const fullCheck = comsol.validateJavaModelSource(compiled.javaCode, compiled.className);
    assert.equal(fullCheck.valid, true, `Preset ${presetName} failed static check: ${fullCheck.issues.join("; ")}`);
  }
});

test("14. Java Physics Audit (auditJavaPhysicsCode) & Physics CLI commands catch scalar loads, unconstrained physics & unbound couplings", t => {
  const buggyPhysJava = `
    import com.comsol.model.*;
    import com.comsol.model.util.*;
    public class BuggyPhys {
      public static void main(String[] args) {
        Model model = ModelUtil.create("Model");
        model.component().create("comp1", true);
        GeomSequence geom = model.component("comp1").geom().create("geom1", 3);
        geom.create("blk1", "Block");
        geom.feature("blk1").set("size", new String[]{"1", "1", "1"});
        geom.run("fin");
        model.component("comp1").physics().create("solid", "SolidMechanics", "geom1");
        model.component("comp1").physics("solid").create("bld1", "BoundaryLoad", 2);
        model.component("comp1").physics("solid").feature("bld1").set("FperArea", "1000[Pa]");
        model.component("comp1").multiphysics().create("te1", "ThermalExpansion", 3);
      }
    }
  `;
  const audit = comsol.auditJavaPhysicsCode(buggyPhysJava);
  assert.equal(audit.valid, false);
  assert.ok(audit.errors.some(e => e.includes("FperArea") && e.includes("new String[]{...}")));
  assert.ok(audit.errors.some(e => e.includes("Physics 'SolidMechanics' ('solid') has no Dirichlet/reference constraint")));
  assert.ok(audit.errors.some(e => e.includes("Multiphysics coupling 'ThermalExpansion' ('te1') is missing")));

  // Verify comments are ignored by auditJavaPhysicsCode
  const commentedOut = `// model.component("comp1").physics("solid").feature("bld1").set("FperArea", "1000[Pa]");`;
  assert.equal(comsol.auditJavaPhysicsCode(commentedOut).valid, true);

  // Verify Physics CLI commands (list-physics-presets, validate-physics, build-physics)
  const root = makeTempDir();
  t.after(() => cleanupDir(root));
  const outJava = path.join(root, "BusbarPhys.java");
  const buildRes = spawnSync(
    process.execPath,
    [COMSOL_SCRIPT, "build-physics", "--preset", "joule-heating-busbar", "--out", outJava],
    { encoding: "utf8" }
  );
  assert.equal(buildRes.status, 0, buildRes.stderr);
  assert.equal(fs.existsSync(outJava), true);

  const auditCli = spawnSync(
    process.execPath,
    [COMSOL_SCRIPT, "audit-physics", "--source", outJava],
    { encoding: "utf8" }
  );
  assert.equal(auditCli.status, 0, auditCli.stderr);
  assert.equal(JSON.parse(auditCli.stdout).valid, true);
});

test("15. Unified COMSOL Pipeline: Geometry & Physics sub-modules operate as one integrated system (shared presets, inline FaceBox synthesis, joint geometry+physics tuning & cross-validation)", () => {
  // 1) Verify submodules are attached to comsol main module
  assert.ok(comsol.submodules.geometry);
  assert.ok(comsol.submodules.physics);
  assert.ok(comsol.submodules.templates);

  // 2) conjugate-heat-microchannel directly composes the microchannel-heatsink geometry preset (with Difference blk_sink - blk_chan1/2)
  const unifiedPreset = comsol.getModelPreset("conjugate-heat-microchannel");
  const compiled = comsol.compileModelSpecToJava(unifiedPreset.spec);
  assert.equal(compiled.status, "COMPILED_PHYSICS_JAVA");
  assert.ok(compiled.javaCode.includes('.selection("input2").set(new String[]{"blk_chan1", "blk_chan2"})'));
  assert.ok(compiled.javaCode.includes('.multiphysics().create("nitf1", "NonIsothermalFlow", 3)'));

  // 3) Inline geometric selector { feature: "blk_sink", face: "top" } on a physics boundary condition automatically synthesizes a coordinate FaceBox selection
  //    AND tuning geometry parameter L_sink from 10[mm] to 25[mm] recomputes the 3D AABB (xmax moves to 0.025m) and updates FaceBox selections!
  const tuned = comsol.tuneModelSpec(unifiedPreset.spec, {
    parameters: { L_sink: "25[mm]", U_in: "0.45[m/s]" },
    addFeatures: {
      ht: [
        {
          tag: "conv_top",
          type: "ConvectiveHeatFlux",
          selection: { feature: "blk_sink", face: "top" },
          props: { h: "50[W/(m^2*K)]", Text: "293.15[K]" }
        }
      ]
    }
  });
  assert.equal(tuned.validation.valid, true, tuned.validation.errors.join("; "));
  assert.ok(Math.abs(tuned.validation.geometryValidation.boundsByTag.blk_sink.xmax - 0.025) < 1e-9);
  const tunedCompiled = comsol.compileModelSpecToJava(tuned.spec);
  assert.ok(tunedCompiled.javaCode.includes('.selection().create("sel_auto_blk_sink_top", "Box")'));
  assert.ok(tunedCompiled.javaCode.includes('.feature("conv_top").selection().named("sel_auto_blk_sink_top")'));
  assert.ok(tunedCompiled.javaCode.includes('"0.025001"')); // updated xmax FaceBox bound for L_sink = 25[mm]

  // 4) Unified validation catches both geometry errors (disjoint Difference) AND dangling selection names in physics
  const brokenUnified = comsol.tuneModelSpec(unifiedPreset.spec, {
    addFeatures: {
      ht: [{ tag: "bad_sel", type: "HeatFluxBoundary", selection: "sel_nonexistent", props: { q0: "10[W/m^2]" } }]
    }
  });
  assert.equal(brokenUnified.validation.valid, false);
  assert.ok(brokenUnified.validation.errors.some(e => e.includes("UNKNOWN_SELECTION") && e.includes("sel_nonexistent")));
});


