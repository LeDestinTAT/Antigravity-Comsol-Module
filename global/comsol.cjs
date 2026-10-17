const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const TEMPLATES_MOD = require(path.join(__dirname, "comsol-templates.cjs"));
const GEOM_MOD = require(path.join(__dirname, "comsol-geometry.cjs"));
const PHYS_MOD = require(path.join(__dirname, "comsol-physics.cjs"));

function getHomeDir(overrideHome) {
  if (overrideHome) return path.resolve(overrideHome);
  return process.env.DUAL_AGENT_HOME
    ? path.resolve(process.env.DUAL_AGENT_HOME)
    : path.join(os.homedir(), ".dual-agent");
}

function detectDualAgentBridge(overrideHome) {
  const homeDir = getHomeDir(overrideHome);
  const installedClient = path.join(homeDir, "client.cjs");
  const installedBridge = path.join(homeDir, "bridge.cjs");
  const siblingClient = path.join(__dirname, "client.cjs");
  const siblingBridge = path.join(__dirname, "bridge.cjs");

  const clientPath = fs.existsSync(installedClient)
    ? installedClient
    : fs.existsSync(siblingClient)
      ? siblingClient
      : null;
  const bridgePath = fs.existsSync(installedBridge)
    ? installedBridge
    : fs.existsSync(siblingBridge)
      ? siblingBridge
      : null;

  const available = Boolean(clientPath && bridgePath);
  return {
    available,
    homeDir,
    clientPath,
    bridgePath,
    integrationMode: available ? "merged-dual-agent" : "standalone"
  };
}

function detectPythonMph() {
  if (process.env.COMSOL_DISABLE_PYTHON_SCAN === "1") {
    return { available: false, pythonPath: null, mphVersion: null };
  }
  const candidates = process.env.COMSOL_PYTHON_BIN
    ? [process.env.COMSOL_PYTHON_BIN]
    : ["python", "python3"];

  for (const bin of candidates) {
    const res = spawnSync(
      bin,
      ["-c", "import mph, json; print(json.dumps({'version': getattr(mph, '__version__', 'installed')}))"],
      { encoding: "utf8", windowsHide: true, timeout: 2500 }
    );
    if (res.status === 0 && res.stdout) {
      try {
        const parsed = JSON.parse(res.stdout.trim());
        return {
          available: true,
          pythonPath: bin,
          mphVersion: parsed.version || "installed"
        };
      } catch (_) {}
    }
  }
  return { available: false, pythonPath: null, mphVersion: null };
}

function findComsolCandidateRoots(customRoot) {
  const candidates = [];
  const envRoot = customRoot !== undefined ? customRoot : process.env.COMSOL_ROOT;
  if (envRoot && typeof envRoot === "string" && envRoot.trim()) {
    candidates.push(path.resolve(envRoot.trim()));
  }

  if (customRoot === undefined && !process.env.COMSOL_DISABLE_SYSTEM_SCAN) {
    const parentDirs = [
      "C:\\Program Files\\COMSOL",
      "D:\\Program Files\\COMSOL",
      "E:\\Program Files\\COMSOL",
      "C:\\COMSOL",
      "D:\\COMSOL",
      "E:\\COMSOL",
      "/usr/local/comsol",
      "/opt/comsol"
    ];
    for (const parent of parentDirs) {
      if (!fs.existsSync(parent)) continue;
      try {
        const subdirs = fs
          .readdirSync(parent, { withFileTypes: true })
          .filter(d => d.isDirectory() && /^comsol/i.test(d.name))
          .map(d => {
            const full = path.join(parent, d.name);
            const multi = path.join(full, "Multiphysics");
            return fs.existsSync(multi) ? [multi, full] : [full];
          })
          .flat()
          .sort()
          .reverse();
        candidates.push(...subdirs);
        candidates.push(parent);
      } catch (_) {}
    }
  }

  return [...new Set(candidates)];
}

function resolveComsolBinaries(rootDir) {
  const isWin = process.platform === "win32";
  const binRelDirs = isWin ? [path.join("bin", "win64"), "bin"] : [path.join("bin", "glnxa64"), "bin"];
  const names = isWin
    ? {
        comsolbatch: "comsolbatch.exe",
        comsolcompile: "comsolcompile.exe",
        comsolmphserver: "comsolmphserver.exe"
      }
    : {
        comsolbatch: "comsolbatch",
        comsolcompile: "comsolcompile",
        comsolmphserver: "comsolmphserver"
      };

  for (const rel of binRelDirs) {
    const batchPath = path.join(rootDir, rel, names.comsolbatch);
    if (fs.existsSync(batchPath)) {
      const compilePath = path.join(rootDir, rel, names.comsolcompile);
      const serverPath = path.join(rootDir, rel, names.comsolmphserver);
      return {
        comsolbatch: batchPath,
        comsolcompile: fs.existsSync(compilePath) ? compilePath : null,
        comsolmphserver: fs.existsSync(serverPath) ? serverPath : null
      };
    }
  }
  return null;
}

