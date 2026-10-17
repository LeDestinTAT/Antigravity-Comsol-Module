const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const MODULE_ROOT = __dirname;
const COMSOL_RUNTIME = require(path.join(MODULE_ROOT, "global", "comsol.cjs"));

function getHomeDir() {
  return COMSOL_RUNTIME.getHomeDir();
}

function getComsolSkillPath() {
  if (process.env.COMSOL_AGENT_SKILL_PATH) {
    return path.resolve(process.env.COMSOL_AGENT_SKILL_PATH);
  }
  return path.join(os.homedir(), ".gemini", "config", "skills", "comsol-automation", "SKILL.md");
}

function writeUtf8NoBomSync(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const normalized = String(content).replace(/^\uFEFF/, "");
  const buf = Buffer.from(normalized, "utf8");
  fs.writeFileSync(filePath, buf);
  return buf;
}

function verifySkillNoBom(filePath) {
  if (!fs.existsSync(filePath)) {
    return { ok: false, error: `Missing skill file: ${filePath}` };
  }
  const buf = fs.readFileSync(filePath);
  if (buf.length < 3 || buf[0] !== 45 || buf[1] !== 45 || buf[2] !== 45) {
    return {
      ok: false,
      error: `Invalid SKILL.md header bytes at ${filePath} (expected 45,45,45 '---')`
    };
  }
  return { ok: true, first3Bytes: [buf[0], buf[1], buf[2]] };
}

function loadSkillTemplate() {
  const candidate = path.join(MODULE_ROOT, "templates", "comsol-automation", "SKILL.md");
  if (fs.existsSync(candidate)) {
    return fs.readFileSync(candidate, "utf8");
  }
  throw new Error(`COMSOL skill template not found at ${candidate}`);
}

function updateAddonsRegistry(homeDir, addonEntry, remove = false) {
  const addonsDir = path.join(homeDir, "addons");
  fs.mkdirSync(addonsDir, { recursive: true });
  const registryPath = path.join(addonsDir, "registry.json");
  let current = { addons: {} };
  if (fs.existsSync(registryPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(registryPath, "utf8"));
      if (parsed && typeof parsed === "object" && parsed.addons) {
        current = parsed;
      }
    } catch (_) {}
  }
  if (remove) {
    delete current.addons["comsol-automation"];
  } else {
    current.addons["comsol-automation"] = addonEntry;
  }
  fs.writeFileSync(registryPath, JSON.stringify(current, null, 2), "utf8");
  return registryPath;
}

