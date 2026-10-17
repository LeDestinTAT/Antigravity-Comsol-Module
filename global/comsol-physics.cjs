const path = require("node:path");
const GEOM_MOD = require(path.join(__dirname, "comsol-geometry.cjs"));

const PHYSICS_CATALOG = {
  HeatTransfer: {
    defaultTag: "ht",
    dependentVars: ["T"],
    requiredMaterialProps: ["thermalconductivity", "density", "heatcapacity"],
    referenceBoundaryTypes: ["TemperatureBoundary", "ConvectiveHeatFlux", "DiffuseSurface"]
  },
  LaminarFlow: {
    defaultTag: "spf",
    dependentVars: ["u", "p"],
    requiredMaterialProps: ["density", "dynamicviscosity"],
    referenceBoundaryTypes: ["OutletBoundary", "PressurePointConstraint", "OpenBoundary"],
    requiredDriveTypes: ["InletBoundary", "MovingWall", "OpenBoundary"]
  },
  SolidMechanics: {
    defaultTag: "solid",
    dependentVars: ["u"],
    requiredMaterialProps: ["youngsmodulus", "poissonsratio", "density"],
    referenceBoundaryTypes: ["Fixed", "PrescribedDisplacement", "Roller", "Symmetry"]
  },
  Electrostatics: {
    defaultTag: "es",
    dependentVars: ["V"],
    requiredMaterialProps: ["relpermittivity"],
    referenceBoundaryTypes: ["Ground", "ElectricPotential"]
  },
  ElectricCurrents: {
    defaultTag: "ec",
    dependentVars: ["V"],
    requiredMaterialProps: ["electricconductivity"],
    referenceBoundaryTypes: ["Ground", "ElectricPotential"]
  }
};

const FEATURE_CATALOG = {
  // HeatTransfer
  TemperatureBoundary: { entitydim: 2, comsolType: "TemperatureBoundary", conflictGroup: "ht_dirichlet" },
  HeatFluxBoundary: { entitydim: 2, comsolType: "HeatFluxBoundary", conflictGroup: null },
  ConvectiveHeatFlux: {
    entitydim: 2,
    comsolType: "HeatFluxBoundary",
    presetProps: { FluxType: "ConvectiveHeatFlux" },
    conflictGroup: null
  },
  DiffuseSurface: { entitydim: 2, comsolType: "DiffuseSurface", conflictGroup: null },
  ThermalInsulation: { entitydim: 2, comsolType: "ThermalInsulation", conflictGroup: "ht_dirichlet" },
  HeatSource: { entitydim: 3, comsolType: "HeatSource", conflictGroup: null },
  Fluid: { entitydim: 3, comsolType: "Fluid", conflictGroup: null },

  // LaminarFlow
  InletBoundary: { entitydim: 2, comsolType: "InletBoundary", conflictGroup: "spf_bnd" },
  OutletBoundary: { entitydim: 2, comsolType: "OutletBoundary", conflictGroup: "spf_bnd" },
  Wall: { entitydim: 2, comsolType: "Wall", conflictGroup: "spf_bnd" },
  MovingWall: {
    entitydim: 2,
    comsolType: "Wall",
    presetProps: { BoundaryCondition: "MovingWall" },
    conflictGroup: "spf_bnd"
  },
  OpenBoundary: { entitydim: 2, comsolType: "OpenBoundary", conflictGroup: "spf_bnd" },
  PressurePointConstraint: { entitydim: 0, comsolType: "PressurePointConstraint", conflictGroup: null },

  // SolidMechanics
  Fixed: { entitydim: 2, comsolType: "Fixed", conflictGroup: "solid_constraint" },
  PrescribedDisplacement: {
    entitydim: 2,
    comsolType: "PrescribedDisplacement",
    conflictGroup: "solid_constraint"
  },
  Roller: { entitydim: 2, comsolType: "Roller", conflictGroup: "solid_constraint" },
  Symmetry: { entitydim: 2, comsolType: "Symmetry", conflictGroup: null },
  BoundaryLoad: { entitydim: 2, comsolType: "BoundaryLoad", conflictGroup: "solid_constraint" },
  BodyLoad: { entitydim: 3, comsolType: "BodyLoad", conflictGroup: null },

  // Electrostatics / ElectricCurrents
  Ground: { entitydim: 2, comsolType: "Ground", conflictGroup: "em_potential" },
  ElectricPotential: { entitydim: 2, comsolType: "ElectricPotential", conflictGroup: "em_potential" },
  NormalCurrentDensity: { entitydim: 2, comsolType: "NormalCurrentDensity", conflictGroup: null },
  SurfaceChargeDensity: { entitydim: 2, comsolType: "SurfaceChargeDensity", conflictGroup: null },
  CurrentSource: { entitydim: 3, comsolType: "CurrentSource", conflictGroup: null },
  SpaceChargeDensity: { entitydim: 3, comsolType: "SpaceChargeDensity", conflictGroup: null }
};

const VECTOR_PROPERTIES = new Set([
  "FperArea",
  "Ftot",
  "FperVol",
  "u0",
  "u_wall",
  "thermalconductivity"
]);

