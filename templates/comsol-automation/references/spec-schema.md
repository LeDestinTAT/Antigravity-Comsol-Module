# COMSOL 6.2 Automation Model Specification & Patch Schema

This reference defines the structured JSON schemas used by `comsol.cjs` for declarative modeling, validation, geometry construction, physics configuration, and tuning.

---

## 1. Top-Level Model Specification Schema (`spec.json`)

```json
{
  "className": "MyComsolModel",
  "geometryPreset": "microchannel-heatsink", // Optional: Inherit from built-in geometry preset
  "parameters": {
    "L": "10[mm]",
    "W": "5[mm]",
    "H": "2[mm]",
    "T_in": "293.15[K]"
  },
  "geometry": { ... },                       // Required if geometryPreset is not specified
  "materials": [ ... ],                      // Required for multiphysics simulations
  "physics": [ ... ],                        // List of physics interfaces & boundary features
  "couplings": [ ... ],                      // Multiphysics couplings (optional)
  "study": { ... }                           // Study & solver configuration (optional)
}
```

---

## 2. Declarative Geometry Specification (`spec.geometry`)

```json
{
  "dimension": 3,
  "parameters": {
    "L": "20[mm]",
    "W": "10[mm]",
    "H": "5[mm]"
  },
  "features": [
    {
      "tag": "blk1",
      "type": "Block",
      "size": ["L", "W", "H"],
      "pos": ["0[mm]", "0[mm]", "0[mm]"],
      "label": "Solid Substrate"
    },
    {
      "tag": "cyl1",
      "type": "Cylinder",
      "r": "2[mm]",
      "h": "H",
      "pos": ["5[mm]", "5[mm]", "0[mm]"],
      "axis": [0, 0, 1]
    },
    {
      "tag": "dif1",
      "type": "Difference",
      "input": ["blk1"],
      "input2": ["cyl1"],
      "keep": false
    }
  ],
  "selections": [
    {
      "tag": "sel_inlet",
      "type": "FaceBox",
      "feature": "blk1",
      "face": "xmin",
      "entitydim": 2,
      "label": "Inlet Boundary"
    },
    {
      "tag": "sel_fixed_base",
      "type": "Box",
      "entitydim": 2,
      "condition": "allvertices",
      "xmin": "-1e-6[m]",
      "xmax": "L+1e-6[m]",
      "ymin": "-1e-6[m]",
      "ymax": "W+1e-6[m]",
      "zmin": "-1e-6[m]",
      "zmax": "1e-6[m]"
    }
  ]
}
```

### Supported Geometry Feature Types
- **3D Primitives**: `Block` (`size`, `pos`), `Cylinder` (`r`, `h`, `pos`, `axis`), `Sphere` (`r`, `pos`), `Cone`, `Torus`, `Ellipsoid`.
- **2D Primitives in 3D**: `Rectangle`, `Circle` (MUST be wrapped inside a `WorkPlane`).
- **WorkPlane**: `quickplane: "xy"|"yz"|"zx"`, `quickz`, `sketch: [...]`.
- **Booleans**: `Union`, `Intersection` (`input: [...]`), `Difference` (`input: [...]`, `input2: [...]`, `keep: true|false`).
- **Transforms**: `Extrude` (`distance`, `workplane`), `Revolve`, `Move`, `Rotate`, `Array`.
- **Selections**:
  - `FaceBox`: Auto-calculates AABB slice for a specific face of a feature (`face: "xmin"|"xmax"|"ymin"|"ymax"|"zmin"|"zmax"`).
  - `Box`: User-defined bounding coordinates (`xmin`, `xmax`, `ymin`, `ymax`, `zmin`, `zmax`, `condition: "allvertices"|"somevertices"`).

---

## 3. Physics & Boundary Condition Schema (`spec.physics`)

```json
[
  {
    "tag": "spf",
    "type": "LaminarFlow",
    "initialValues": {
      "u": ["U_in", "0", "0"],
      "p": "0[Pa]"
    },
    "features": [
      {
        "tag": "inl1",
        "type": "InletBoundary",
        "selection": "sel_inlet",
        "props": { "U0in": "U_in" }
      },
      {
        "tag": "out1",
        "type": "OutletBoundary",
        "selection": "sel_outlet",
        "props": { "p0": "0[Pa]" }
      }
    ]
  },
  {
    "tag": "ht",
    "type": "HeatTransfer",
    "initialValues": { "T": "T_in" },
    "features": [
      {
        "tag": "temp1",
        "type": "TemperatureBoundary",
        "selection": "sel_inlet",
        "props": { "T0": "T_in" }
      },
      {
        "tag": "hf1",
        "type": "ConvectiveHeatFlux",
        "selection": "sel_top_wall",
        "props": { "h": "25[W/(m^2*K)]", "Text": "293.15[K]" }
      }
    ]
  }
]
```