function inferComsolVersion(rootDir) {
  if (!rootDir) return null;
  const match = rootDir.match(/comsol\s*([0-9]+(?:\.[0-9]+)?[a-z]?)/i);
  if (!match) return path.basename(rootDir);
  const raw = match[1];
  if (/^\d{2}[a-z]?$/i.test(raw)) {
    return `${raw[0]}.${raw.slice(1)}`;
  }
  return raw;
}

function detectComsolEnvironment(options = {}) {
  const dualAgentBridge = detectDualAgentBridge(options.homeDir);
  const pythonMph = options.includePython ? detectPythonMph() : { available: false, skipped: true };
  const roots = findComsolCandidateRoots(options.comsolRoot);

  for (const root of roots) {
    const bins = resolveComsolBinaries(root);
    if (bins && bins.comsolbatch) {
      const capabilities = ["comsolbatch"];
      if (bins.comsolcompile) capabilities.push("java-api-compile");
      if (bins.comsolmphserver) capabilities.push("mphserver");
      if (pythonMph.available) capabilities.push("python-mph");

      return {
        installed: true,
        comsolRoot: root,
        version: inferComsolVersion(root),
        binaries: bins,
        capabilities,
        readyMode: "comsolbatch",
        pythonMph,
        dualAgentBridge
      };
    }
  }

  return {
    installed: false,
    comsolRoot: null,
    version: null,
    binaries: {
      comsolbatch: null,
      comsolcompile: null,
      comsolmphserver: null
    },
    capabilities: ["dry-run", "java-static-validation", "templates"],
    readyMode: "dry-run-only",
    pythonMph,
    dualAgentBridge
  };
}

function normalizeParams(params = {}) {
  const out = {};
  if (Array.isArray(params)) {
    for (const item of params) {
      const str = String(item || "").trim();
      if (!str) continue;
      const eqIdx = str.indexOf("=");
      if (eqIdx <= 0) {
        throw new Error(`Invalid parameter "${str}" (expected key=value)`);
      }
      const k = str.slice(0, eqIdx).trim();
      const v = str.slice(eqIdx + 1).trim();
      if (!k) throw new Error(`Empty parameter name in "${str}"`);
      out[k] = v;
    }
    return out;
  }
  if (params && typeof params === "object") {
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      out[String(k).trim()] = String(v).trim();
    }
  }
  return out;
}

function buildBatchArgs({ inputFile, outputFile, study, job, params = {}, batchLog } = {}) {
  if (!inputFile || typeof inputFile !== "string" || !inputFile.trim()) {
    throw new Error("Missing required inputFile (.mph or compiled .class path)");
  }
  const resolvedInput = path.resolve(inputFile.trim());
  const resolvedOutput = outputFile ? path.resolve(String(outputFile).trim()) : null;
  const resolvedLog = batchLog ? path.resolve(String(batchLog).trim()) : null;
  const parsedParams = normalizeParams(params);

  const args = ["-inputfile", resolvedInput];
  if (resolvedOutput) {
    args.push("-outputfile", resolvedOutput);
  }
  if (study && String(study).trim()) {
    args.push("-study", String(study).trim());
  }
  if (job && String(job).trim()) {
    args.push("-job", String(job).trim());
  }

  const paramKeys = Object.keys(parsedParams);
  if (paramKeys.length > 0) {
    const paramVals = paramKeys.map(k => parsedParams[k]);
    args.push("-pname", paramKeys.join(","), "-plist", paramVals.join(","));
  }

  if (resolvedLog) {
    args.push("-batchlog", resolvedLog);
  }

  return {
    args,
    parsedParams,
    resolvedInput,
    resolvedOutput,
    resolvedLog
  };
}

function compactLogExcerpt(rawText, maxChars = 800) {
  const lines = String(rawText || "")
    .split(/\r?\n/)
    .map(l => l.trimEnd())
    .filter((line, idx, arr) => line.trim() !== "" && (idx === 0 || line !== arr[idx - 1]));

  const joined = lines.join("\n").trim();
  if (joined.length <= maxChars) return joined;
  return joined.slice(-maxChars);
}

const LOG_RULES = [
  {
    status: "GEOMETRY_ERROR",
    summary: "COMSOL geometry construction or boolean operation failure",
    patterns: [
      /failed to build feature/i,
      /geometry error/i,
      /boolean operation failed/i,
      /empty selection in geometry/i
    ]
  },
  {
    status: "MESH_ERROR",
    summary: "COMSOL mesh generation or element quality failure",
    patterns: [
      /failed to generate mesh/i,
      /inverted mesh element/i,
      /mesh error/i,
      /could not mesh/i,
      /intersecting face elements/i
    ]
  },
  {
    status: "PARAMETER_ERROR",
    summary: "COMSOL model parameter, unit, or expression evaluation failure",
    patterns: [
      /unknown parameter/i,
      /undefined variable/i,
      /syntax error in expression/i,
      /unknown model parameter/i,
      /duplicate parameter name/i,
      /inconsistent units/i
    ]
  },
  {
    status: "SOLVER_NONCONVERGENCE",
    summary: "COMSOL solver failed to converge or encountered a singular/ill-conditioned matrix",
    patterns: [
      /failed to find a solution/i,
      /singular matrix/i,
      /nonlinear solver did not converge/i,
      /did not converge/i,
      /maximum number of newton iterations/i,
      /out of memory/i,
      /\bnan\b/i
    ]
  },
  {
    status: "LICENSE_OR_ENV_ERROR",
    summary: "COMSOL license or runtime environment failure",
    patterns: [/license error/i, /could not obtain license/i, /no license for/i]
  }
];