const COUPLING_CATALOG = {
  NonIsothermalFlow: {
    defaultTag: "nitf1",
    dim: 3,
    requiredInterfaces: ["LaminarFlow", "HeatTransfer"],
    requiredMaterialProps: [],
    physicsBindings: {
      Fluid_physics: "LaminarFlow",
      Heat_physics: "HeatTransfer"
    }
  },
  ThermalExpansion: {
    defaultTag: "te1",
    dim: 3,
    requiredInterfaces: ["HeatTransfer", "SolidMechanics"],
    requiredMaterialProps: ["thermalexpansioncoefficient"],
    physicsBindings: {
      Heat_physics: "HeatTransfer",
      Solid_physics: "SolidMechanics"
    }
  },
  ElectromagneticHeating: {
    defaultTag: "emh1",
    dim: 3,
    requiredInterfaces: ["ElectricCurrents", "HeatTransfer"],
    requiredMaterialProps: [],
    physicsBindings: {
      Electromagnetic_physics: "ElectricCurrents",
      Heat_physics: "HeatTransfer"
    }
  },
  FluidStructureInteraction: {
    defaultTag: "fsi1",
    dim: 3,
    requiredInterfaces: ["LaminarFlow", "SolidMechanics"],
    requiredMaterialProps: [],
    physicsBindings: {
      Fluid_physics: "LaminarFlow",
      Solid_physics: "SolidMechanics"
    }
  }
};

function resolveUnifiedModelSpec(rawSpec = {}) {
  const cloned = JSON.parse(JSON.stringify(rawSpec || {}));
  let baseGeom = null;

  const presetKey = cloned.geometryPreset || (cloned.geometry && cloned.geometry.preset);
  if (presetKey) {
    baseGeom = JSON.parse(JSON.stringify(GEOM_MOD.getGeometryPreset(presetKey).spec));
  }

  // Support unified flat spec where geometry 'features' and 'selections' sit alongside 'physics'
  if (!cloned.geometry && Array.isArray(cloned.features)) {
    cloned.geometry = {
      dimension: cloned.dimension ?? 3,
      lengthUnit: cloned.lengthUnit,
      parameters: cloned.parameters || {},
      features: cloned.features,
      selections: cloned.selections || [],
      finalization: cloned.finalization
    };
  }

  if (baseGeom) {
    const inlineGeom = cloned.geometry || {};
    cloned.geometry = {
      ...baseGeom,
      ...inlineGeom,
      parameters: {
        ...(baseGeom.parameters || {}),
        ...(inlineGeom.parameters || {}),
        ...(cloned.parameters || {})
      },
      features: Array.isArray(inlineGeom.features) ? inlineGeom.features : baseGeom.features || [],
      selections: [
        ...(baseGeom.selections || []),
        ...(Array.isArray(inlineGeom.selections) ? inlineGeom.selections : [])
      ]
    };
    cloned.parameters = { ...cloned.geometry.parameters };
  } else if (cloned.geometry) {
    cloned.geometry.parameters = {
      ...(cloned.geometry.parameters || {}),
      ...(cloned.parameters || {})
    };
    cloned.parameters = { ...cloned.geometry.parameters };
  }

  // Synthesize FaceBox selections when a physics feature uses an inline { feature, face } selector
  if (cloned.geometry) {
    cloned.geometry.selections = Array.isArray(cloned.geometry.selections) ? cloned.geometry.selections : [];
    const existingSelTags = new Set(cloned.geometry.selections.map(s => s && s.tag).filter(Boolean));
    for (const phys of cloned.physics || []) {
      for (const feat of (phys && phys.features) || []) {
        const inlineSel =
          feat && feat.selection && typeof feat.selection === "object"
            ? feat.selection
            : feat && feat.feature && feat.face
              ? { feature: feat.feature, face: feat.face, tol: feat.tol }
              : null;
        if (inlineSel && inlineSel.feature && inlineSel.face) {
          const autoTag =
            inlineSel.tag || `sel_auto_${inlineSel.feature}_${String(inlineSel.face).toLowerCase()}`;
          if (!existingSelTags.has(autoTag)) {
            cloned.geometry.selections.push({
              tag: autoTag,
              type: "FaceBox",
              feature: inlineSel.feature,
              face: inlineSel.face,
              tol: inlineSel.tol,
              entitydim: 2
            });
            existingSelTags.add(autoTag);
          }
          feat.selection = autoTag;
        }
      }
    }
  }

  return cloned;
}

