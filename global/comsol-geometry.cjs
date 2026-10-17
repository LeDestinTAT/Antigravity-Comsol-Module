const fs = require("node:fs");
const path = require("node:path");

const UNIT_TO_METERS = {
  m: 1,
  dm: 1e-1,
  cm: 1e-2,
  mm: 1e-3,
  um: 1e-6,
  "µm": 1e-6,
  nm: 1e-9,
  in: 0.0254,
  ft: 0.3048
};

const PRIMITIVES_2D_ONLY = new Set(["Rectangle", "Circle", "Ellipse", "Polygon", "Square", "BezierPolygon"]);
const PRIMITIVES_3D_ONLY = new Set(["Block", "Cylinder", "Sphere", "Cone", "Torus", "Ellipsoid", "Pyramid"]);

function parseLengthMeters(expr, paramMap = {}) {
  if (typeof expr === "number") {
    return Number.isFinite(expr) ? expr : null;
  }
  if (typeof expr !== "string") return null;
  let raw = expr.trim();
  if (!raw) return null;

  // Substitute known parameters up to 4 hops
  for (let hop = 0; hop < 4; hop++) {
    let replaced = false;
    raw = raw.replace(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g, (match, name) => {
      if (Object.prototype.hasOwnProperty.call(paramMap, name)) {
        replaced = true;
        return String(paramMap[name]);
      }
      return match;
    });
    if (!replaced) break;
  }

  let unitFactor = 1;
  const unitMatches = [...raw.matchAll(/\[([a-zA-Zµ]+)\]/g)];
  if (unitMatches.length > 0) {
    const lastUnit = unitMatches[unitMatches.length - 1][1];
    if (!Object.prototype.hasOwnProperty.call(UNIT_TO_METERS, lastUnit)) {
      return null;
    }
    unitFactor = UNIT_TO_METERS[lastUnit];
  }

  const numericExpr = raw.replace(/\[[a-zA-Zµ]+\]/g, "").trim();
  if (!/^[0-9eE.+\-*/()\s]+$/.test(numericExpr)) {
    return null;
  }
  try {
    const val = Function(`"use strict"; return (${numericExpr});`)();
    return typeof val === "number" && Number.isFinite(val) ? val * unitFactor : null;
  } catch (_) {
    return null;
  }
}

