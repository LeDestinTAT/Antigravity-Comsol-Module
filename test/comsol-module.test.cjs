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