function parseComsolLog(logText, exitCode = 0) {
  const text = String(logText || "");
  const matchedSignals = [];
  let detectedStatus = null;
  let detectedSummary = null;

  for (const rule of LOG_RULES) {
    for (const regex of rule.patterns) {
      const m = text.match(regex);
      if (m) {
        matchedSignals.push(m[0]);
        if (!detectedStatus) {
          detectedStatus = rule.status;
          detectedSummary = rule.summary;
        }
      }
    }
  }

  if (!detectedStatus) {
    if (exitCode && exitCode !== 0) {
      detectedStatus = "UNKNOWN_ERROR";
      detectedSummary = `COMSOL batch exited with non-zero code (${exitCode})`;
    } else if (/\berror\b|\bfailure\b/i.test(text) && !/0 errors/i.test(text)) {
      detectedStatus = "UNKNOWN_ERROR";
      detectedSummary = "COMSOL log reported an unclassified error";
    } else {
      detectedStatus = "COMPLETED";
      detectedSummary = "COMSOL batch simulation completed cleanly";
    }
  }

  return {
    status: detectedStatus,
    summary: detectedSummary,
    remediationHint: TEMPLATES_MOD.REMEDIATION_HINTS[detectedStatus] || null,
    matchedSignals: [...new Set(matchedSignals)],
    logExcerpt: compactLogExcerpt(text, 800)
  };
}

function buildCodexFixPrompt({ parseResult, inputFile, study, parsedParams }) {
  const paramStr =
    parsedParams && Object.keys(parsedParams).length > 0
      ? JSON.stringify(parsedParams)
      : "{}";
  const lines = [
    `[COMSOL Auto-Fix Request: ${parseResult.status}]`,
    `Target: ${inputFile}${study ? ` (study=${study})` : ""}`,
    `Params: ${paramStr}`,
    `Summary: ${parseResult.summary}`
  ];
  if (parseResult.remediationHint) {
    lines.push(parseResult.remediationHint);
  }
  lines.push(
    `Signals: ${(parseResult.matchedSignals || []).join(", ") || "none"}`,
    `Log Excerpt (<=800 chars):`,
    parseResult.logExcerpt || "(empty log)",
    `Task: Fix the COMSOL model script/parameters/mesh settings and return a concise 5-point report.`
  );
  return lines.join("\n");
}

function delegateFixToDualAgent({
  homeDir,
  projectDir,
  fixPrompt,
  waitForCompletion = false,
  retryCount = 1
}) {
  const bridgeInfo = detectDualAgentBridge(homeDir);
  if (!bridgeInfo.available || !bridgeInfo.clientPath) {
    return {
      delegated: false,
      integrationMode: "standalone",
      reason: "Dual-Agent Bridge (client.cjs) is not installed; returning standalone fix prompt",
      suggestedPrompt: fixPrompt
    };
  }

  const targetProject = path.resolve(projectDir || process.cwd());
  const clientCmd = waitForCompletion ? "run" : "submit";
  const cliArgs = [
    bridgeInfo.clientPath,
    clientCmd,
    "--project",
    targetProject,
    "--mode",
    "write",
    "--task-type",
    "FIX_REQUEST",
    "--retry-count",
    String(retryCount),
    "--reuse-session",
    "--prompt",
    fixPrompt
  ];

  const res = spawnSync(process.execPath, cliArgs, {
    cwd: targetProject,
    env: {
      ...process.env,
      DUAL_AGENT_HOME: bridgeInfo.homeDir
    },
    encoding: "utf8",
    windowsHide: true,
    timeout: 60000
  });

  let parsedStdout = null;
  if (res.stdout && res.stdout.trim()) {
    try {
      parsedStdout = JSON.parse(res.stdout.trim());
    } catch (_) {
      parsedStdout = res.stdout.trim();
    }
  }

  return {
    delegated: res.status === 0,
    integrationMode: "merged-dual-agent",
    exitCode: res.status,
    clientCommand: clientCmd,
    projectRoot: targetProject,
    response: parsedStdout,
    error: res.status !== 0 ? (res.stderr || res.stdout || "").trim() : null,
    suggestedPrompt: fixPrompt
  };
}

