const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const DEPLOY_COMSOL = path.resolve(__dirname, "..", "deploy-comsol.cjs");
const COMSOL_SCRIPT = path.resolve(__dirname, "..", "global", "comsol.cjs");
const comsol = require(COMSOL_SCRIPT);

function makeTempDir(prefix = "comsol-module-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanupDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 4, retryDelay: 40 });
  } catch (_) {}
}

test("1. Standalone install & uninstalled --dry-run work without Dual-Agent Bridge or COMSOL", t => {
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
  assert.equal(installed.skillVerified.ok, true);
  assert.equal(installed.comsolEnvironment.installed, false);
  assert.equal(installed.comsolEnvironment.readyMode, "dry-run-only");
  assert.equal(installed.comsolEnvironment.dualAgentBridge.integrationMode, "standalone");

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
  assert.ok(batchRes.args.includes("-plist"));
  assert.ok(batchRes.args.includes("120[um],0.8[m/s]"));
});

test("2. Simulated COMSOL installation discovery and parseComsolLog classification", t => {
  const root = makeTempDir();
  t.after(() => cleanupDir(root));

  const fakeComsolRoot = path.join(root, "COMSOL62", "Multiphysics");
  const binDir = path.join(fakeComsolRoot, "bin", process.platform === "win32" ? "win64" : "glnxa64");
  fs.mkdirSync(binDir, { recursive: true });
  const exeName = process.platform === "win32" ? "comsolbatch.exe" : "comsolbatch";
  fs.writeFileSync(path.join(binDir, exeName), "mock-binary");

  const env = comsol.detectComsolEnvironment({
    homeDir: path.join(root, "home"),
    comsolRoot: fakeComsolRoot
  });
  assert.equal(env.installed, true);
  assert.equal(env.readyMode, "comsolbatch");
  assert.ok(env.binaries.comsolbatch.endsWith(exeName));

  assert.equal(comsol.parseComsolLog("Solution time: 14 s.\n0 errors.", 0).status, "COMPLETED");
  assert.equal(
    comsol.parseComsolLog("Error: Failed to generate mesh for domain 3.\nInverted mesh element.", 1).status,
    "MESH_ERROR"
  );
  assert.equal(
    comsol.parseComsolLog("Nonlinear solver did not converge.\nFailed to find a solution.", 1).status,
    "SOLVER_NONCONVERGENCE"
  );
  assert.equal(
    comsol.parseComsolLog("Undefined variable: comp1.ht.T_inlet\nUnknown parameter.", 1).status,
    "PARAMETER_ERROR"
  );

  const noisyLog = Array.from({ length: 80 }, (_, i) => `Iteration ${i}: residual = 1e-${i}`).join("\n") +
    "\nFailed to find a solution: Singular matrix.";
  const parsedNoisy = comsol.parseComsolLog(noisyLog, 1);
  assert.equal(parsedNoisy.status, "SOLVER_NONCONVERGENCE");
  assert.ok(parsedNoisy.logExcerpt.length <= 800);
});

test("3. Separate installation + Merged Dual-Agent operation & non-destructive uninstall", t => {
  const root = makeTempDir();
  t.after(() => cleanupDir(root));

  const homeDir = path.join(root, "home");
  const skillPath = path.join(root, "skills", "comsol-automation", "SKILL.md");
  fs.mkdirSync(homeDir, { recursive: true });

  // Simulate Dual-Agent Bridge already installed in homeDir
  const mockClientPath = path.join(homeDir, "client.cjs");
  const mockBridgePath = path.join(homeDir, "bridge.cjs");
  fs.writeFileSync(
    mockClientPath,
    `console.log(JSON.stringify({ submitted: true, args: process.argv.slice(2) }));`
  );
  fs.writeFileSync(mockBridgePath, "// mock bridge");

  // Install COMSOL module on top of existing Dual-Agent homeDir
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
  const installed = JSON.parse(installRes.stdout);
  assert.equal(installed.comsolEnvironment.dualAgentBridge.integrationMode, "merged-dual-agent");

  // Simulate a failing COMSOL batch run with autoFix enabled in merged mode
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
  assert.ok(failRun.delegatedFix);
  assert.equal(failRun.delegatedFix.delegated, true);
  assert.equal(failRun.delegatedFix.response.submitted, true);

  // Uninstalling COMSOL module preserves Dual-Agent Bridge files
  const uninst = JSON.parse(
    spawnSync(process.execPath, [DEPLOY_COMSOL, "uninstall"], {
      env: { ...process.env, DUAL_AGENT_HOME: homeDir, COMSOL_AGENT_SKILL_PATH: skillPath },
      encoding: "utf8"
    }).stdout
  );
  assert.equal(uninst.status, "UNINSTALLED");
  assert.equal(uninst.dualAgentBridgePreserved, true);
  assert.equal(fs.existsSync(mockClientPath), true);
  assert.equal(fs.existsSync(mockBridgePath), true);
});
