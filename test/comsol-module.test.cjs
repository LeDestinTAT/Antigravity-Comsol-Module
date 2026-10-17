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
  assert.ok(geomErr.remediationHint.includes("geom.run()"));

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