function scaffoldJavaModel({ domain = "heat-transfer", outputFile, className }) {
  const tpl = TEMPLATES_MOD.getTemplate(domain);
  if (tpl.language !== "java") {
    throw new Error(`Template '${domain}' is a ${tpl.language} template, not a Java model template`);
  }
  const resolvedOut = path.resolve(outputFile);
  const inferredClass = className || path.basename(resolvedOut, ".java");
  const code = tpl.code.replace(/public\s+class\s+[A-Za-z0-9_]+/, `public class ${inferredClass}`);
  fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
  fs.writeFileSync(resolvedOut, code, "utf8");
  const validation = TEMPLATES_MOD.validateJavaModelSource(code, inferredClass);
  return {
    status: "SCAFFOLDED",
    domain,
    className: inferredClass,
    outputFile: resolvedOut,
    validation
  };
}

function compileComsolJava(options = {}) {
  const {
    sourceFile,
    dryRun = false,
    autoFix = false,
    waitForFix = false,
    retryCount = 1,
    projectDir = process.cwd(),
    homeDir,
    comsolRoot,
    mockCmd,
    timeoutMs = 120000
  } = options;

  if (typeof sourceFile !== "string" || !sourceFile.trim() || !fs.existsSync(sourceFile) || !fs.statSync(sourceFile).isFile()) {
    throw new Error(`Missing Java source file: ${sourceFile || "(none)"}`);
  }

  const resolvedSource = path.resolve(sourceFile);
  const expectedClassName = path.basename(resolvedSource, ".java");
  const expectedClassFile = path.join(path.dirname(resolvedSource), `${expectedClassName}.class`);
  const sourceCode = fs.readFileSync(resolvedSource, "utf8");
  const staticCheck = TEMPLATES_MOD.validateJavaModelSource(sourceCode, expectedClassName);
  const env = detectComsolEnvironment({ homeDir, comsolRoot });

  if (!staticCheck.valid) {
    const parseResult = {
      status: "COMPILE_ERROR",
      summary: "COMSOL Java model failed pre-compile static validation",
      remediationHint: TEMPLATES_MOD.REMEDIATION_HINTS.COMPILE_ERROR,
      matchedSignals: staticCheck.issues,
      logExcerpt: staticCheck.issues.join("\n")
    };
    let delegatedFix = null;
    if (autoFix) {
      const fixPrompt = buildCodexFixPrompt({
        parseResult,
        inputFile: resolvedSource,
        study: null,
        parsedParams: {}
      });
      delegatedFix = delegateFixToDualAgent({
        homeDir,
        projectDir,
        fixPrompt,
        waitForCompletion: waitForFix,
        retryCount
      });
    }
    return {
      status: "COMPILE_ERROR",
      staticValidation: staticCheck,
      sourceFile: resolvedSource,
      classFile: null,
      delegatedFix
    };
  }

  const activeMockCmd = mockCmd !== undefined ? mockCmd : process.env.COMSOL_COMPILE_MOCK_CMD;
  const compilerBin = env.binaries.comsolcompile;

  if (dryRun || (!compilerBin && !activeMockCmd)) {
    return {
      status: "DRY_RUN",
      installed: Boolean(compilerBin),
      staticValidation: staticCheck,
      command: compilerBin || "comsolcompile.exe",
      args: [resolvedSource],
      sourceFile: resolvedSource,
      expectedClassFile
    };
  }

  let execRes;
  if (activeMockCmd) {
    const shell = process.platform === "win32" ? "cmd.exe" : "/bin/sh";
    const shellArgs =
      process.platform === "win32" ? ["/d", "/s", "/c", activeMockCmd] : ["-c", activeMockCmd];
    execRes = spawnSync(shell, shellArgs, {
      cwd: path.dirname(resolvedSource),
      env: { ...process.env, COMSOL_JAVA_SOURCE: resolvedSource },
      encoding: "utf8",
      windowsHide: true,
      timeout: timeoutMs
    });
  } else {
    execRes = spawnSync(compilerBin, [resolvedSource], {
      cwd: path.dirname(resolvedSource),
      env: process.env,
      encoding: "utf8",
      windowsHide: true,
      timeout: timeoutMs
    });
  }

  const exitCode = execRes.status ?? 1;
  const combinedOut = [execRes.stdout || "", execRes.stderr || ""].filter(Boolean).join("\n");
  if (exitCode !== 0) {
    const parseResult = {
      status: "COMPILE_ERROR",
      summary: "comsolcompile failed to compile Java model source",
      remediationHint: TEMPLATES_MOD.REMEDIATION_HINTS.COMPILE_ERROR,
      matchedSignals: ["comsolcompile exit " + exitCode],
      logExcerpt: compactLogExcerpt(combinedOut, 800)
    };
    let delegatedFix = null;
    if (autoFix) {
      const fixPrompt = buildCodexFixPrompt({
        parseResult,
        inputFile: resolvedSource,
        study: null,
        parsedParams: {}
      });
      delegatedFix = delegateFixToDualAgent({
        homeDir,
        projectDir,
        fixPrompt,
        waitForCompletion: waitForFix,
        retryCount
      });
    }
    return {
      status: "COMPILE_ERROR",
      exitCode,
      staticValidation: staticCheck,
      sourceFile: resolvedSource,
      logExcerpt: parseResult.logExcerpt,
      delegatedFix
    };
  }

  return {
    status: "COMPILED",
    exitCode: 0,
    staticValidation: staticCheck,
    sourceFile: resolvedSource,
    classFile: expectedClassFile
  };
}