### Supported Physics Interfaces & Constraints (Comprehensive Multiphysics)
| 物理领域 (Domain) | 物理场接口 (Type) | 默认标识 (Tag) | 求解因变量 (Vars) | 必需材料属性 (Material Props) | 必需参考约束 / 边界条件 (Reference Constraints) |
| :--- | :--- | :---: | :---: | :--- | :--- |
| **Mechanics** | `SolidMechanics` | `solid` | `u` | `density`, `youngsmodulus`, `poissonsratio` | `Fixed`, `PrescribedDisplacement`, `Roller`, `Symmetry` |
| **Fluid** | `LaminarFlow` | `spf` | `u`, `p` | `density`, `dynamicviscosity` | 参考约束: `OutletBoundary`, `PressurePointConstraint`, `OpenBoundary`<br>驱动源: `InletBoundary`, `MovingWall`, `OpenBoundary` |
| **Thermal** | `HeatTransfer` | `ht` | `T` | `thermalconductivity`, `density`, `heatcapacity` | `TemperatureBoundary`, `ConvectiveHeatFlux`, `DiffuseSurface`, `ThermalInsulation` |
| **Acoustics** | `PressureAcoustics` | `acpr` | `p` | `density`, `soundspeed` | `SoundHardWall`, `SoundSoftWall`, `Pressure`, `NormalAcceleration`, `NormalVelocity`, `Impedance`, `RadiationCondition` |
| **Wave Optics / RF** | `ElectromagneticWavesFrequencyDomain` / `WaveOptics` | `ewfd` | `E` | `relpermittivity`, `relpermeability` | `PerfectElectricConductor`, `PerfectMagneticConductor`, `Port`, `ScatteringBoundaryCondition`, `ElectricField`, `MagneticField` |
| **Electrostatics** | `Electrostatics` | `es` | `V` | `relpermittivity` | `Ground`, `ElectricPotential`, `ZeroCharge` |
| **Electric Currents** | `ElectricCurrents` | `ec` | `V` | `electricconductivity` | `Ground`, `ElectricPotential`, `NormalCurrentDensity`, `ElectricInsulation` |
| **Magnetic Fields** | `MagneticFields` | `mf` | `A` | `relpermeability`, `electricconductivity` | `MagneticInsulation`, `MagneticPotential`, `SurfaceCurrent`, `ExternalCurrentDensity` |

---

## 4. Materials Schema (`spec.materials`)

```json
[
  {
    "tag": "mat_copper",
    "label": "Pure Copper",
    "selection": "all",
    "properties": {
      "density": "8960[kg/m^3]",
      "thermalconductivity": ["400[W/(m*K)]"],
      "heatcapacity": "385[J/(kg*K)]",
      "electricconductivity": "5.998e7[S/m]",
      "youngsmodulus": "110e9[Pa]",
      "poissonsratio": "0.35",
      "relpermeability": "1",
      "relpermittivity": "1",
      "soundspeed": "4600[m/s]"
    }
  }
]
```

---

## 5. Multiphysics Couplings (`spec.couplings`)

跨领域多物理场耦合接口涵盖结构力学、流体、热传导、声学、波动光学与电磁学之间的协同作用：

```json
[
  {
    "tag": "nitf1",
    "type": "NonIsothermalFlow",
    "selection": "all",
    "physics": { "Fluid_physics": "spf", "Heat_physics": "ht" }
  },
  {
    "tag": "te1",
    "type": "ThermalExpansion",
    "selection": "all",
    "physics": { "Solid_physics": "solid", "Heat_physics": "ht" }
  },
  {
    "tag": "emh1",
    "type": "ElectromagneticHeating",
    "selection": "all",
    "physics": { "Electromagnetic_physics": "ewfd", "Heat_physics": "ht" }
  },
  {
    "tag": "fsi1",
    "type": "FluidStructureInteraction",
    "selection": "all",
    "physics": { "Fluid_physics": "spf", "Solid_physics": "solid" }
  },
  {
    "tag": "asb1",
    "type": "AcousticStructureBoundary",
    "selection": "sel_interface",
    "physics": { "Acoustic_physics": "acpr", "Solid_physics": "solid" }
  },
  {
    "tag": "pzd1",
    "type": "Piezoelectricity",
    "selection": "all",
    "physics": { "Solid_physics": "solid", "Electrostatics_physics": "es" }
  },
  {
    "tag": "lor1",
    "type": "LorentzForce",
    "selection": "all",
    "physics": { "Magnetic_physics": "mf", "Solid_physics": "solid" }
  }
]
```

---

## 6. Model Tuning Patch Schema (`patch.json`)

Used with `node ~/.dual-agent/comsol.cjs tune-model --spec <spec.json> --patch <patch.json>`.

```json
{
  "parameters": {
    "T_in": "310[K]",
    "U_in": "0.5[m/s]"
  },
  "initialValues": {
    "ht": { "T": "310[K]" },
    "spf": { "u": ["0.5[m/s]", "0", "0"], "p": "0[Pa]" }
  },
  "boundaryOverrides": [
    {
      "physicsTag": "ht",
      "featureTag": "hf1",
      "type": "HeatFluxBoundary",
      "props": { "q0": "1e5[W/m^2]" }
    }
  ],
  "addFeatures": {
    "ht": [
      {
        "tag": "ins1",
        "type": "ThermalInsulation",
        "selection": "sel_side_walls"
      }
    ]
  },
  "studyTuning": {
    "continuationParam": "U_in",
    "continuationList": "0.05 0.1 0.2 0.5"
  },
  "autoAlignInitialValues": true
}
```