function computeFeatureAABB(feature, paramMap = {}, existingBounds = {}) {
  const type = feature.type;
  const posArr = Array.isArray(feature.pos) ? feature.pos : ["0", "0", "0"];
  const px = parseLengthMeters(posArr[0] ?? 0, paramMap);
  const py = parseLengthMeters(posArr[1] ?? 0, paramMap);
  const pz = parseLengthMeters(posArr[2] ?? 0, paramMap);
  if (px === null || py === null || pz === null) return null;

  if (type === "Block") {
    const size = Array.isArray(feature.size) ? feature.size : [];
    const lx = parseLengthMeters(size[0], paramMap);
    const ly = parseLengthMeters(size[1], paramMap);
    const lz = parseLengthMeters(size[2], paramMap);
    if (lx === null || ly === null || lz === null) return null;
    if (feature.base === "center") {
      return {
        xmin: px - lx / 2,
        xmax: px + lx / 2,
        ymin: py - ly / 2,
        ymax: py + ly / 2,
        zmin: pz - lz / 2,
        zmax: pz + lz / 2
      };
    }
    return {
      xmin: px,
      xmax: px + lx,
      ymin: py,
      ymax: py + ly,
      zmin: pz,
      zmax: pz + lz
    };
  }

  if (type === "Sphere") {
    const r = parseLengthMeters(feature.r, paramMap);
    if (r === null) return null;
    return {
      xmin: px - r,
      xmax: px + r,
      ymin: py - r,
      ymax: py + r,
      zmin: pz - r,
      zmax: pz + r
    };
  }

  if (type === "Cylinder" || type === "Cone") {
    const r = parseLengthMeters(feature.r, paramMap);
    const h = parseLengthMeters(feature.h, paramMap);
    if (r === null || h === null) return null;
    const axis = Array.isArray(feature.axis) ? feature.axis.map(Number) : [0, 0, 1];
    if (Math.abs(axis[0]) === 1 && axis[1] === 0 && axis[2] === 0) {
      return {
        xmin: axis[0] > 0 ? px : px - h,
        xmax: axis[0] > 0 ? px + h : px,
        ymin: py - r,
        ymax: py + r,
        zmin: pz - r,
        zmax: pz + r
      };
    }
    if (axis[0] === 0 && Math.abs(axis[1]) === 1 && axis[2] === 0) {
      return {
        xmin: px - r,
        xmax: px + r,
        ymin: axis[1] > 0 ? py : py - h,
        ymax: axis[1] > 0 ? py + h : py,
        zmin: pz - r,
        zmax: pz + r
      };
    }
    return {
      xmin: px - r,
      xmax: px + r,
      ymin: py - r,
      ymax: py + r,
      zmin: axis[2] >= 0 ? pz : pz - h,
      zmax: axis[2] >= 0 ? pz + h : pz
    };
  }

  if (type === "Union") {
    const inputs = Array.isArray(feature.input) ? feature.input : [];
    const boxes = inputs.map(t => existingBounds[t]).filter(Boolean);
    if (boxes.length === 0) return null;
    return {
      xmin: Math.min(...boxes.map(b => b.xmin)),
      xmax: Math.max(...boxes.map(b => b.xmax)),
      ymin: Math.min(...boxes.map(b => b.ymin)),
      ymax: Math.max(...boxes.map(b => b.ymax)),
      zmin: Math.min(...boxes.map(b => b.zmin)),
      zmax: Math.max(...boxes.map(b => b.zmax))
    };
  }

  if (type === "Difference") {
    const targets = Array.isArray(feature.input) ? feature.input : [];
    const boxes = targets.map(t => existingBounds[t]).filter(Boolean);
    if (boxes.length === 0) return null;
    return {
      xmin: Math.min(...boxes.map(b => b.xmin)),
      xmax: Math.max(...boxes.map(b => b.xmax)),
      ymin: Math.min(...boxes.map(b => b.ymin)),
      ymax: Math.max(...boxes.map(b => b.ymax)),
      zmin: Math.min(...boxes.map(b => b.zmin)),
      zmax: Math.max(...boxes.map(b => b.zmax))
    };
  }

  return null;
}

function analyzeBoxInteraction(boxA, boxB) {
  if (!boxA || !boxB) return { intersects: null };
  const dx = Math.min(boxA.xmax, boxB.xmax) - Math.max(boxA.xmin, boxB.xmin);
  const dy = Math.min(boxA.ymax, boxB.ymax) - Math.max(boxA.ymin, boxB.ymin);
  const dz = Math.min(boxA.zmax, boxB.zmax) - Math.max(boxA.zmin, boxB.zmin);

  const intersects = dx > 0 && dy > 0 && dz > 0;
  const touchesOrOverlaps = dx >= -1e-12 && dy >= -1e-12 && dz >= -1e-12;
  const minOverlap = Math.min(dx, dy, dz);
  const maxGap = Math.max(-dx, -dy, -dz, 0);

  const bContainsA =
    boxB.xmin <= boxA.xmin + 1e-12 &&
    boxB.xmax >= boxA.xmax - 1e-12 &&
    boxB.ymin <= boxA.ymin + 1e-12 &&
    boxB.ymax >= boxA.ymax - 1e-12 &&
    boxB.zmin <= boxA.zmin + 1e-12 &&
    boxB.zmax >= boxA.zmax - 1e-12;

  return {
    intersects,
    touchesOrOverlaps,
    minOverlap,
    maxGap,
    bContainsA
  };
}