function runComsolBatch(options = {}) {
  const {
    inputFile,
    outputFile,
    study,
    job,
    params = {},
    batchLog,
    dryRun = false,
    autoFix = false,
    waitForFix = false,
    retryCount = 1,
    projectDir = process.cwd(),
    homeDir,
    comsolRoot,
    mockCmd,
    timeoutMs = 300000
  } = options;

  const env = detectComsolEnvironment({ homeDir, comsolRoot });
  const built = buildBatchArgs({ inputFile, outputFile, study, job, params, batchLog });
  const activeMockCmd = mockCmd !== undefined ? mockCmd : process.env.COMSOL_MOCK_CMD;

  if (dryRun || (!env.installed && !activeMockCmd)) {
    return {
      status: "DRY_RUN",
      installed: env.installed,
      readyMode: env.readyMode,
      integrationMode: env.dualAgentBridge.integrationMode,
      command: env.binaries.comsolbatch || "comsolbatch.exe",
      args: built.args,
      parsedParams: built.parsedParams,
      inputFile: built.resolvedInput,
      outputFile: built.resolvedOutput,
      batchLog: built.resolvedLog
    };
  }

  let execRes;
  if (activeMockCmd) {
    const shell = process.platform === "win32" ? "cmd.exe" : "/bin/sh";
    const shellArgs =
      process.platform === "win32" ? ["/d", "/s", "/c", activeMockCmd] : ["-c", activeMockCmd];
    execRes = spawnSync(shell, shellArgs, {
      cwd: path.resolve(projectDir),
      env: {
        ...process.env,
        COMSOL_INPUT_FILE: built.resolvedInput,
        COMSOL_OUTPUT_FILE: built.resolvedOutput || "",
        COMSOL_BATCH_LOG: built.resolvedLog || "",
        COMSOL_STUDY: study ? String(study) : "",
        COMSOL_PARAMS_JSON: JSON.stringify(built.parsedParams),
        COMSOL_ARGS_JSON: JSON.stringify(built.args)
      },
      encoding: "utf8",
      windowsHide: true,
      timeout: timeoutMs
    });
  } else {
    execRes = spawnSync(env.binaries.comsolbatch, built.args, {
      cwd: path.resolve(projectDir),
      env: process.env,
      encoding: "utf8",
      windowsHide: true,
      timeout: timeoutMs
    });
  }

  let fileLogText = "";
  if (built.resolvedLog && fs.existsSync(built.resolvedLog)) {
    try {
      fileLogText = fs.readFileSync(built.resolvedLog, "utf8");
    } catch (_) {}
  }

  const combinedLog = [fileLogText, execRes.stdout || "", execRes.stderr || ""]
    .filter(Boolean)
    .join("\n");
  const exitCode = execRes.status ?? 1;
  const parseResult = parseComsolLog(combinedLog, exitCode);

  let delegatedFix = null;
  const isRecoverableFailure = [
    "GEOMETRY_ERROR",
    "MESH_ERROR",
    "SOLVER_NONCONVERGENCE",
    "PARAMETER_ERROR",
    "UNKNOWN_ERROR"
  ].includes(parseResult.status);

  if (isRecoverableFailure && autoFix) {
    const fixPrompt = buildCodexFixPrompt({
      parseResult,
      inputFile: built.resolvedInput,
      study,
      parsedParams: built.parsedParams
    });
    delegatedFix = delegateFixToDualAgent({
      homeDir,
      projectDir,
      fixPrompt,
      waitForCompletion: waitForFix,
      retryCount
    });
  }

  return {
    status: parseResult.status,
    summary: parseResult.summary,
    remediationHint: parseResult.remediationHint,
    matchedSignals: parseResult.matchedSignals,
    logExcerpt: parseResult.logExcerpt,
    exitCode,
    installed: env.installed,
    integrationMode: env.dualAgentBridge.integrationMode,
    command: activeMockCmd || env.binaries.comsolbatch,
    args: built.args,
    parsedParams: built.parsedParams,
    delegatedFix
  };
}

