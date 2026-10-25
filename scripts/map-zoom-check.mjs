import { readFileSync } from 'fs';
import { resolve } from 'path';

// Automated diagnostic test for Campus Map zooming and rendering pipeline
const mapPath = resolve('src/components/CampusMap/CampusMap.jsx');
const cssPath = resolve('src/components/CampusMap/CampusMap.module.css');

const mapCode = readFileSync(mapPath, 'utf8');
const cssCode = readFileSync(cssPath, 'utf8');

const checks = [];

function check(name, pass, detail = '') {
  checks.push({ name, pass, detail });
  console.log(`${pass ? '✅ PASS' : '❌ FAIL'}: ${name} ${detail ? '(' + detail + ')' : ''}`);
}

// 1. Direct DOM manipulation ref for transform group to avoid React reconciliation during wheel
const hasGroupRef = mapCode.includes('mapGroupRef');
check('Transform group uses direct DOM ref during zoom/pan', hasGroupRef, 'Bypasses full React tree diffing on scroll');

// 2. Wheel zoom delta calibration: factor should be small and smooth, not huge steps
const hasSmoothExp = mapCode.includes('Math.exp');
check('Wheel zoom uses continuous exponential dampening', hasSmoothExp);

// 3. Wheel delta multiplier should be calibrated for smooth continuous scrolling (<= 0.0016)
const expMatch = mapCode.match(/Math\.exp\(-normalizedDelta\s*\*\s*([0-9.]+)\)/);
const multiplier = expMatch ? parseFloat(expMatch[1]) : 1;
const isMultiplierGentle = multiplier <= 0.0016;
check('Wheel zoom sensitivity is gentle (<= 0.0016 per px)', isMultiplierGentle, `found ${multiplier}`);

// 4. Viewport size expansion: Check viewportContainer height
const viewportHeightMatch = cssCode.match(/\.viewportContainer\s*\{[^}]*[\s\n]height:\s*([^;]+);/);
const viewportHeight = viewportHeightMatch ? viewportHeightMatch[1].trim() : '';
const isExpanded = viewportHeight.includes('84vh') || viewportHeight.includes('calc(100vh') || viewportHeight.includes('82vh');
check('Viewport container is expanded for expansive layout', isExpanded, `found ${viewportHeight}`);

// 5. CSS transition disabled during dragging and zooming
const hasNoTransition = cssCode.includes('transition: none !important');
check('Interactive dragging and zooming suppress CSS transitions', hasNoTransition);

const allPassed = checks.every(c => c.pass);
if (!allPassed) {
  console.error('\nDiagnostic loop detected failures in smoothness/performance assertions.');
  process.exit(1);
} else {
  console.log('\nAll diagnostic performance criteria passed!');
  process.exit(0);
}