function installComsolModule(options = {}) {
  const homeDir = getHomeDir();
  const skillPath = getComsolSkillPath();
  const modulesDir = path.join(homeDir, "modules");

  for (const dir of [homeDir, modulesDir, path.join(homeDir, "addons"), path.join(homeDir, "logs")]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const siblingCoreDeploy = path.join(MODULE_ROOT, "deploy.cjs");
  let mergedCoreInstall = null;
  if (options.withCore && fs.existsSync(siblingCoreDeploy)) {
    const res = spawnSync(process.execPath, [siblingCoreDeploy, "install", "--no-start", "--no-autostart"], {
      cwd: MODULE_ROOT,
      env: { ...process.env, DUAL_AGENT_HOME: homeDir },
      encoding: "utf8",
      windowsHide: true
    });
    mergedCoreInstall = {
      triggered: true,
      exitCode: res.status
    };
  }

  const srcComsol = path.join(MODULE_ROOT, "global", "comsol.cjs");
  const srcTemplates = path.join(MODULE_ROOT, "global", "comsol-templates.cjs");
  const srcGeometry = path.join(MODULE_ROOT, "global", "comsol-geometry.cjs");
  const destComsol = path.join(homeDir, "comsol.cjs");
  const destTemplates = path.join(homeDir, "comsol-templates.cjs");
  const destGeometry = path.join(homeDir, "comsol-geometry.cjs");
  fs.copyFileSync(srcComsol, destComsol);
  fs.copyFileSync(srcTemplates, destTemplates);
  fs.copyFileSync(srcGeometry, destGeometry);

  const skillText = loadSkillTemplate();
  writeUtf8NoBomSync(skillPath, skillText);
  const skillCheck = verifySkillNoBom(skillPath);
  if (!skillCheck.ok) {
    throw new Error(skillCheck.error);
  }

  const envCheck = COMSOL_RUNTIME.detectComsolEnvironment({
    homeDir,
    comsolRoot: options.comsolRoot
  });

  const manifestPath = path.join(modulesDir, "comsol.json");
  const manifest = {
    module: "comsol-automation",
    role: "addon",
    version: "0.3.0-alpha",
    installedAt: new Date().toISOString(),
    runtimePath: destComsol,
    templatesPath: destTemplates,
    geometryPath: destGeometry,
    skillPath,
    comsolInstalled: envCheck.installed,
    comsolRoot: envCheck.comsolRoot,
    comsolVersion: envCheck.version,
    capabilities: envCheck.capabilities,
    integrationMode: envCheck.dualAgentBridge.integrationMode
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  const addonsRegistryPath = updateAddonsRegistry(homeDir, manifest, false);

  return {
    status: "INSTALLED",
    module: "comsol-automation",
    role: "addon",
    homeDir,
    deployedFiles: {
      comsolRuntime: destComsol,
      comsolTemplates: destTemplates,
      comsolGeometry: destGeometry,
      moduleManifest: manifestPath,
      addonsRegistry: addonsRegistryPath,
      comsolSkill: skillPath
    },
    skillVerified: skillCheck,
    comsolEnvironment: envCheck,
    mergedCoreInstall
  };
}

function uninstallComsolModule() {
  const homeDir = getHomeDir();
  const skillPath = getComsolSkillPath();
  const destComsol = path.join(homeDir, "comsol.cjs");
  const destTemplates = path.join(homeDir, "comsol-templates.cjs");
  const destGeometry = path.join(homeDir, "comsol-geometry.cjs");
  const manifestPath = path.join(homeDir, "modules", "comsol.json");

  const removed = [];
  for (const target of [destComsol, destTemplates, destGeometry, manifestPath, skillPath]) {
    if (fs.existsSync(target)) {
      try {
        fs.unlinkSync(target);
        removed.push(target);
      } catch (_) {}
    }
  }
  updateAddonsRegistry(homeDir, null, true);

  return {
    status: "UNINSTALLED",
    module: "comsol-automation",
    homeDir,
    removedFiles: removed,
    dualAgentBridgePreserved: fs.existsSync(path.join(homeDir, "client.cjs"))
  };
}

function runDoctor(options = {}) {
  const homeDir = getHomeDir();
  const skillPath = getComsolSkillPath();
  const runtimePath = path.join(homeDir, "comsol.cjs");
  const templatesPath = path.join(homeDir, "comsol-templates.cjs");
  const geometryPath = path.join(homeDir, "comsol-geometry.cjs");
  const manifestPath = path.join(homeDir, "modules", "comsol.json");

  const runtimeExists = fs.existsSync(runtimePath);
  const templatesExists = fs.existsSync(templatesPath);
  const geometryExists = fs.existsSync(geometryPath);
  const manifestExists = fs.existsSync(manifestPath);
  const skillVerify = verifySkillNoBom(skillPath);
  const envCheck = COMSOL_RUNTIME.detectComsolEnvironment({
    homeDir,
    comsolRoot: options.comsolRoot
  });

  const healthy = runtimeExists && templatesExists && geometryExists && manifestExists && skillVerify.ok;
  return {
    healthy,
    module: "comsol-automation",
    role: "addon",
    files: {
      runtimeExists,
      templatesExists,
      geometryExists,
      manifestExists,
      skillVerify
    },
    comsolEnvironment: envCheck
  };
}

function parseCliArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}

function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const cmd = args._[0] || "install";

  try {
    if (cmd === "install") {
      const res = installComsolModule({
        comsolRoot: args["comsol-root"],
        withCore: Boolean(args["with-core"])
      });
      console.log(JSON.stringify(res, null, 2));
      return;
    }

    if (cmd === "uninstall") {
      const res = uninstallComsolModule();
      console.log(JSON.stringify(res, null, 2));
      return;
    }

    if (cmd === "doctor" || cmd === "status") {
      const doc = runDoctor({ comsolRoot: args["comsol-root"] });
      console.log(JSON.stringify(doc, null, 2));
      if (cmd === "doctor" && !doc.healthy) {
        process.exit(1);
      }
      return;
    }

    // Forward COMSOL runtime commands directly to comsol.cjs
    const targetRuntime = fs.existsSync(path.join(getHomeDir(), "comsol.cjs"))
      ? path.join(getHomeDir(), "comsol.cjs")
      : path.join(MODULE_ROOT, "global", "comsol.cjs");
    const forwarded = spawnSync(process.execPath, [targetRuntime, ...process.argv.slice(2)], {
      stdio: "inherit",
      env: process.env
    });
    process.exit(forwarded.status ?? 1);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  installComsolModule,
  uninstallComsolModule,
  runDoctor,
  verifySkillNoBom
};