function parseCliArgs(argv) {
  const args = { _: [], param: [], expr: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        if (key === "param" || key === "expr") {
          args[key].push(next);
        } else {
          args[key] = next;
        }
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

function listModelPresets() {
  return {
    geometryPresets: GEOM_MOD.listGeometryPresets(),
    physicsPresets: PHYS_MOD.listPhysicsPresets()
  };
}

function getModelPreset(name) {
  const key = String(name || "").toLowerCase().trim();
  if (Object.prototype.hasOwnProperty.call(PHYS_MOD.PHYSICS_PRESETS, key)) {
    return { kind: "physics", ...PHYS_MOD.getPhysicsPreset(key) };
  }
  if (Object.prototype.hasOwnProperty.call(GEOM_MOD.GEOMETRY_PRESETS, key)) {
    return { kind: "geometry", ...GEOM_MOD.getGeometryPreset(key) };
  }
  throw new Error(
    `Unknown model preset '${name}'. Available: ${[
      ...Object.keys(PHYS_MOD.PHYSICS_PRESETS),
      ...Object.keys(GEOM_MOD.GEOMETRY_PRESETS)
    ].join(", ")}`
  );
}

function validateModelSpec(spec = {}) {
  if (spec && Array.isArray(spec.physics) && spec.physics.length > 0) {
    return PHYS_MOD.validatePhysicsSpec(spec);
  }
  return GEOM_MOD.validateGeometrySpec(spec && spec.geometry ? spec.geometry : spec);
}

function tuneModelSpec(spec = {}, adjustments = {}) {
  return PHYS_MOD.tunePhysicsSpec(spec, adjustments);
}

function compileModelSpecToJava(spec = {}, options = {}) {
  if (spec && Array.isArray(spec.physics) && spec.physics.length > 0) {
    return PHYS_MOD.compilePhysicsSpecToJava(spec, options);
  }
  return GEOM_MOD.compileGeometrySpecToJava(spec && spec.geometry ? spec.geometry : spec, options);
}

function auditJavaModelCode(sourceCode, expectedClassName) {
  return TEMPLATES_MOD.validateJavaModelSource(sourceCode, expectedClassName);
}

function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const cmd = args._[0] || "doctor";

  try {
    if (cmd === "doctor") {
      const env = detectComsolEnvironment({
        homeDir: args.home || undefined,
        comsolRoot: args["comsol-root"] !== undefined ? args["comsol-root"] : undefined,
        includePython: Boolean(args["check-python"])
      });
      console.log(JSON.stringify(env, null, 2));
      return;
    }

    if (cmd === "list-templates") {
      console.log(JSON.stringify(TEMPLATES_MOD.listTemplates(), null, 2));
      return;
    }

    if (cmd === "list-presets") {
      console.log(JSON.stringify(listModelPresets(), null, 2));
      return;
    }

    if (cmd === "list-geometry-presets") {
      console.log(JSON.stringify(GEOM_MOD.listGeometryPresets(), null, 2));
      return;
    }

    if (cmd === "validate-geometry") {
      const specFile = args.spec || args.input || args._[1];
      const presetName = args.preset;
      if ((specFile !== undefined && (typeof specFile !== "string" || !specFile.trim())) ||
          (presetName !== undefined && (typeof presetName !== "string" || !presetName.trim())) ||
          (!specFile && !presetName)) {
        throw new Error(cmd + " requires --spec <spec.json> or --preset <name>");
      }
      if (specFile && presetName) throw new Error("Choose either --spec or --preset, not both");
      const spec = presetName
        ? GEOM_MOD.getGeometryPreset(presetName).spec
        : JSON.parse(fs.readFileSync(specFile, "utf8"));
      const res = GEOM_MOD.validateGeometrySpec(spec);
      console.log(JSON.stringify(res, null, 2));
      if (!res.valid) process.exit(2);
      return;
    }

    if (cmd === "build-geometry") {
      const specFile = args.spec || args.input;
      const presetName = args.preset;
      if ((specFile !== undefined && (typeof specFile !== "string" || !specFile.trim())) ||
          (presetName !== undefined && (typeof presetName !== "string" || !presetName.trim())) ||
          (!specFile && !presetName)) {
        throw new Error(cmd + " requires --spec <spec.json> or --preset <name>");
      }
      if (specFile && presetName) throw new Error("Choose either --spec or --preset, not both");
      const spec = presetName
        ? GEOM_MOD.getGeometryPreset(presetName).spec
        : JSON.parse(fs.readFileSync(specFile, "utf8"));
      const outPath = args.out || args.output || args._[1];
      const className =
        args.class ||
        args["class-name"] ||
        (outPath ? path.basename(outPath, ".java") : spec.className || "Comsol62GeometryModel");
      const compiled = GEOM_MOD.compileGeometrySpecToJava(spec, { className });
      if (compiled.status !== "COMPILED_GEOMETRY_JAVA") {
        console.log(JSON.stringify(compiled, null, 2));
        process.exit(2);
      }
      let resolvedOut = null;
      if (outPath) {
        resolvedOut = path.resolve(outPath);
        fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
        fs.writeFileSync(resolvedOut, compiled.javaCode, "utf8");
      }
      console.log(
        JSON.stringify(
          {
            status: compiled.status,
            className: compiled.className,
            outputFile: resolvedOut,
            validation: compiled.validation,
            javaCode: resolvedOut ? undefined : compiled.javaCode
          },
          null,
          2
        )
      );
      return;
    }

    if (cmd === "audit-geometry") {
      const sourceFile = args.source || args.input || args._[1];
      if (typeof sourceFile !== "string" || !sourceFile.trim() || !fs.existsSync(sourceFile) || !fs.statSync(sourceFile).isFile()) {
        throw new Error(`Missing Java source file: ${sourceFile || "(none)"}`);
      }
      const code = fs.readFileSync(sourceFile, "utf8");
      const res = GEOM_MOD.auditJavaGeometryCode(code);
      console.log(JSON.stringify(res, null, 2));
      if (!res.valid) process.exit(2);
      return;
    }

    if (cmd === "list-physics-presets") {
      console.log(JSON.stringify(PHYS_MOD.listPhysicsPresets(), null, 2));
      return;
    }

    if (cmd === "validate-physics" || cmd === "validate-model") {
      const specFile = args.spec || args.input || args._[1];
      const presetName = args.preset;
      if ((specFile !== undefined && (typeof specFile !== "string" || !specFile.trim())) ||
          (presetName !== undefined && (typeof presetName !== "string" || !presetName.trim())) ||
          (!specFile && !presetName)) {
        throw new Error(cmd + " requires --spec <spec.json> or --preset <name>");
      }
      if (specFile && presetName) throw new Error("Choose either --spec or --preset, not both");
      const spec = presetName
        ? (cmd === "validate-model" ? getModelPreset(presetName).spec : PHYS_MOD.getPhysicsPreset(presetName).spec)
        : JSON.parse(fs.readFileSync(specFile, "utf8"));
      const res = cmd === "validate-model" ? validateModelSpec(spec) : PHYS_MOD.validatePhysicsSpec(spec);
      console.log(JSON.stringify(res, null, 2));
      if (!res.valid) process.exit(2);
      return;
    }

    if (cmd === "tune-physics" || cmd === "tune-model") {
      const specFile = args.spec || args.input;
      const presetName = args.preset;
      if ((specFile !== undefined && (typeof specFile !== "string" || !specFile.trim())) ||
          (presetName !== undefined && (typeof presetName !== "string" || !presetName.trim())) ||
          (!specFile && !presetName)) {
        throw new Error(cmd + " requires --spec <spec.json> or --preset <name>");
      }
      if (specFile && presetName) throw new Error("Choose either --spec or --preset, not both");
      const spec = presetName
        ? (cmd === "tune-model" ? getModelPreset(presetName).spec : PHYS_MOD.getPhysicsPreset(presetName).spec)
        : JSON.parse(fs.readFileSync(specFile, "utf8"));
      const patchFile = args.patch || args.adjustments;
      const adjustments = patchFile && typeof patchFile === "string"
        ? JSON.parse(fs.readFileSync(patchFile, "utf8"))
        : {};
      if (args["auto-align-init"]) {
        adjustments.autoAlignInitialValues = true;
      }
      if (args.param && args.param.length > 0) {
        adjustments.parameters = { ...(adjustments.parameters || {}), ...normalizeParams(args.param) };
      }
      const tuned = PHYS_MOD.tunePhysicsSpec(spec, adjustments);
      const outPath = args.out || args.output;
      if (outPath && typeof outPath === "string") {
        const resolvedOut = path.resolve(outPath);
        fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
        fs.writeFileSync(resolvedOut, JSON.stringify(tuned.spec, null, 2), "utf8");
      }
      console.log(JSON.stringify(tuned, null, 2));
      if (!tuned.validation.valid) process.exit(2);
      return;
    }

    if (cmd === "build-physics" || cmd === "build-model") {
      const specFile = args.spec || args.input;
      const presetName = args.preset;
      if ((specFile !== undefined && (typeof specFile !== "string" || !specFile.trim())) ||
          (presetName !== undefined && (typeof presetName !== "string" || !presetName.trim())) ||
          (!specFile && !presetName)) {
        throw new Error(cmd + " requires --spec <spec.json> or --preset <name>");
      }
      if (specFile && presetName) throw new Error("Choose either --spec or --preset, not both");
      let spec = presetName
        ? (cmd === "build-model" ? getModelPreset(presetName).spec : PHYS_MOD.getPhysicsPreset(presetName).spec)
        : JSON.parse(fs.readFileSync(specFile, "utf8"));
      const patchFile = args.patch || args.adjustments;
      if (patchFile && typeof patchFile === "string") {
        const patchObj = JSON.parse(fs.readFileSync(patchFile, "utf8"));
        spec = PHYS_MOD.tunePhysicsSpec(spec, patchObj).spec;
      }
      const outPath = args.out || args.output || args._[1];
      const className =
        args.class ||
        args["class-name"] ||
        (outPath ? path.basename(outPath, ".java") : spec.className || "Comsol62PhysicsModel");
      const compiled =
        cmd === "build-model"
          ? compileModelSpecToJava(spec, { className })
          : PHYS_MOD.compilePhysicsSpecToJava(spec, { className });
      if (!compiled.javaCode) {
        console.log(JSON.stringify(compiled, null, 2));
        process.exit(2);
      }
      let resolvedOut = null;
      if (outPath) {
        resolvedOut = path.resolve(outPath);
        fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
        fs.writeFileSync(resolvedOut, compiled.javaCode, "utf8");
      }
      console.log(
        JSON.stringify(
          {
            status: compiled.status,
            className: compiled.className,
            outputFile: resolvedOut,
            validation: compiled.validation,
            javaCode: resolvedOut ? undefined : compiled.javaCode
          },
          null,
          2
        )
      );
      return;
    }

    if (cmd === "audit-physics") {
      const sourceFile = args.source || args.input || args._[1];
      if (typeof sourceFile !== "string" || !sourceFile.trim() || !fs.existsSync(sourceFile) || !fs.statSync(sourceFile).isFile()) {
        throw new Error(`Missing Java source file: ${sourceFile || "(none)"}`);
      }
      const code = fs.readFileSync(sourceFile, "utf8");
      const res = PHYS_MOD.auditJavaPhysicsCode(code);
      console.log(JSON.stringify(res, null, 2));
      if (!res.valid) process.exit(2);
      return;
    }

    if (cmd === "template") {
      const domain = args.domain || args._[1] || "heat-transfer";
      const tpl = TEMPLATES_MOD.getTemplate(domain);
      console.log(JSON.stringify(tpl, null, 2));
      return;
    }

    if (cmd === "scaffold-java") {
      const res = scaffoldJavaModel({
        domain: args.domain || "heat-transfer",
        outputFile: args.out || args.output || args._[1],
        className: args.class || args["class-name"]
      });
      console.log(JSON.stringify(res, null, 2));
      return;
    }

    if (cmd === "validate-java" || cmd === "audit-model") {
      const sourceFile = args.source || args.input || args._[1];
      if (typeof sourceFile !== "string" || !sourceFile.trim() || !fs.existsSync(sourceFile) || !fs.statSync(sourceFile).isFile()) {
        throw new Error(`Missing Java source file: ${sourceFile || "(none)"}`);
      }
      const code = fs.readFileSync(sourceFile, "utf8");
      const expectedClass = path.basename(sourceFile, ".java");
      const res = TEMPLATES_MOD.validateJavaModelSource(code, expectedClass);
      console.log(JSON.stringify(res, null, 2));
      if (!res.valid) process.exit(2);
      return;
    }

    if (cmd === "compile-java") {
      const res = compileComsolJava({
        sourceFile: args.source || args.input || args._[1],
        dryRun: Boolean(args["dry-run"] || args.dryrun),
        autoFix: Boolean(args["auto-fix"] || args["delegate-fix"]),
        waitForFix: Boolean(args["wait-for-fix"]),
        retryCount: args["retry-count"] ? Number(args["retry-count"]) : 1,
        projectDir: args.project || process.cwd(),
        homeDir: args.home || undefined,
        comsolRoot: args["comsol-root"] !== undefined ? args["comsol-root"] : undefined
      });
      console.log(JSON.stringify(res, null, 2));
      if (res.status === "COMPILE_ERROR") process.exit(2);
      return;
    }

    if (cmd === "parse-log") {
      const logFile = args.log || args._[1];
      if (!logFile || !fs.existsSync(logFile)) {
        throw new Error(`Missing or unreadable log file: ${logFile || "(none)"}`);
      }
      const raw = fs.readFileSync(logFile, "utf8");
      const parsed = parseComsolLog(raw, args["exit-code"] ? Number(args["exit-code"]) : 0);
      console.log(JSON.stringify(parsed, null, 2));
      if (parsed.status !== "COMPLETED") {
        process.exit(2);
      }
      return;
    }

    if (cmd === "run-batch") {
      const result = runComsolBatch({
        inputFile: args.input || args.inputfile,
        outputFile: args.output || args.outputfile,
        study: args.study,
        job: args.job,
        params: args.param,
        batchLog: args["batch-log"] || args.batchlog,
        dryRun: Boolean(args["dry-run"] || args.dryrun),
        autoFix: Boolean(args["auto-fix"] || args["delegate-fix"]),
        waitForFix: Boolean(args["wait-for-fix"]),
        retryCount: args["retry-count"] ? Number(args["retry-count"]) : 1,
        projectDir: args.project || process.cwd(),
        homeDir: args.home || undefined,
        comsolRoot: args["comsol-root"] !== undefined ? args["comsol-root"] : undefined
      });
      console.log(JSON.stringify(result, null, 2));
      if (result.status !== "COMPLETED" && result.status !== "DRY_RUN") {
        process.exit(2);
      }
      return;
    }

    throw new Error(
      `Unknown command: ${cmd}. Supported: doctor, list-presets, validate-model, tune-model, build-model, audit-model, list-templates, template, list-geometry-presets, validate-geometry, build-geometry, audit-geometry, list-physics-presets, validate-physics, tune-physics, build-physics, audit-physics, scaffold-java, validate-java, compile-java, run-batch, parse-log`
    );
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  getHomeDir,
  detectDualAgentBridge,
  detectPythonMph,
  detectComsolEnvironment,
  buildBatchArgs,
  parseComsolLog,
  buildCodexFixPrompt,
  delegateFixToDualAgent,
  scaffoldJavaModel,
  compileComsolJava,
  runComsolBatch,
  listModelPresets,
  getModelPreset,
  validateModelSpec,
  tuneModelSpec,
  compileModelSpecToJava,
  auditJavaModelCode,
  submodules: {
    geometry: GEOM_MOD,
    physics: PHYS_MOD,
    templates: TEMPLATES_MOD
  },
  ...TEMPLATES_MOD,
  ...GEOM_MOD,
  ...PHYS_MOD
};