function validateGeometrySpec(spec = {}) {
  const dim = spec.dimension ?? 3;
  const params = spec.parameters || {};
  const features = Array.isArray(spec.features) ? spec.features : [];
  const selections = Array.isArray(spec.selections) ? spec.selections : [];

  const errors = [];
  const warnings = [];
  const seenTags = new Set();
  const boundsByTag = {};

  if (![2, 3].includes(dim)) {
    errors.push(`Invalid geometry dimension '${dim}' (COMSOL requires 2 or 3)`);
  }
  if (features.length === 0) {
    errors.push("Geometry spec must contain at least one feature in 'features'");
  }

  for (const feat of features) {
    if (!feat || typeof feat !== "object") continue;
    const { tag, type } = feat;
    if (!tag || !/^[A-Za-z][A-Za-z0-9_]*$/.test(tag)) {
      errors.push(`Invalid or missing feature tag '${tag}'`);
      continue;
    }
    if (seenTags.has(tag)) {
      errors.push(`Duplicate geometry feature tag '${tag}'`);
      continue;
    }

    if (dim === 3 && PRIMITIVES_2D_ONLY.has(type)) {
      errors.push(
        `2D primitive '${type}' (tag '${tag}') cannot be placed directly in a 3D geometry; wrap it inside a 'WorkPlane' feature ('wp1') and 'Extrude'/'Revolve'`
      );
    }
    if (dim === 2 && PRIMITIVES_3D_ONLY.has(type)) {
      errors.push(`3D primitive '${type}' (tag '${tag}') cannot be placed in a 2D geometry`);
    }

    if (type === "Block") {
      if (!Array.isArray(feat.size) || feat.size.length !== 3) {
        errors.push(`Block '${tag}' requires size: [Lx, Ly, Lz] (length 3)`);
      } else {
        for (const [idx, s] of feat.size.entries()) {
          const val = parseLengthMeters(s, params);
          if (val !== null && val <= 0) {
            errors.push(`Block '${tag}' size[${idx}] ('${s}') evaluates to non-positive length (${val} m)`);
          }
        }
      }
    }

    if (type === "Cylinder") {
      const r = parseLengthMeters(feat.r, params);
      const h = parseLengthMeters(feat.h, params);
      if (feat.r === undefined || feat.h === undefined) {
        errors.push(`Cylinder '${tag}' requires both 'r' and 'h'`);
      } else {
        if (r !== null && r <= 0) errors.push(`Cylinder '${tag}' radius '${feat.r}' must be > 0`);
        if (h !== null && h <= 0) errors.push(`Cylinder '${tag}' height '${feat.h}' must be > 0`);
      }
    }

    if (type === "Sphere") {
      const r = parseLengthMeters(feat.r, params);
      if (feat.r === undefined) {
        errors.push(`Sphere '${tag}' requires 'r'`);
      } else if (r !== null && r <= 0) {
        errors.push(`Sphere '${tag}' radius '${feat.r}' must be > 0`);
      }
    }

    if (type === "WorkPlane") {
      const children = Array.isArray(feat.sketch) ? feat.sketch : [];
      if (children.length === 0) {
        warnings.push(`WorkPlane '${tag}' has an empty 'sketch' array`);
      }
      for (const child of children) {
        if (!PRIMITIVES_2D_ONLY.has(child.type)) {
          errors.push(
            `WorkPlane '${tag}' sketch feature '${child.tag}' must be a 2D primitive (got '${child.type}')`
          );
        }
      }
    }

    if (type === "Extrude") {
      const inputs = Array.isArray(feat.input) ? feat.input : feat.input ? [feat.input] : [];
      if (inputs.length === 0) {
        errors.push(`Extrude '${tag}' requires 'input' referencing a prior WorkPlane tag`);
      }
      for (const inp of inputs) {
        if (!seenTags.has(inp)) {
          errors.push(`Extrude '${tag}' references input '${inp}' before it is defined`);
        }
      }
      const dist = parseLengthMeters(
        Array.isArray(feat.distance) ? feat.distance[0] : feat.distance,
        params
      );
      if (dist !== null && dist === 0) {
        errors.push(`Extrude '${tag}' distance evaluates to 0`);
      }
    }

    if (type === "Union" || type === "Intersection") {
      const inputs = Array.isArray(feat.input) ? feat.input : [];
      if (inputs.length < 2) {
        errors.push(`${type} '${tag}' requires at least 2 input tags in 'input'`);
      }
      for (const inp of inputs) {
        if (!seenTags.has(inp)) {
          errors.push(`${type} '${tag}' references unknown or later feature '${inp}'`);
        }
      }
      if (inputs.length >= 2 && boundsByTag[inputs[0]] && boundsByTag[inputs[1]]) {
        const check = analyzeBoxInteraction(boundsByTag[inputs[0]], boundsByTag[inputs[1]]);
        if (type === "Intersection" && check.intersects === false) {
          errors.push(
            `Intersection '${tag}' inputs '${inputs[0]}' and '${inputs[1]}' have disjoint bounding boxes (empty intersection)`
          );
        }
        if (type === "Union" && !check.touchesOrOverlaps && check.maxGap > 0 && check.maxGap < 1e-4) {
          warnings.push(
            `Union '${tag}' inputs '${inputs[0]}' and '${inputs[1]}' have a micro-gap (${check.maxGap.toExponential(2)} m) which may cause sliver mesh failures`
          );
        }
      }
    }

    if (type === "Difference") {
      const target = Array.isArray(feat.input) ? feat.input : [];
      const subtract = Array.isArray(feat.input2) ? feat.input2 : [];
      if (target.length === 0 || subtract.length === 0) {
        errors.push(
          `Difference '${tag}' requires non-empty 'input' (target objects) and 'input2' (objects to subtract)`
        );
      }
      for (const inp of [...target, ...subtract]) {
        if (!seenTags.has(inp)) {
          errors.push(`Difference '${tag}' references unknown or later feature '${inp}'`);
        }
      }
      if (target.length === 1 && subtract.length === 1) {
        const boxTarget = boundsByTag[target[0]];
        const boxTool = boundsByTag[subtract[0]];
        if (boxTarget && boxTool) {
          const check = analyzeBoxInteraction(boxTarget, boxTool);
          if (check.intersects === false) {
            errors.push(
              `Difference '${tag}': tool '${subtract[0]}' does not intersect target '${target[0]}' (subtraction has no effect)`
            );
          } else if (check.bContainsA) {
            errors.push(
              `Difference '${tag}': tool '${subtract[0]}' completely encloses target '${target[0]}' (result would be empty geometry)`
            );
          } else if (check.minOverlap > 0 && check.minOverlap < 1e-6) {
            warnings.push(
              `Difference '${tag}': tool '${subtract[0]}' overlaps '${target[0]}' by only ${check.minOverlap.toExponential(2)} m, risking sliver faces in COMSOL 6.2`
            );
          }
        }
      }
    }

    seenTags.add(tag);
    const aabb = computeFeatureAABB(feat, params, boundsByTag);
    if (aabb) {
      boundsByTag[tag] = aabb;
    }
  }

  for (const sel of selections) {
    if (!sel || !sel.tag) {
      errors.push("Selection entry is missing 'tag'");
      continue;
    }
    if (sel.type === "FaceBox" && (!sel.feature || !boundsByTag[sel.feature])) {
      errors.push(
        `FaceBox selection '${sel.tag}' references feature '${sel.feature}' without computable 3D bounds`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    boundsByTag
  };
}

function formatJavaStringArray(arr) {
  return `new String[]{${arr.map(x => JSON.stringify(String(x))).join(", ")}}`;
}

function buildFaceBoxBounds(aabb, face, tol = 1e-6) {
  const f = String(face || "").toLowerCase();
  if (f === "xmin" || f === "left" || f === "west") {
    return {
      xmin: aabb.xmin - tol,
      xmax: aabb.xmin + tol,
      ymin: aabb.ymin - tol,
      ymax: aabb.ymax + tol,
      zmin: aabb.zmin - tol,
      zmax: aabb.zmax + tol
    };
  }
  if (f === "xmax" || f === "right" || f === "east") {
    return {
      xmin: aabb.xmax - tol,
      xmax: aabb.xmax + tol,
      ymin: aabb.ymin - tol,
      ymax: aabb.ymax + tol,
      zmin: aabb.zmin - tol,
      zmax: aabb.zmax + tol
    };
  }
  if (f === "ymin" || f === "front" || f === "south") {
    return {
      xmin: aabb.xmin - tol,
      xmax: aabb.xmax + tol,
      ymin: aabb.ymin - tol,
      ymax: aabb.ymin + tol,
      zmin: aabb.zmin - tol,
      zmax: aabb.zmax + tol
    };
  }
  if (f === "ymax" || f === "back" || f === "north") {
    return {
      xmin: aabb.xmin - tol,
      xmax: aabb.xmax + tol,
      ymin: aabb.ymax - tol,
      ymax: aabb.ymax + tol,
      zmin: aabb.zmin - tol,
      zmax: aabb.zmax + tol
    };
  }
  if (f === "zmin" || f === "bottom" || f === "base") {
    return {
      xmin: aabb.xmin - tol,
      xmax: aabb.xmax + tol,
      ymin: aabb.ymin - tol,
      ymax: aabb.ymax + tol,
      zmin: aabb.zmin - tol,
      zmax: aabb.zmin + tol
    };
  }
  if (f === "zmax" || f === "top") {
    return {
      xmin: aabb.xmin - tol,
      xmax: aabb.xmax + tol,
      ymin: aabb.ymin - tol,
      ymax: aabb.ymax + tol,
      zmin: aabb.zmax - tol,
      zmax: aabb.zmax + tol
    };
  }
  throw new Error(`Unsupported FaceBox face '${face}' (expected xmin|xmax|ymin|ymax|zmin|zmax|bottom|top|left|right)`);
}

function compileGeometrySpecToJava(spec = {}, options = {}) {
  const validation = validateGeometrySpec(spec);
  if (!validation.valid) {
    return {
      status: "INVALID_GEOMETRY_SPEC",
      validation,
      javaCode: null
    };
  }

  const className = options.className || spec.className || "Comsol62GeometryModel";
  const compTag = spec.componentTag || "comp1";
  const geomTag = spec.geomTag || "geom1";
  const dim = spec.dimension ?? 3;
  const params = spec.parameters || {};
  const features = spec.features || [];
  const selections = spec.selections || [];

  const lines = [
    `import com.comsol.model.*;`,
    `import com.comsol.model.util.*;`,
    ``,
    `public class ${className} {`,
    `  public static Model buildGeometry(Model model) {`
  ];

  for (const [k, v] of Object.entries(params)) {
    lines.push(`    model.param().set(${JSON.stringify(k)}, ${JSON.stringify(String(v))});`);
  }

  lines.push(`    model.component().create(${JSON.stringify(compTag)}, true);`);
  lines.push(
    `    GeomSequence geom = model.component(${JSON.stringify(compTag)}).geom().create(${JSON.stringify(geomTag)}, ${dim});`
  );
  if (spec.lengthUnit) {
    lines.push(`    geom.lengthUnit(${JSON.stringify(spec.lengthUnit)});`);
  }

  for (const feat of features) {
    const t = JSON.stringify(feat.tag);
    lines.push(`    geom.create(${t}, ${JSON.stringify(feat.type)});`);
    if (feat.label) {
      lines.push(`    geom.feature(${t}).label(${JSON.stringify(feat.label)});`);
    }

    if (feat.type === "Block") {
      if (feat.base) {
        lines.push(`    geom.feature(${t}).set("base", ${JSON.stringify(feat.base)});`);
      }
      lines.push(`    geom.feature(${t}).set("size", ${formatJavaStringArray(feat.size)});`);
      if (Array.isArray(feat.pos)) {
        lines.push(`    geom.feature(${t}).set("pos", ${formatJavaStringArray(feat.pos)});`);
      }
    } else if (feat.type === "Cylinder") {
      lines.push(`    geom.feature(${t}).set("r", ${JSON.stringify(String(feat.r))});`);
      lines.push(`    geom.feature(${t}).set("h", ${JSON.stringify(String(feat.h))});`);
      if (Array.isArray(feat.pos)) {
        lines.push(`    geom.feature(${t}).set("pos", ${formatJavaStringArray(feat.pos)});`);
      }
      if (Array.isArray(feat.axis)) {
        lines.push(`    geom.feature(${t}).set("axis", ${formatJavaStringArray(feat.axis)});`);
      }
    } else if (feat.type === "Sphere") {
      lines.push(`    geom.feature(${t}).set("r", ${JSON.stringify(String(feat.r))});`);
      if (Array.isArray(feat.pos)) {
        lines.push(`    geom.feature(${t}).set("pos", ${formatJavaStringArray(feat.pos)});`);
      }
    } else if (feat.type === "Cone") {
      lines.push(`    geom.feature(${t}).set("r", ${JSON.stringify(String(feat.r))});`);
      lines.push(`    geom.feature(${t}).set("h", ${JSON.stringify(String(feat.h))});`);
      if (feat.r2 !== undefined) {
        lines.push(`    geom.feature(${t}).set("top", "radius");`);
        lines.push(`    geom.feature(${t}).set("r2", ${JSON.stringify(String(feat.r2))});`);
      }
      if (Array.isArray(feat.pos)) {
        lines.push(`    geom.feature(${t}).set("pos", ${formatJavaStringArray(feat.pos)});`);
      }
    } else if (feat.type === "WorkPlane") {
      lines.push(`    geom.feature(${t}).set("planetype", "quick");`);
      lines.push(`    geom.feature(${t}).set("quickplane", ${JSON.stringify(feat.quickplane || "xy")});`);
      if (feat.quickz !== undefined) {
        lines.push(`    geom.feature(${t}).set("quickz", ${JSON.stringify(String(feat.quickz))});`);
      }
      for (const child of feat.sketch || []) {
        const ct = JSON.stringify(child.tag);
        lines.push(`    geom.feature(${t}).geom().create(${ct}, ${JSON.stringify(child.type)});`);
        if (child.type === "Rectangle" && Array.isArray(child.size)) {
          lines.push(
            `    geom.feature(${t}).geom().feature(${ct}).set("size", ${formatJavaStringArray(child.size)});`
          );
        }
        if (child.type === "Circle" && child.r !== undefined) {
          lines.push(
            `    geom.feature(${t}).geom().feature(${ct}).set("r", ${JSON.stringify(String(child.r))});`
          );
        }
        if (Array.isArray(child.pos)) {
          lines.push(
            `    geom.feature(${t}).geom().feature(${ct}).set("pos", ${formatJavaStringArray(child.pos)});`
          );
        }
      }
    } else if (feat.type === "Extrude") {
      const inputs = Array.isArray(feat.input) ? feat.input : [feat.input];
      lines.push(`    geom.feature(${t}).selection("input").set(${formatJavaStringArray(inputs)});`);
      const dists = Array.isArray(feat.distance) ? feat.distance : [feat.distance];
      lines.push(`    geom.feature(${t}).set("distance", ${formatJavaStringArray(dists)});`);
    } else if (feat.type === "Union" || feat.type === "Intersection") {
      lines.push(`    geom.feature(${t}).selection("input").set(${formatJavaStringArray(feat.input)});`);
      if (feat.intbnd !== undefined) {
        lines.push(`    geom.feature(${t}).set("intbnd", ${Boolean(feat.intbnd)});`);
      }
      if (feat.keep !== undefined) {
        lines.push(`    geom.feature(${t}).set("keep", ${Boolean(feat.keep)});`);
      }
    } else if (feat.type === "Difference") {
      lines.push(`    geom.feature(${t}).selection("input").set(${formatJavaStringArray(feat.input)});`);
      lines.push(`    geom.feature(${t}).selection("input2").set(${formatJavaStringArray(feat.input2)});`);
      if (feat.intbnd !== undefined) {
        lines.push(`    geom.feature(${t}).set("intbnd", ${Boolean(feat.intbnd)});`);
      }
      if (feat.keep !== undefined) {
        lines.push(`    geom.feature(${t}).set("keep", ${Boolean(feat.keep)});`);
      }
    } else if (feat.type === "Array") {
      const inputs = Array.isArray(feat.input) ? feat.input : [feat.input];
      lines.push(`    geom.feature(${t}).selection("input").set(${formatJavaStringArray(inputs)});`);
      if (Array.isArray(feat.size)) {
        lines.push(`    geom.feature(${t}).set("fullsize", ${formatJavaStringArray(feat.size)});`);
      }
      if (Array.isArray(feat.displ)) {
        lines.push(`    geom.feature(${t}).set("displ", ${formatJavaStringArray(feat.displ)});`);
      }
    }

    if (feat.selresult !== false) {
      lines.push(`    geom.feature(${t}).set("selresult", true);`);
      lines.push(`    geom.feature(${t}).set("selresultshow", ${JSON.stringify(feat.selresultshow || "all")});`);
    }
  }

  if (spec.finalization && spec.finalization.action === "assembly") {
    lines.push(`    geom.feature("fin").set("action", "assembly");`);
    lines.push(`    geom.feature("fin").set("createpairs", true);`);
    lines.push(`    geom.feature("fin").set("imprint", true);`);
  }
  if (spec.finalization && spec.finalization.repairtol) {
    lines.push(`    geom.feature("fin").set("repairtoltype", "relative");`);
    lines.push(`    geom.feature("fin").set("repairtol", ${JSON.stringify(String(spec.finalization.repairtol))});`);
  }

  lines.push(`    geom.run("fin");`);

  // Coordinate-based Box selections (immune to COMSOL topological entity renumbering)
  for (const sel of selections) {
    const st = JSON.stringify(sel.tag);
    const entityDim = sel.entitydim ?? 2;
    let box = sel.box;
    if (sel.type === "FaceBox") {
      const featBounds = validation.boundsByTag[sel.feature];
      box = buildFaceBoxBounds(featBounds, sel.face, sel.tol ?? 1e-6);
    }
    if (box) {
      lines.push(`    model.component(${JSON.stringify(compTag)}).selection().create(${st}, "Box");`);
      if (sel.label) {
        lines.push(`    model.component(${JSON.stringify(compTag)}).selection(${st}).label(${JSON.stringify(sel.label)});`);
      }
      lines.push(`    model.component(${JSON.stringify(compTag)}).selection(${st}).set("entitydim", ${entityDim});`);
      lines.push(`    model.component(${JSON.stringify(compTag)}).selection(${st}).set("condition", ${JSON.stringify(sel.condition || "allvertices")});`);
      for (const key of ["xmin", "xmax", "ymin", "ymax", "zmin", "zmax"]) {
        if (box[key] !== undefined) {
          lines.push(
            `    model.component(${JSON.stringify(compTag)}).selection(${st}).set(${JSON.stringify(key)}, ${JSON.stringify(String(box[key]))});`
          );
        }
      }
    }
  }

  lines.push(
    `    return model;`,
    `  }`,
    ``,
    `  public static Model run() {`,
    `    Model model = ModelUtil.create("Model");`,
    `    return buildGeometry(model);`,
    `  }`,
    ``,
    `  public static void main(String[] args) {`,
    `    run();`,
    `  }`,
    `}`
  );

  return {
    status: "COMPILED_GEOMETRY_JAVA",
    className,
    validation,
    javaCode: lines.join("\n") + "\n"
  };
}

function auditJavaGeometryCode(sourceCode) {
  const code = String(sourceCode || "");
  const errors = [];
  const warnings = [];

  const is3DGeom = /\.geom\(\)\.create\(\s*"[^"]+"\s*,\s*3\s*\)/.test(code);
  if (is3DGeom) {
    const direct2DIn3D = code.match(
      /geom(?:\(\s*"[^"]+"\s*\))?\.create\(\s*"[^"]+"\s*,\s*"(Rectangle|Circle|Ellipse|Square)"\s*\)/
    );
    if (direct2DIn3D) {
      errors.push(
        `2D primitive '${direct2DIn3D[1]}' created directly on 3D geometry sequence; in COMSOL 6.2 it must be created inside a WorkPlane ('geom.feature("wp1").geom().create(...)')`
      );
    }
  }

  // Detect wrong boolean input property .set("input", ...) instead of .selection("input").set(...)
  if (/\.set\(\s*"(input|input2)"\s*,/.test(code)) {
    errors.push(
      `Invalid COMSOL 6.2 boolean/extrude input syntax '.set("input", ...)'; use '.selection("input").set(new String[]{...})'`
    );
  }

  // Detect Difference feature created without selection("input2")
  const diffCreates = [
    ...code.matchAll(/\.create\(\s*"([^"]+)"\s*,\s*"Difference"\s*\)/g)
  ].map(m => m[1]);
  for (const diffTag of diffCreates) {
    const escaped = diffTag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const hasInput2 = new RegExp(`feature\\(\\s*"${escaped}"\\s*\\)\\.selection\\(\\s*"input2"\\s*\\)`).test(
      code
    );
    if (!hasInput2) {
      errors.push(
        `Difference feature '${diffTag}' is missing '.feature("${diffTag}").selection("input2").set(new String[]{...})'`
      );
    }
  }

  // Detect hardcoded integer selections alongside boolean/array operations
  const hasBooleanOrArray = /"(Union|Difference|Intersection|Array|Extrude)"/.test(code);
  const hasHardcodedIntSelection = /\.selection\(\)\.set\(\s*new\s+int\[\]/.test(code);
  if (hasBooleanOrArray && hasHardcodedIntSelection) {
    warnings.push(
      `Hardcoded entity indices '.selection().set(new int[]{...})' detected alongside boolean/array operations; COMSOL 6.2 renumbers boundaries after booleans — prefer coordinate 'Box' selections or 'selresult' named selections`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

const GEOMETRY_PRESETS = {
  "microchannel-heatsink": {
    description: "COMSOL 6.2 3D copper heat sink with subtracted fluid microchannels and coordinate-based FaceBox selections",
    spec: {
      className: "MicrochannelHeatSinkGeom",
      dimension: 3,
      parameters: {
        L_sink: "10[mm]",
        W_sink: "6[mm]",
        H_sink: "2[mm]",
        W_chan: "1[mm]",
        H_chan: "1[mm]"
      },
      features: [
        {
          tag: "blk_sink",
          type: "Block",
          label: "Copper Substrate",
          size: ["L_sink", "W_sink", "H_sink"],
          pos: ["0[mm]", "0[mm]", "0[mm]"]
        },
        {
          tag: "blk_chan1",
          type: "Block",
          label: "Microchannel 1",
          size: ["L_sink", "W_chan", "H_chan"],
          pos: ["0[mm]", "1.5[mm]", "0.5[mm]"]
        },
        {
          tag: "blk_chan2",
          type: "Block",
          label: "Microchannel 2",
          size: ["L_sink", "W_chan", "H_chan"],
          pos: ["0[mm]", "3.5[mm]", "0.5[mm]"]
        },
        {
          tag: "dif_solid",
          type: "Difference",
          label: "Heat Sink with Channels",
          input: ["blk_sink"],
          input2: ["blk_chan1", "blk_chan2"],
          keep: false
        }
      ],
      selections: [
        {
          tag: "sel_heated_base",
          type: "FaceBox",
          feature: "blk_sink",
          face: "zmin",
          entitydim: 2,
          label: "Bottom Heated Chip Interface"
        },
        {
          tag: "sel_top_wall",
          type: "FaceBox",
          feature: "blk_sink",
          face: "zmax",
          entitydim: 2,
          label: "Top Insulated Boundary"
        }
      ]
    }
  },
  "core-shell-cylinder": {
    description: "COMSOL 6.2 3D coaxial core-shell cylinder with assembly imprint and FaceBox end selections",
    spec: {
      className: "CoreShellCylinderGeom",
      dimension: 3,
      parameters: {
        R_outer: "5[mm]",
        R_inner: "2[mm]",
        H_cyl: "20[mm]"
      },
      features: [
        {
          tag: "cyl_outer",
          type: "Cylinder",
          label: "Outer Shell",
          r: "R_outer",
          h: "H_cyl",
          pos: ["0[mm]", "0[mm]", "0[mm]"]
        },
        {
          tag: "cyl_inner",
          type: "Cylinder",
          label: "Inner Core",
          r: "R_inner",
          h: "H_cyl",
          pos: ["0[mm]", "0[mm]", "0[mm]"]
        },
        {
          tag: "dif_shell",
          type: "Difference",
          label: "Hollow Shell",
          input: ["cyl_outer"],
          input2: ["cyl_inner"],
          keep: true
        }
      ],
      selections: [
        {
          tag: "sel_inlet_bottom",
          type: "FaceBox",
          feature: "cyl_inner",
          face: "zmin",
          entitydim: 2,
          label: "Core Bottom Inlet"
        },
        {
          tag: "sel_outlet_top",
          type: "FaceBox",
          feature: "cyl_inner",
          face: "zmax",
          entitydim: 2,
          label: "Core Top Outlet"
        }
      ]
    }
  }
};

function getGeometryPreset(name) {
  const key = String(name || "").toLowerCase().trim();
  if (!GEOMETRY_PRESETS[key]) {
    throw new Error(
      `Unknown geometry preset '${name}'. Available: ${Object.keys(GEOMETRY_PRESETS).join(", ")}`
    );
  }
  return { name: key, ...GEOMETRY_PRESETS[key] };
}

function listGeometryPresets() {
  return Object.entries(GEOMETRY_PRESETS).map(([name, info]) => ({
    name,
    description: info.description
  }));
}

module.exports = {
  parseLengthMeters,
  computeFeatureAABB,
  analyzeBoxInteraction,
  validateGeometrySpec,
  compileGeometrySpecToJava,
  auditJavaGeometryCode,
  getGeometryPreset,
  listGeometryPresets,
  GEOMETRY_PRESETS
};