function validatePhysicsSpec(rawSpec = {}) {
  const spec = resolveUnifiedModelSpec(rawSpec);
  const errors = [];
  const warnings = [];

  const studyType = (spec.study && spec.study.type) || "Stationary";
  const physicsList = Array.isArray(spec.physics) ? spec.physics : [];
  const materials = Array.isArray(spec.materials) ? spec.materials : [];
  const couplings = Array.isArray(spec.couplings) ? spec.couplings : [];

  if (physicsList.length === 0) {
    errors.push("Physics spec must define at least one physics interface in 'physics'");
  }

  // 1. Unified Geometry + Selection Validation via comsol-geometry.cjs
  let geometryValidation = null;
  const selectionDims = {};
  if (spec.geometry) {
    geometryValidation = GEOM_MOD.validateGeometrySpec(spec.geometry);
    for (const gErr of geometryValidation.errors || []) {
      errors.push(`GEOMETRY_ERROR: ${gErr}`);
    }
    for (const gWarn of geometryValidation.warnings || []) {
      warnings.push(`GEOMETRY_WARNING: ${gWarn}`);
    }
    const geomDim = spec.geometry.dimension || 3;
    if (Array.isArray(spec.geometry.features)) {
      for (const gf of spec.geometry.features) {
        if (gf && gf.tag && gf.selresult !== false) {
          selectionDims[gf.tag] = geomDim;
        }
      }
    }
    if (Array.isArray(spec.geometry.selections)) {
      for (const sel of spec.geometry.selections) {
        if (sel && sel.tag) {
          selectionDims[sel.tag] = sel.entitydim ?? 2;
        }
      }
    }
  }

  const providedMatProps = new Set();
  for (const mat of materials) {
    if (!mat || typeof mat !== "object") continue;
    if (
      spec.geometry &&
      mat.selection &&
      mat.selection !== "all" &&
      selectionDims[mat.selection] === undefined
    ) {
      errors.push(
        `UNKNOWN_SELECTION: Material '${mat.tag || "mat"}' references selection '${mat.selection}' which is not defined in geometry`
      );
    }
    const props = mat.properties || {};
    for (const k of Object.keys(props)) {
      providedMatProps.add(k.toLowerCase());
    }
  }

  const activeByType = {};
  const seenPhysicsTags = new Set();

  for (const phys of physicsList) {
    if (!phys || typeof phys !== "object") continue;
    const pType = phys.type;
    const catalogEntry = PHYSICS_CATALOG[pType];
    if (!catalogEntry) {
      errors.push(
        `Unknown physics interface '${pType}'. Supported: ${Object.keys(PHYSICS_CATALOG).join(", ")}`
      );
      continue;
    }

    const pTag = phys.tag || catalogEntry.defaultTag;
    if (seenPhysicsTags.has(pTag)) {
      errors.push(`Duplicate physics interface tag '${pTag}'`);
    }
    seenPhysicsTags.add(pTag);
    activeByType[pType] = pTag;

    if (materials.length > 0) {
      for (const reqProp of catalogEntry.requiredMaterialProps) {
        if (!providedMatProps.has(reqProp.toLowerCase())) {
          errors.push(
            `MISSING_MATERIAL_PROPERTY: Physics '${pType}' ('${pTag}') requires material property '${reqProp}'`
          );
        }
      }
    }

    const features = Array.isArray(phys.features) ? phys.features : [];
    let hasReferenceConstraint = false;
    let hasFlowDrive = false;
    const selectionConflictTracker = new Map();

    for (const feat of features) {
      if (!feat || typeof feat !== "object") continue;
      const fMeta = FEATURE_CATALOG[feat.type];
      if (!fMeta) {
        errors.push(`Unknown feature type '${feat.type}' in physics '${pTag}'`);
        continue;
      }

      const expectedDim = fMeta.entitydim;
      const actualDim = feat.entitydim !== undefined ? feat.entitydim : expectedDim;
      if (actualDim !== expectedDim) {
        errors.push(
          `DIMENSION_MISMATCH: Feature '${feat.tag || feat.type}' (${feat.type}) in '${pTag}' requires entitydim=${expectedDim}, got ${actualDim}`
        );
      }

      if (spec.geometry && feat.selection && feat.selection !== "all") {
        if (selectionDims[feat.selection] === undefined) {
          errors.push(
            `UNKNOWN_SELECTION: Feature '${feat.tag || feat.type}' in '${pTag}' references selection '${feat.selection}' which is not defined in geometry`
          );
        } else if (selectionDims[feat.selection] !== expectedDim) {
          errors.push(
            `DIMENSION_MISMATCH: Feature '${feat.tag || feat.type}' (${feat.type}, entitydim=${expectedDim}) is bound to selection '${feat.selection}' with entitydim=${selectionDims[feat.selection]}`
          );
        }
      }

      if (catalogEntry.referenceBoundaryTypes.includes(feat.type)) {
        hasReferenceConstraint = true;
      }
      if (
        feat.type === "HeatFluxBoundary" &&
        feat.props &&
        feat.props.FluxType === "ConvectiveHeatFlux"
      ) {
        hasReferenceConstraint = true;
      }
      if (catalogEntry.requiredDriveTypes && catalogEntry.requiredDriveTypes.includes(feat.type)) {
        hasFlowDrive = true;
      }

      if (fMeta.conflictGroup && feat.selection && feat.selection !== "all") {
        const key = `${fMeta.conflictGroup}::${feat.selection}`;
        if (selectionConflictTracker.has(key)) {
          const prev = selectionConflictTracker.get(key);
          errors.push(
            `CONFLICTING_BOUNDARY_CONDITIONS: Features '${prev}' and '${feat.tag || feat.type}' in '${pTag}' both constrain selection '${feat.selection}'`
          );
        } else {
          selectionConflictTracker.set(key, feat.tag || feat.type);
        }
      }
    }

    if (studyType === "Stationary" && !hasReferenceConstraint) {
      errors.push(
        `UNDERCONSTRAINED_PHYSICS: Stationary '${pType}' ('${pTag}') has no Dirichlet/reference constraint (${catalogEntry.referenceBoundaryTypes.join(" | ")}) — will cause a Singular Matrix in COMSOL 6.2`
      );
    }

    if (pType === "LaminarFlow" && !hasFlowDrive) {
      errors.push(
        `UNDERCONSTRAINED_PHYSICS: 'LaminarFlow' ('${pTag}') has no flow drive boundary (${catalogEntry.requiredDriveTypes.join(" | ")})`
      );
    }

    // Check initial values alignment for HeatTransfer
    if (pType === "HeatTransfer") {
      const initT = phys.initialValues && phys.initialValues.T;
      if (!initT) {
        warnings.push(
          `Physics '${pTag}' (HeatTransfer) does not specify 'initialValues.T'; consider aligning initial T with boundary reference temperature`
        );
      }
    }
  }

  for (const cpl of couplings) {
    if (!cpl || typeof cpl !== "object") continue;
    const cMeta = COUPLING_CATALOG[cpl.type];
    if (!cMeta) {
      errors.push(
        `Unknown multiphysics coupling '${cpl.type}'. Supported: ${Object.keys(COUPLING_CATALOG).join(", ")}`
      );
      continue;
    }
    for (const reqPhys of cMeta.requiredInterfaces) {
      const explicitTag = cpl.physics && cpl.physics[reqPhys];
      if (explicitTag && explicitTag !== activeByType[reqPhys]) {
        errors.push(
          `MISSING_COUPLED_PHYSICS: Multiphysics coupling '${cpl.type}' references missing physics tag '${explicitTag}' for '${reqPhys}'`
        );
      } else if (!activeByType[reqPhys]) {
        errors.push(
          `MISSING_COUPLED_PHYSICS: Multiphysics coupling '${cpl.type}' requires physics interface '${reqPhys}'`
        );
      }
    }
    if (materials.length > 0) {
      for (const reqProp of cMeta.requiredMaterialProps) {
        if (!providedMatProps.has(reqProp.toLowerCase())) {
          errors.push(
            `MISSING_MATERIAL_PROPERTY: Multiphysics coupling '${cpl.type}' requires material property '${reqProp}'`
          );
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    activePhysics: activeByType,
    geometryValidation,
    selectionDims
  };
}

function applySingleBoundaryOverride(findPhys, pKey, fTag, override) {
  const targetPhys = findPhys(pKey);
  if (!targetPhys) return;
  targetPhys.features = Array.isArray(targetPhys.features) ? targetPhys.features : [];
  const existing = targetPhys.features.find(f => f.tag === fTag);
  const rawProps = override.props || override.params;
  const propCopy = { ...override };
  delete propCopy.type;
  delete propCopy.selection;
  delete propCopy.entitydim;
  delete propCopy.physicsTag;
  delete propCopy.featureTag;
  delete propCopy.props;
  delete propCopy.params;
  const finalProps = rawProps || propCopy;
  if (existing) {
    if (override.type) existing.type = override.type;
    if (override.selection) existing.selection = override.selection;
    if (override.entitydim !== undefined) existing.entitydim = override.entitydim;
    existing.props = { ...(existing.props || {}), ...finalProps };
  } else {
    targetPhys.features.push({
      tag: fTag,
      type: override.type || "HeatFluxBoundary",
      entitydim: override.entitydim,
      selection: override.selection || "all",
      props: finalProps
    });
  }
}

function tunePhysicsSpec(spec = {}, adjustments = {}) {
  const cloned = resolveUnifiedModelSpec(spec);
  cloned.parameters = { ...(cloned.parameters || {}), ...(adjustments.parameters || {}) };
  if (cloned.geometry) {
    cloned.geometry.parameters = {
      ...(cloned.geometry.parameters || {}),
      ...cloned.parameters
    };
  }
  cloned.physics = Array.isArray(cloned.physics) ? cloned.physics : [];
  cloned.couplings = Array.isArray(cloned.couplings) ? cloned.couplings : [];

  const findPhys = key =>
    cloned.physics.find(
      p => p.tag === key || p.type === key || (PHYSICS_CATALOG[p.type] && PHYSICS_CATALOG[p.type].defaultTag === key)
    );

  if (adjustments.initialValues && typeof adjustments.initialValues === "object") {
    for (const [pKey, initPatch] of Object.entries(adjustments.initialValues)) {
      const target = findPhys(pKey);
      if (target) {
        target.initialValues = { ...(target.initialValues || {}), ...initPatch };
      }
    }
  }

  if (Array.isArray(adjustments.boundaryOverrides)) {
    for (const ov of adjustments.boundaryOverrides) {
      if (ov && ov.physicsTag && ov.featureTag) {
        applySingleBoundaryOverride(findPhys, ov.physicsTag, ov.featureTag, ov);
      }
    }
  } else if (adjustments.boundaryOverrides && typeof adjustments.boundaryOverrides === "object") {
    for (const [pathKey, override] of Object.entries(adjustments.boundaryOverrides)) {
      const dotIdx = pathKey.indexOf(".");
      if (dotIdx <= 0) continue;
      const pKey = pathKey.slice(0, dotIdx);
      const fTag = pathKey.slice(dotIdx + 1);
      applySingleBoundaryOverride(findPhys, pKey, fTag, override);
    }
  }

  if (adjustments.addFeatures && typeof adjustments.addFeatures === "object") {
    for (const [pKey, newFeats] of Object.entries(adjustments.addFeatures)) {
      const targetPhys = findPhys(pKey);
      if (targetPhys && Array.isArray(newFeats)) {
        targetPhys.features = [...(targetPhys.features || []), ...newFeats];
      }
    }
  }

  if (Array.isArray(adjustments.addCouplings)) {
    for (const cpl of adjustments.addCouplings) {
      if (!cloned.couplings.some(c => c.type === cpl.type && c.tag === cpl.tag)) {
        cloned.couplings.push(cpl);
      }
    }
  }

  if (adjustments.studyTuning && typeof adjustments.studyTuning === "object") {
    cloned.study = { ...(cloned.study || { type: "Stationary" }), ...adjustments.studyTuning };
  }

  if (adjustments.autoAlignInitialValues) {
    for (const phys of cloned.physics) {
      phys.initialValues = phys.initialValues || {};
      const feats = phys.features || [];
      if (phys.type === "HeatTransfer") {
        const tempFeat = feats.find(
          f =>
            (f.type === "TemperatureBoundary" && (f.props || f.params) && (f.props || f.params).T0) ||
            (f.type === "ConvectiveHeatFlux" && (f.props || f.params) && (f.props || f.params).Text)
        );
        if (tempFeat) {
          const p = tempFeat.props || tempFeat.params;
          phys.initialValues.T = p.T0 || p.Text;
        }
      }
      if (phys.type === "Electrostatics" || phys.type === "ElectricCurrents") {
        const potFeat = feats.find(f => f.type === "ElectricPotential" && (f.props || f.params) && (f.props || f.params).V0);
        if (potFeat) {
          phys.initialValues.V = (potFeat.props || potFeat.params).V0;
        } else if (!phys.initialValues.V) {
          phys.initialValues.V = "0[V]";
        }
      }
    }
  }

  const resolvedAfterTune = resolveUnifiedModelSpec(cloned);
  const validation = validatePhysicsSpec(resolvedAfterTune);
  return {
    status: "TUNED_PHYSICS_SPEC",
    spec: resolvedAfterTune,
    tunedSpec: resolvedAfterTune,
    validation
  };
}

function formatJavaStringArray(arr) {
  return `new String[]{${arr.map(x => JSON.stringify(String(x))).join(", ")}}`;
}

function formatJavaBooleanArray(arr) {
  return `new boolean[]{${arr.map(x => (x ? "true" : "false")).join(", ")}}`;
}

function emitPropertySet(targetExpr, propKey, propVal) {
  if (propKey === "PrescribedInDirection" && Array.isArray(propVal)) {
    return `${targetExpr}.set("PrescribedInDirection", ${formatJavaBooleanArray(propVal)});`;
  }
  if (Array.isArray(propVal)) {
    return `${targetExpr}.set(${JSON.stringify(propKey)}, ${formatJavaStringArray(propVal)});`;
  }
  if (VECTOR_PROPERTIES.has(propKey)) {
    return `${targetExpr}.set(${JSON.stringify(propKey)}, ${formatJavaStringArray([propVal])});`;
  }
  if (typeof propVal === "boolean") {
    return `${targetExpr}.set(${JSON.stringify(propKey)}, ${propVal});`;
  }
  return `${targetExpr}.set(${JSON.stringify(propKey)}, ${JSON.stringify(String(propVal))});`;
}

function compilePhysicsSpecToJava(rawSpec = {}, options = {}) {
  const spec = resolveUnifiedModelSpec(rawSpec);
  const validation = validatePhysicsSpec(spec);
  if (!validation.valid) {
    return {
      status: "INVALID_PHYSICS_SPEC",
      validation,
      javaCode: null
    };
  }

  const className = options.className || spec.className || "Comsol62PhysicsModel";
  const compTag = spec.componentTag || (spec.geometry && spec.geometry.componentTag) || "comp1";
  const geomTag = spec.geomTag || (spec.geometry && spec.geometry.geomTag) || "geom1";
  const cStr = JSON.stringify(compTag);
  const gStr = JSON.stringify(geomTag);

  const lines = [
    `import com.comsol.model.*;`,
    `import com.comsol.model.util.*;`,
    ``,
    `public class ${className} {`
  ];

  // Unified Geometry + Selection code generation via comsol-geometry.cjs
  if (spec.geometry) {
    const geomMethodLines = GEOM_MOD.buildGeometryMethodLines(
      spec.geometry,
      validation.geometryValidation
    );
    lines.push(...geomMethodLines);
    lines.push(``);
  }

  lines.push(`  public static Model configurePhysics(Model model) {`);
  if (!spec.geometry) {
    for (const [k, v] of Object.entries(spec.parameters || {})) {
      lines.push(`    model.param().set(${JSON.stringify(k)}, ${JSON.stringify(String(v))});`);
    }
  }

  // 1. Materials
  for (const [idx, mat] of (spec.materials || []).entries()) {
    const mTag = JSON.stringify(mat.tag || `mat${idx + 1}`);
    lines.push(`    model.component(${cStr}).material().create(${mTag}, "Common");`);
    if (mat.label) {
      lines.push(`    model.component(${cStr}).material(${mTag}).label(${JSON.stringify(mat.label)});`);
    }
    if (mat.selection && mat.selection !== "all") {
      lines.push(
        `    model.component(${cStr}).material(${mTag}).selection().named(${JSON.stringify(mat.selection)});`
      );
    } else {
      lines.push(`    model.component(${cStr}).material(${mTag}).selection().all();`);
    }
    for (const [propName, propVal] of Object.entries(mat.properties || {})) {
      lines.push(
        `    ${emitPropertySet(`model.component(${cStr}).material(${mTag}).propertyGroup("def")`, propName, propVal)}`
      );
    }
  }

  // 2. Physics Interfaces, Initial Conditions, Domain & Boundary Features
  for (const phys of spec.physics || []) {
    const catalogEntry = PHYSICS_CATALOG[phys.type];
    const pTag = phys.tag || catalogEntry.defaultTag;
    const pStr = JSON.stringify(pTag);
    lines.push(`    model.component(${cStr}).physics().create(${pStr}, ${JSON.stringify(phys.type)}, ${gStr});`);

    if (phys.initialValues && typeof phys.initialValues === "object") {
      for (const [varName, val] of Object.entries(phys.initialValues)) {
        lines.push(
          `    ${emitPropertySet(`model.component(${cStr}).physics(${pStr}).feature("init1")`, varName, val)}`
        );
      }
    }

    for (const [fIdx, feat] of (phys.features || []).entries()) {
      const fMeta = FEATURE_CATALOG[feat.type];
      const fTag = JSON.stringify(feat.tag || `feat${fIdx + 1}`);
      const entityDim = feat.entitydim !== undefined ? feat.entitydim : fMeta.entitydim;
      lines.push(
        `    model.component(${cStr}).physics(${pStr}).create(${fTag}, ${JSON.stringify(fMeta.comsolType)}, ${entityDim});`
      );
      if (feat.selection && feat.selection !== "all") {
        lines.push(
          `    model.component(${cStr}).physics(${pStr}).feature(${fTag}).selection().named(${JSON.stringify(feat.selection)});`
        );
      } else if (feat.selection === "all") {
        lines.push(`    model.component(${cStr}).physics(${pStr}).feature(${fTag}).selection().all();`);
      }

      const combinedProps = { ...(fMeta.presetProps || {}), ...(feat.props || feat.params || {}) };
      for (const [pk, pv] of Object.entries(combinedProps)) {
        lines.push(
          `    ${emitPropertySet(`model.component(${cStr}).physics(${pStr}).feature(${fTag})`, pk, pv)}`
        );
      }
    }
  }

  // 3. Multiphysics Couplings
  for (const [cIdx, cpl] of (spec.couplings || []).entries()) {
    const cMeta = COUPLING_CATALOG[cpl.type];
    const cTag = JSON.stringify(cpl.tag || cMeta.defaultTag || ` mpl${cIdx + 1}`);
    const cDim = cpl.dim || cMeta.dim || 3;
    lines.push(
      `    model.component(${cStr}).multiphysics().create(${cTag}, ${JSON.stringify(cpl.type)}, ${cDim});`
    );
    for (const [bindProp, reqType] of Object.entries(cMeta.physicsBindings)) {
      const boundTag = validation.activePhysics[reqType] || PHYSICS_CATALOG[reqType].defaultTag;
      lines.push(
        `    model.component(${cStr}).multiphysics(${cTag}).set(${JSON.stringify(bindProp)}, ${JSON.stringify(boundTag)});`
      );
    }
    if (cpl.selection && cpl.selection !== "all") {
      lines.push(
        `    model.component(${cStr}).multiphysics(${cTag}).selection().named(${JSON.stringify(cpl.selection)});`
      );
    } else {
      lines.push(`    model.component(${cStr}).multiphysics(${cTag}).selection().all();`);
    }
  }

  // 4. Mesh & Study / Solver Tuning
  const meshSize = (spec.mesh && spec.mesh.autoMeshSize) || 4;
  lines.push(`    model.component(${cStr}).mesh().create("mesh1");`);
  lines.push(`    model.component(${cStr}).mesh("mesh1").autoMeshSize(${meshSize});`);
  lines.push(`    model.component(${cStr}).mesh("mesh1").run();`);

  const study = spec.study || { type: "Stationary" };
  const sTag = JSON.stringify(study.tag || "std1");
  lines.push(`    model.study().create(${sTag});`);
  if (study.type === "Transient" || study.type === "TimeDependent") {
    lines.push(`    model.study(${sTag}).create("time", "Transient");`);
    if (study.tlist) {
      lines.push(
        `    model.study(${sTag}).feature("time").set("tlist", ${JSON.stringify(String(study.tlist))});`
      );
    }
  } else {
    lines.push(`    model.study(${sTag}).create("stat", "Stationary");`);
    if (study.rampParam && study.rampValues) {
      const rVals = Array.isArray(study.rampValues) ? study.rampValues : [String(study.rampValues)];
      lines.push(`    model.study(${sTag}).feature("stat").set("useparam", true);`);
      lines.push(
        `    model.study(${sTag}).feature("stat").set("pname", ${formatJavaStringArray([study.rampParam])});`
      );
      lines.push(
        `    model.study(${sTag}).feature("stat").set("plistarr", ${formatJavaStringArray(rVals)});`
      );
    }
  }
  lines.push(`    model.study(${sTag}).run();`);
  lines.push(`    return model;`);
  lines.push(`  }`);
  lines.push(``);
  lines.push(`  public static Model run() {`);
  lines.push(`    Model model = ModelUtil.create("Model");`);
  if (spec.geometry) {
    lines.push(`    buildGeometry(model);`);
  }
  lines.push(`    return configurePhysics(model);`);
  lines.push(`  }`);
  lines.push(``);
  lines.push(`  public static void main(String[] args) {`);
  lines.push(`    run();`);
  lines.push(`  }`);
  lines.push(`}`);

  const javaCode = lines.join("\n") + "\n";
  return {
    status: "COMPILED_PHYSICS_JAVA",
    className,
    validation,
    geometryAudit: GEOM_MOD.auditJavaGeometryCode(javaCode),
    physicsAudit: auditJavaPhysicsCode(javaCode),
    javaCode
  };
}

function auditJavaPhysicsCode(sourceCode) {
  const code = GEOM_MOD.stripJavaComments(sourceCode);
  const errors = [];
  const warnings = [];

  for (const vecProp of VECTOR_PROPERTIES) {
    const scalarRegex = new RegExp(
      `\\.set\\(\\s*"${vecProp}"\\s*,\\s*"(?:\\\\.|[^"\\\\])*"\\s*\\)`,
      "g"
    );
    if (scalarRegex.test(code)) {
      errors.push(
        `Vector property '${vecProp}' received a scalar String; in COMSOL 6.2 use 'new String[]{...}'`
      );
    }
  }

  const physCreates = [
    ...code.matchAll(
      /\.physics\(\)\.create\(\s*"([^"]+)"\s*,\s*"(HeatTransfer|LaminarFlow|SolidMechanics|Electrostatics|ElectricCurrents)"/g
    )
  ];

  for (const match of physCreates) {
    const pTag = match[1];
    const pType = match[2];
    const catalogEntry = PHYSICS_CATALOG[pType];
    if (!catalogEntry) continue;
    const escapedTag = pTag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const featCreates = [
      ...code.matchAll(
        new RegExp(`\\.physics\\(\\s*"${escapedTag}"\\s*\\)\\.create\\(\\s*"[^"]+"\\s*,\\s*"([^"]+)"`, "g")
      )
    ].map(m => m[1]);

    const hasRef = featCreates.some(
      ft =>
        catalogEntry.referenceBoundaryTypes.includes(ft) ||
        (pType === "HeatTransfer" && ft === "HeatFluxBoundary" && /"ConvectiveHeatFlux"/.test(code))
    );
    if (!hasRef) {
      errors.push(
        `Physics '${pType}' ('${pTag}') has no Dirichlet/reference constraint feature (${catalogEntry.referenceBoundaryTypes.join(" | ")}) in Java source`
      );
    }
  }

  const couplingCreates = [
    ...code.matchAll(
      /\.multiphysics\(\)\.create\(\s*"([^"]+)"\s*,\s*"(NonIsothermalFlow|ThermalExpansion|ElectromagneticHeating|FluidStructureInteraction)"/g
    )
  ];
  for (const match of couplingCreates) {
    const cTag = match[1];
    const cType = match[2];
    const cMeta = COUPLING_CATALOG[cType];
    const escapedTag = cTag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const bindKey of Object.keys(cMeta.physicsBindings)) {
      const bindRegex = new RegExp(
        `\\.multiphysics\\(\\s*"${escapedTag}"\\s*\\)\\.set\\(\\s*"${bindKey}"`
      );
      if (!bindRegex.test(code)) {
        errors.push(
          `Multiphysics coupling '${cType}' ('${cTag}') is missing '.set("${bindKey}", "<physicsTag>")'`
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

const PHYSICS_PRESETS = {
  "conjugate-heat-microchannel": {
    description: "COMSOL 6.2 Conjugate Heat Transfer (LaminarFlow + HeatTransfer + NonIsothermalFlow) unified with microchannel-heatsink 3D geometry preset",
    spec: {
      className: "ConjugateHeatMicrochannelModel",
      geometryPreset: "microchannel-heatsink",
      parameters: {
        T_in: "293.15[K]",
        q_base: "5e4[W/m^2]",
        U_in: "0.2[m/s]"
      },
      materials: [
        {
          tag: "mat_water",
          label: "Cooling Fluid & Substrate Effective Props",
          selection: "all",
          properties: {
            density: "1000[kg/m^3]",
            dynamicviscosity: "1e-3[Pa*s]",
            thermalconductivity: ["0.6[W/(m*K)]"],
            heatcapacity: "4184[J/(kg*K)]"
          }
        }
      ],
      physics: [
        {
          tag: "spf",
          type: "LaminarFlow",
          initialValues: { u: ["U_in", "0", "0"], p: "0[Pa]" },
          features: [
            { tag: "inl1", type: "InletBoundary", selection: "sel_inlet", props: { U0in: "U_in" } },
            { tag: "out1", type: "OutletBoundary", selection: "sel_outlet", props: { p0: "0[Pa]" } }
          ]
        },
        {
          tag: "ht",
          type: "HeatTransfer",
          initialValues: { T: "T_in" },
          features: [
            { tag: "temp1", type: "TemperatureBoundary", selection: "sel_inlet", props: { T0: "T_in" } },
            { tag: "hf1", type: "HeatFluxBoundary", selection: "sel_heated_base", props: { q0: "q_base" } }
          ]
        }
      ],
      couplings: [{ tag: "nitf1", type: "NonIsothermalFlow", selection: "all" }],
      study: { type: "Stationary" }
    }
  },

  "thermo-mechanical-bracket": {
    description: "COMSOL 6.2 Thermal Stress (HeatTransfer + SolidMechanics + ThermalExpansion) with convective cooling and surface load",
    spec: {
      className: "ThermoMechanicalBracketModel",
      parameters: {
        L_b: "50[mm]",
        W_b: "10[mm]",
        H_b: "5[mm]",
        T_root: "350[K]",
        T_amb: "293.15[K]",
        h_conv: "25[W/(m^2*K)]",
        F_tip: "-2e5[N/m^2]"
      },
      geometry: {
        dimension: 3,
        features: [
          {
            tag: "blk1",
            type: "Block",
            size: ["L_b", "W_b", "H_b"],
            pos: ["0[mm]", "0[mm]", "0[mm]"]
          }
        ],
        selections: [
          { tag: "sel_root", type: "FaceBox", feature: "blk1", face: "xmin", entitydim: 2 },
          { tag: "sel_top", type: "FaceBox", feature: "blk1", face: "zmax", entitydim: 2 }
        ]
      },
      materials: [
        {
          tag: "mat_steel",
          label: "Structural Steel",
          selection: "all",
          properties: {
            youngsmodulus: "200e9[Pa]",
            poissonsratio: "0.3",
            density: "7850[kg/m^3]",
            thermalconductivity: ["44.5[W/(m*K)]"],
            heatcapacity: "475[J/(kg*K)]",
            thermalexpansioncoefficient: "12.3e-6[1/K]"
          }
        }
      ],
      physics: [
        {
          tag: "ht",
          type: "HeatTransfer",
          initialValues: { T: "T_amb" },
          features: [
            { tag: "temp1", type: "TemperatureBoundary", selection: "sel_root", props: { T0: "T_root" } },
            {
              tag: "conv1",
              type: "ConvectiveHeatFlux",
              selection: "sel_top",
              props: { h: "h_conv", Text: "T_amb" }
            }
          ]
        },
        {
          tag: "solid",
          type: "SolidMechanics",
          initialValues: { u: ["0", "0", "0"] },
          features: [
            { tag: "fix1", type: "Fixed", selection: "sel_root", props: {} },
            {
              tag: "bndl1",
              type: "BoundaryLoad",
              selection: "sel_top",
              props: { FperArea: ["0", "0", "F_tip"] }
            }
          ]
        }
      ],
      couplings: [{ tag: "te1", type: "ThermalExpansion", selection: "all" }],
      study: { type: "Stationary" }
    }
  },

  "joule-heating-busbar": {
    description: "COMSOL 6.2 Electro-Thermal Joule Heating (ElectricCurrents + HeatTransfer + ElectromagneticHeating)",
    spec: {
      className: "JouleHeatingBusbarModel",
      parameters: {
        L_bus: "40[mm]",
        W_bus: "8[mm]",
        H_bus: "2[mm]",
        V_drive: "0.5[V]",
        T_amb: "293.15[K]",
        h_air: "15[W/(m^2*K)]"
      },
      geometry: {
        dimension: 3,
        features: [
          {
            tag: "blk_bus",
            type: "Block",
            size: ["L_bus", "W_bus", "H_bus"],
            pos: ["0[mm]", "0[mm]", "0[mm]"]
          }
        ],
        selections: [
          { tag: "sel_gnd", type: "FaceBox", feature: "blk_bus", face: "xmin", entitydim: 2 },
          { tag: "sel_vpos", type: "FaceBox", feature: "blk_bus", face: "xmax", entitydim: 2 },
          { tag: "sel_top_cool", type: "FaceBox", feature: "blk_bus", face: "zmax", entitydim: 2 }
        ]
      },
      materials: [
        {
          tag: "mat_copper",
          label: "Copper",
          selection: "all",
          properties: {
            electricconductivity: "5.998e7[S/m]",
            relpermittivity: "1",
            thermalconductivity: ["400[W/(m*K)]"],
            density: "8960[kg/m^3]",
            heatcapacity: "385[J/(kg*K)]"
          }
        }
      ],
      physics: [
        {
          tag: "ec",
          type: "ElectricCurrents",
          initialValues: { V: "0[V]" },
          features: [
            { tag: "gnd1", type: "Ground", selection: "sel_gnd", props: {} },
            { tag: "pot1", type: "ElectricPotential", selection: "sel_vpos", props: { V0: "V_drive" } }
          ]
        },
        {
          tag: "ht",
          type: "HeatTransfer",
          initialValues: { T: "T_amb" },
          features: [
            {
              tag: "conv1",
              type: "ConvectiveHeatFlux",
              selection: "sel_top_cool",
              props: { h: "h_air", Text: "T_amb" }
            }
          ]
        }
      ],
      couplings: [{ tag: "emh1", type: "ElectromagneticHeating", selection: "all" }],
      study: { type: "Stationary" }
    }
  }
};

function getPhysicsPreset(name) {
  const key = String(name || "").toLowerCase().trim();
  if (!Object.prototype.hasOwnProperty.call(PHYSICS_PRESETS, key)) {
    throw new Error(
      `Unknown physics preset '${name}'. Available: ${Object.keys(PHYSICS_PRESETS).join(", ")}`
    );
  }
  return { name: key, ...PHYSICS_PRESETS[key] };
}

function listPhysicsPresets() {
  return Object.entries(PHYSICS_PRESETS).map(([name, info]) => ({
    name,
    description: info.description
  }));
}

module.exports = {
  PHYSICS_CATALOG,
  FEATURE_CATALOG,
  COUPLING_CATALOG,
  PHYSICS_PRESETS,
  resolveUnifiedModelSpec,
  validatePhysicsSpec,
  tunePhysicsSpec,
  compilePhysicsSpecToJava,
  auditJavaPhysicsCode,
  getPhysicsPreset,
  listPhysicsPresets
};
