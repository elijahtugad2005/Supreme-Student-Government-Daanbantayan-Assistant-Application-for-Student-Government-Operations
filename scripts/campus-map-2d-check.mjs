// scripts/campus-map-2d-check.mjs
// Verification suite: Complete removal of 2.5D isometric view in CampusMap.

import { readFileSync } from 'node:fs';

const mapCode = readFileSync('src/components/CampusMap/CampusMap.jsx', 'utf8');
const cssCode = readFileSync('src/components/CampusMap/CampusMap.module.css', 'utf8');

let failed = 0;
const results = [];

function check(label, condition, detail = '') {
  if (condition) {
    results.push(`ok   ${label}`);
  } else {
    failed++;
    results.push(`FAIL ${label}${detail ? ` -> ${detail}` : ''}`);
  }
}

console.log('=== Checking 2.5D Isometric Removal in CampusMap.jsx ===');

check(
  'viewMode state is removed',
  !mapCode.includes("const [viewMode, setViewMode]") && !mapCode.includes("viewMode === '2.5d'"),
  'found viewMode state'
);

check(
  'isIsometric variable is removed',
  !mapCode.includes("const isIsometric ="),
  'found isIsometric variable declaration'
);

check(
  'isoAngle and extrudeScale state variables are removed',
  !mapCode.includes("const [isoAngle, setIsoAngle]") && !mapCode.includes("const [extrudeScale, setExtrudeScale]"),
  'found isoAngle or extrudeScale state'
);

check(
  '2.5D Isometric mode button is removed from UI',
  !mapCode.includes("2.5D Isometric"),
  'found "2.5D Isometric" button or label'
);

check(
  'Mobile 2.5D toggle button is removed',
  !mapCode.includes("Toggle 2D / 2.5D Isometric view"),
  'found mobile 2D/2.5D toggle FAB button'
);

check(
  'mapSvgWrapper does NOT apply rotateX or rotateZ 3D isometric perspective transform',
  !mapCode.includes("rotateX(") && !mapCode.includes("rotateZ(-22deg)"),
  'found rotateX or rotateZ tilt in mapSvgWrapper'
);

check(
  'mapSvgWrapperIsometric class is removed from JSX',
  !mapCode.includes("styles.mapSvgWrapperIsometric"),
  'found styles.mapSvgWrapperIsometric in JSX'
);

check(
  'BuildingFeatureItem does not render 2.5D extruded walls or height offsets',
  !mapCode.includes("wallFacets?.map") && !mapCode.includes("const h = isIsometric"),
  'found wallFacets or 3D height extrusion in BuildingFeatureItem'
);

check(
  'Compass needle points directly North (0deg)',
  !mapCode.includes("isIsometric ? 'rotate(-22deg)' : 'rotate(0deg)'"),
  'found conditional isometric compass rotation'
);

console.log('\n=== Results Summary ===');
console.log(results.join('\n'));
if (failed > 0) {
  console.log(`\n❌ ${failed} CHECKS FAILED.`);
  process.exit(1);
} else {
  console.log('\n✅ All 2.5D isometric view removal checks passed.');
  process.exit(0);
}
