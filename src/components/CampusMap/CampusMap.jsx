// components/CampusMap/CampusMap.jsx
// PURPOSE: Interactive Eagle-Eye 2D Sky Map of CTU Daanbantayan Campus
// FEATURES:
//   - Native SVG vector projection from real GeoJSON (CTU.json)
//   - Exact perimeter boundary (54,525 m² area, 987.92 m perimeter)
//   - Full building footprint polygons with interactive hover and click inspection
//   - Pan, pinch-to-zoom, and smooth focus-to-building camera animations
//   - Tactical dark-mode editorial HUD styling with compass rose and GPS telemetry
//   - Live integration with campus announcements and venue dispatches

import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import ctuMapData from '../../data/CTU.json';
import { db } from '../../firebase/firebaseConfig.js';
import { collection, onSnapshot, doc, setDoc } from 'firebase/firestore';
import { usePermissions } from '../../hooks/usePermissions.js';
import { useTheme } from '../../contexts/ThemeContext.jsx';
import {
  HiSearch,
  HiZoomIn,
  HiZoomOut,
  HiRefresh,
  HiLocationMarker,
  HiChevronRight,
  HiX,
  HiSpeakerphone,
  HiTag,
  HiExternalLink,
  HiInformationCircle,
  HiViewGrid,
  HiGlobeAlt
} from 'react-icons/hi';
import {
  FiMaximize2,
  FiCompass,
  FiMapPin,
  FiLayers,
  FiNavigation,
  FiCheck,
  FiCopy
} from 'react-icons/fi';
import styles from './CampusMap.module.css';

// SVG Canvas Coordinate Dimensions (Matches campus real-world aspect ratio ~1:1.7)
const SVG_WIDTH = 1100;
const SVG_HEIGHT = 1850;
const PADDING = 70;

// Geographic Bounding Box for CTU Daanbantayan Campus
const BOUNDS = {
  minLng: 124.007686,
  maxLng: 124.009663,
  minLat: 11.264905,
  maxLat: 11.268251,
};

// High-Resolution Satellite Imagery Metadata (Zoom 18 ArcGIS World Imagery Tiles)
const SATELLITE_Z = 18;
const SATELLITE_TILES_META = [
  { x: 221371, y: 122813 },
  { x: 221372, y: 122813 },
  { x: 221373, y: 122813 },
  { x: 221371, y: 122814 },
  { x: 221372, y: 122814 },
  { x: 221373, y: 122814 },
  { x: 221371, y: 122815 },
  { x: 221372, y: 122815 },
  { x: 221373, y: 122815 },
];

function tile2lon(x, z) {
  return (x / Math.pow(2, z)) * 360 - 180;
}
function tile2lat(y, z) {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

// Categorization helper for all 35 campus features in Crimson Theme
const getFeatureCategory = (name) => {
  const n = (name || '').toUpperCase();
  if (n === 'CTU SHAPE') return { id: 'boundary', label: 'Campus Boundary', color: '#881337' };
  if (n === 'CTU OVAL') return { id: 'athletics', label: 'Sports Complex', color: '#10B981' };
  if (n.includes('GYM') || n.includes('KALAMBUAN')) return { id: 'athletics', label: 'Sports & Athletics', color: '#BE123C' };
  if (n.includes('QUADRANGLE')) return { id: 'athletics', label: 'Open Grounds', color: '#059669' };

  if (n.includes('ADMIN') || n.includes('MIS') || n.includes('GUARD') || n.includes('GAD') || n.includes('FINANCE')) {
    return { id: 'governance', label: 'Administration & Governance', color: '#991B1B' };
  }
  if (n.includes('BEACH') || n.includes('VOLLEY')) {
    return { id: 'athletics', label: 'Beach Volleyball Court', color: '#D97706' };
  }
  if (n.includes('SSG')) {
    return { id: 'governance', label: 'Supreme Student Government', color: '#D4AF37' };
  }

  if (n.includes('FOOD') || n.includes('COURT')) {
    return { id: 'studentLife', label: 'Food Court Ground Plaza', color: '#E11D48' };
  }
  if (n.includes('CANTEEN') || n.includes('LOUNGE') || n.includes('STAGE')) {
    return { id: 'studentLife', label: 'Student Amenities & Dining', color: '#FB7185' };
  }

  if (n.includes('MSR') || n.includes('MAINTENANCE')) {
    return { id: 'workshops', label: 'Departmental MSR & Labs', color: '#9333EA' };
  }

  return { id: 'academic', label: 'Academic & Classrooms', color: '#BE185D' };
};

// Real-world architectural height generator for 2.5D extrusion (in SVG units)
const getFeatureHeight = (name) => {
  const n = (name || '').toUpperCase();
  if (n === 'CTU SHAPE' || n === 'CTU OVAL') return 0;
  if (n.includes('FOOD') || n.includes('COURT') || n.includes('QUADRANGLE') || n.includes('BEACH') || n.includes('VOLLEY')) return 0; // Flat ground plaza/court
  if (n.includes('EDUCATION BUILDING 1')) return 32; // 2-story multistory academic complex
  if (n.includes('GYM') || n.includes('KALAMBUAN')) return 28;
  if (n.includes('ADMIN') || n.includes('MIS')) return 24;
  if (n.includes('FINANCE')) return 22;
  if (n.includes('SSG')) return 20;
  if (n.includes('CANTEEN') || n.includes('LOUNGE')) return 12;
  if (n.includes('MSR') || n.includes('WORKSHOP') || n.includes('MAINTENANCE')) return 16;
  if (n.includes('GUARD') || n.includes('KIOSK')) return 10;
  return 18; // Default academic single/intermediate hall
};

// Category Filters for the HUD Filter Bar
const MAP_CATEGORIES = [
  { id: 'ALL', label: 'All Locations' },
  { id: 'academic', label: 'Academic & Halls' },
  { id: 'governance', label: 'Admin & SSG' },
  { id: 'athletics', label: 'Sports & Oval' },
  { id: 'studentLife', label: 'Dining & Lounges' },
  { id: 'workshops', label: 'MSR & Workshops' },
];

// Tasteful starter trees positioned along sports oval, campus walkways & quadrangle
const DEFAULT_CAMPUS_TREES = [
  // West perimeter along the athletic running oval
  { id: 'tree-oval-w1', x: 250, y: 680, type: 'acacia', scale: 1.15 },
  { id: 'tree-oval-w2', x: 245, y: 780, type: 'mango', scale: 1.05 },
  { id: 'tree-oval-w3', x: 240, y: 890, type: 'palm', scale: 1.1 },
  { id: 'tree-oval-w4', x: 238, y: 1000, type: 'acacia', scale: 1.2 },
  { id: 'tree-oval-w5', x: 242, y: 1110, type: 'mango', scale: 1.0 },
  { id: 'tree-oval-w6', x: 248, y: 1220, type: 'palm', scale: 1.05 },
  { id: 'tree-oval-w7', x: 258, y: 1330, type: 'acacia', scale: 1.1 },
  { id: 'tree-oval-w8', x: 275, y: 1430, type: 'mango', scale: 1.05 },

  // East perimeter of the athletic running oval
  { id: 'tree-oval-e1', x: 595, y: 690, type: 'palm', scale: 1.05 },
  { id: 'tree-oval-e2', x: 605, y: 800, type: 'mango', scale: 1.0 },
  { id: 'tree-oval-e3', x: 610, y: 920, type: 'acacia', scale: 1.15 },
  { id: 'tree-oval-e4', x: 612, y: 1040, type: 'palm', scale: 1.1 },
  { id: 'tree-oval-e5', x: 605, y: 1160, type: 'mango', scale: 1.05 },
  { id: 'tree-oval-e6', x: 595, y: 1280, type: 'acacia', scale: 1.2 },
  { id: 'tree-oval-e7', x: 580, y: 1390, type: 'palm', scale: 1.0 },

  // Campus Main Entrance & Administrative Courtyard Greenery
  { id: 'tree-adm-1', x: 740, y: 710, type: 'palm', scale: 1.1 },
  { id: 'tree-adm-2', x: 780, y: 740, type: 'acacia', scale: 1.1 },
  { id: 'tree-adm-3', x: 820, y: 710, type: 'palm', scale: 1.15 },
  { id: 'tree-adm-4', x: 870, y: 840, type: 'mango', scale: 1.05 },
  { id: 'tree-adm-5', x: 760, y: 890, type: 'acacia', scale: 1.05 },

  // Student Central Quadrangle & Garden Promenade
  { id: 'tree-quad-1', x: 720, y: 1080, type: 'mango', scale: 1.1 },
  { id: 'tree-quad-2', x: 765, y: 1140, type: 'acacia', scale: 1.15 },
  { id: 'tree-quad-3', x: 710, y: 1210, type: 'palm', scale: 1.05 },
  { id: 'tree-quad-4', x: 795, y: 1260, type: 'mango', scale: 1.1 },
  { id: 'tree-quad-5', x: 730, y: 1330, type: 'acacia', scale: 1.2 },

  // South Academic & Workshop Promenade
  { id: 'tree-sth-1', x: 640, y: 1470, type: 'palm', scale: 1.0 },
  { id: 'tree-sth-2', x: 720, y: 1490, type: 'acacia', scale: 1.1 },
  { id: 'tree-sth-3', x: 810, y: 1480, type: 'mango', scale: 1.05 }
];

// Lightweight, High-Detail 2.5D Isometric Tree Component
const IsometricTree = React.memo(({ tree, isIsometric, isAdmin, isPlantingMode, showMangoFruits, onRemove }) => {
  const { x, y, scale = 1.0 } = tree;
  // Normalize legacy tree types (e.g. 'pine'/'conifer' -> 'mango', 'canopy' -> 'acacia')
  const rawType = (tree.type || '').toLowerCase();
  const type = (rawType === 'pine' || rawType === 'conifer' || rawType === 'mango')
    ? 'mango'
    : (rawType === 'canopy' || rawType === 'acacia')
      ? 'acacia'
      : 'palm';

  return (
    <g
      className={styles.treeGroup}
      onClick={(e) => {
        if (isAdmin && isPlantingMode && onRemove) {
          e.stopPropagation();
          onRemove(tree.id);
        }
      }}
      style={{
        cursor: isAdmin && isPlantingMode ? 'pointer' : 'default',
        transformOrigin: `${x}px ${y}px`,
        transform: `scale(${scale})`
      }}
    >
      {/* 1. Ground Cast Shadow */}
      <ellipse
        cx={x + (isIsometric ? 7 : 0)}
        cy={y + (isIsometric ? 2 : 0)}
        rx={type === 'acacia' ? 15 : 12}
        ry={isIsometric ? 5 : 9}
        className={styles.treeShadow}
      />

      {/* 2. Variety: Philippine Acacia (Rain Tree - Samanea saman) */}
      {type === 'acacia' && (
        <g>
          {isIsometric ? (
            <>
              {/* Spreading Wood Limbs & Gnarled Trunk */}
              <path
                d={`M ${x - 2.5} ${y} L ${x - 1.8} ${y - 12} L ${x + 1.8} ${y - 12} L ${x + 2.5} ${y} Z`}
                fill="#3E1C0A"
              />
              <path
                d={`M ${x - 1} ${y - 10} Q ${x - 9} ${y - 16} ${x - 16} ${y - 23}`}
                stroke="#3E1C0A"
                strokeWidth="2.8"
                strokeLinecap="round"
                fill="none"
              />
              <path
                d={`M ${x + 1} ${y - 10} Q ${x + 9} ${y - 16} ${x + 16} ${y - 23}`}
                stroke="#3E1C0A"
                strokeWidth="2.8"
                strokeLinecap="round"
                fill="none"
              />
              <path
                d={`M ${x} ${y - 11} L ${x} ${y - 25}`}
                stroke="#3E1C0A"
                strokeWidth="2.2"
                strokeLinecap="round"
                fill="none"
              />

              {/* Wide Tiered Umbrella Canopy */}
              <ellipse cx={x} cy={y - 25} rx={22} ry={9.5} fill="#064E3B" />
              <ellipse cx={x - 13} cy={y - 26} rx={11} ry={7.5} fill="#065F46" />
              <ellipse cx={x + 13} cy={y - 26} rx={11} ry={7.5} fill="#047857" />
              <ellipse cx={x} cy={y - 30} rx={17} ry={9} fill="#059669" />
              <ellipse cx={x - 7} cy={y - 32} rx={10} ry={5.5} fill="#10B981" />
              <ellipse cx={x + 7} cy={y - 32} rx={9} ry={5} fill="#10B981" />
              <ellipse cx={x} cy={y - 35} rx={8} ry={4} fill="#34D399" opacity="0.9" />

              {/* Delicate Rain Tree Pink Puff Blossoms */}
              <circle cx={x - 13} cy={y - 27} r={1.6} fill="#F472B6" opacity="0.9" />
              <circle cx={x - 5} cy={y - 33} r={1.8} fill="#FB7185" opacity="0.95" />
              <circle cx={x + 6} cy={y - 33} r={1.7} fill="#F472B6" opacity="0.9" />
              <circle cx={x + 14} cy={y - 28} r={1.8} fill="#FDA4AF" opacity="0.95" />
              <circle cx={x} cy={y - 36} r={2} fill="#F472B6" opacity="0.95" />
            </>
          ) : (
            // 2D Sky View: Wide Umbrella Acacia Crown
            <>
              <circle cx={x} cy={y} r="15" fill="#064E3B" />
              <circle cx={x - 7} cy={y} r="10" fill="#065F46" />
              <circle cx={x + 7} cy={y} r="10" fill="#047857" />
              <circle cx={x} cy={y - 2} r="11" fill="#059669" />
              <circle cx={x - 2} cy={y - 3} r="7" fill="#10B981" />
              <circle cx={x - 3} cy={y - 4} r="3" fill="#34D399" opacity="0.9" />
              <circle cx={x - 8} cy={y - 2} r={1.6} fill="#F472B6" />
              <circle cx={x + 8} cy={y - 3} r={1.6} fill="#FB7185" />
              <circle cx={x} cy={y - 6} r={1.8} fill="#F472B6" />
            </>
          )}
        </g>
      )}

      {/* 3. Variety: Philippine Mango Tree (Carabao Mango - Mangifera indica) */}
      {type === 'mango' && (
        <g>
          {isIsometric ? (
            <>
              {/* Sturdy Gnarled Mango Trunk */}
              <path
                d={`M ${x - 3} ${y} Q ${x - 2} ${y - 8} ${x - 1} ${y - 15} L ${x + 1.5} ${y - 15} Q ${x + 2} ${y - 8} ${x + 3} ${y} Z`}
                fill="#451A03"
              />
              <path
                d={`M ${x - 0.5} ${y - 14} Q ${x - 6} ${y - 20} ${x - 9} ${y - 24}`}
                stroke="#451A03"
                strokeWidth="2.4"
                strokeLinecap="round"
                fill="none"
              />
              <path
                d={`M ${x + 0.5} ${y - 14} Q ${x + 6} ${y - 20} ${x + 9} ${y - 24}`}
                stroke="#451A03"
                strokeWidth="2.4"
                strokeLinecap="round"
                fill="none"
              />

              {/* Dense Rounded Mango Canopy */}
              <ellipse cx={x} cy={y - 24} rx={16} ry={13} fill="#064E3B" />
              <ellipse cx={x - 8} cy={y - 23} rx={9.5} ry={8} fill="#065F46" />
              <ellipse cx={x + 8} cy={y - 23} rx={9.5} ry={8} fill="#047857" />
              <ellipse cx={x} cy={y - 29} rx={12} ry={9.5} fill="#059669" />
              <ellipse cx={x - 4} cy={y - 31} rx={8} ry={6} fill="#10B981" />
              <ellipse cx={x + 4} cy={y - 28} rx={7} ry={5} fill="#10B981" />
              <circle cx={x - 4} cy={y - 33} r={3} fill="#34D399" opacity="0.85" />

              {/* Leaf Texture Details */}
              <circle cx={x - 10} cy={y - 20} r="1.2" fill="#064E3B" opacity="0.6" />
              <circle cx={x + 10} cy={y - 21} r="1.2" fill="#064E3B" opacity="0.6" />

              {/* 🌟 SECRET EASTER EGG: Hanging Ripe Golden Carabao Mangoes in March & May */}
              {showMangoFruits && (
                <g className={styles.mangoFruitCluster}>
                  {[
                    { fx: x - 10, fy: y - 20, rot: -15 },
                    { fx: x - 4, fy: y - 16, rot: 10 },
                    { fx: x + 6, fy: y - 19, rot: -8 },
                    { fx: x + 11, fy: y - 22, rot: 18 },
                    { fx: x - 1, fy: y - 24, rot: 5 },
                  ].map((m, idx) => (
                    <g key={idx} transform={`translate(${m.fx}, ${m.fy}) rotate(${m.rot})`}>
                      <line x1="0" y1="-2.5" x2="0" y2="0" stroke="#3E1A04" strokeWidth="0.8" />
                      <path
                        d="M 0 0 C -2.2 2, -2.8 4.5, -1 6.8 C 1.2 8.2, 3.2 6.2, 2.2 3.2 C 1.8 1.2, 0.8 0.2, 0 0 Z"
                        fill="#F59E0B"
                        stroke="#D97706"
                        strokeWidth="0.5"
                      />
                      <ellipse cx="-0.5" cy="3.2" rx="0.7" ry="1.6" fill="#FEF08A" opacity="0.85" />
                      <circle cx="0.2" cy="5.8" r="0.9" fill="#EA580C" opacity="0.75" />
                    </g>
                  ))}
                </g>
              )}
            </>
          ) : (
            // 2D Sky View: Dense Rounded Mango Crown
            <>
              <circle cx={x} cy={y} r="13" fill="#064E3B" />
              <circle cx={x - 5} cy={y} r="8.5" fill="#065F46" />
              <circle cx={x + 5} cy={y} r="8.5" fill="#047857" />
              <circle cx={x} cy={y - 2} r="9.5" fill="#059669" />
              <circle cx={x - 2} cy={y - 3} r="6" fill="#10B981" />
              <circle cx={x - 3} cy={y - 4} r="2.5" fill="#34D399" opacity="0.9" />

              {/* 🌟 SECRET EASTER EGG in 2D Sky View */}
              {showMangoFruits && (
                <g>
                  {[
                    { fx: x - 8, fy: y - 4 },
                    { fx: x + 8, fy: y - 3 },
                    { fx: x - 2, fy: y + 7 },
                    { fx: x + 5, fy: y + 5 },
                  ].map((m, idx) => (
                    <circle
                      key={idx}
                      cx={m.fx}
                      cy={m.fy}
                      r="1.8"
                      fill="#F59E0B"
                      stroke="#D97706"
                      strokeWidth="0.6"
                    />
                  ))}
                </g>
              )}
            </>
          )}
        </g>
      )}

      {/* 4. Variety: Tropical Coconut Palm */}
      {type === 'palm' && (
        <g>
          {isIsometric ? (
            <>
              {/* Taller Curved Segmented Palm Trunk */}
              <path
                d={`M ${x} ${y} Q ${x + 4} ${y - 14} ${x} ${y - 27}`}
                stroke="#5C2C16"
                strokeWidth="3.2"
                fill="none"
                strokeLinecap="round"
              />
              <path
                d={`M ${x} ${y} Q ${x + 4} ${y - 14} ${x} ${y - 27}`}
                stroke="#92400E"
                strokeWidth="2.2"
                strokeDasharray="3 2"
                fill="none"
              />

              {/* Cluster of Coconuts */}
              <circle cx={x - 2.5} cy={y - 26} r="2.2" fill="#582E11" />
              <circle cx={x + 2.5} cy={y - 26} r="2.2" fill="#65A30D" />
              <circle cx={x} cy={y - 24} r="2.1" fill="#78350F" />

              {/* 8 Arching Tropical Fronds */}
              <path
                d={`M ${x} ${y - 27} Q ${x - 12} ${y - 33} ${x - 18} ${y - 22}`}
                stroke="#10B981"
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
              />
              <path
                d={`M ${x} ${y - 27} Q ${x - 16} ${y - 27} ${x - 23} ${y - 15}`}
                stroke="#047857"
                strokeWidth="1.8"
                fill="none"
                strokeLinecap="round"
              />
              <path
                d={`M ${x} ${y - 27} Q ${x + 12} ${y - 33} ${x + 18} ${y - 22}`}
                stroke="#059669"
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
              />
              <path
                d={`M ${x} ${y - 27} Q ${x + 16} ${y - 27} ${x + 23} ${y - 15}`}
                stroke="#047857"
                strokeWidth="1.8"
                fill="none"
                strokeLinecap="round"
              />
              <path
                d={`M ${x} ${y - 27} Q ${x - 6} ${y - 39} ${x - 10} ${y - 32}`}
                stroke="#34D399"
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
              />
              <path
                d={`M ${x} ${y - 27} Q ${x + 6} ${y - 39} ${x + 10} ${y - 32}`}
                stroke="#10B981"
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
              />
              <path
                d={`M ${x} ${y - 27} Q ${x - 2} ${y - 42} ${x - 4} ${y - 35}`}
                stroke="#34D399"
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
              />
              <path
                d={`M ${x} ${y - 27} Q ${x + 2} ${y - 42} ${x + 4} ${y - 35}`}
                stroke="#10B981"
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
              />
            </>
          ) : (
            // 2D Sky View Palm
            <>
              <circle cx={x} cy={y} r="6" fill="#582E11" />
              {[-60, -20, 20, 60, 120, 160, 200, 240].map((deg, i) => (
                <line
                  key={i}
                  x1={x}
                  y1={y}
                  x2={x + Math.cos(deg * Math.PI / 180) * 16}
                  y2={y + Math.sin(deg * Math.PI / 180) * 16}
                  stroke={i % 2 === 0 ? "#10B981" : "#059669"}
                  strokeWidth="2.2"
                  strokeLinecap="round"
                />
              ))}
              <circle cx={x - 1.5} cy={y - 1.5} r="2" fill="#65A30D" />
              <circle cx={x + 1.5} cy={y + 1.5} r="2" fill="#78350F" />
            </>
          )}
        </g>
      )}

      {/* Delete badge hover indicator when Admin is in Planting Mode */}
      {isAdmin && isPlantingMode && (
        <circle
          cx={x}
          cy={y - (isIsometric ? 38 : 14)}
          r="5.5"
          className={styles.treeDeleteIndicator}
        />
      )}
    </g>
  );
});

// 🏠 Building Roof Customization Palette
// 'royalCrimson' | 'imperialGold' | 'emerald' | 'terracotta' | 'modernBlue' | 'charcoal'
const ROOF_COLOR_PALETTES = {
  royalCrimson: { id: 'royalCrimson', label: '👑 Royal Crimson', base: '#881337', light: '#9F1239', dark: '#4C0519', pattern: 'roofRibsCrimson' },
  imperialGold: { id: 'imperialGold', label: '⚜️ Imperial Gold', base: '#B45309', light: '#D4AF37', dark: '#78350F', pattern: 'roofRibsGold' },
  emerald: { id: 'emerald', label: '🌲 Emerald Green', base: '#047857', light: '#059669', dark: '#065F46', pattern: 'roofRibsEmerald' },
  terracotta: { id: 'terracotta', label: '🧱 Terracotta Clay', base: '#B45309', light: '#D97706', dark: '#92400E', pattern: 'roofRibsTerracotta' },
  modernBlue: { id: 'modernBlue', label: '🌊 Modern Navy Blue', base: '#1D4ED8', light: '#2563EB', dark: '#1E40AF', pattern: 'roofRibsModernBlue' },
  charcoal: { id: 'charcoal', label: '🔘 Steel Charcoal', base: '#374151', light: '#4B5563', dark: '#1F2937', pattern: 'roofRibsCharcoal' }
};

// 🏛️ Memoized Building & Architectural Feature Element
// Eliminates expensive polygon geometry, window matrix calculation, and SVG reflows during pan & zoom
const BuildingFeatureItem = React.memo(function BuildingFeatureItem({
  feat,
  isSelected,
  isHovered,
  matchesFilter,
  isIsometric,
  extrudeScale,
  isSatellite,
  roofColor,
  onSelect,
  onHover,
  onHoverLeave,
  isPlantingActive
}) {
  const opacity = matchesFilter ? 1 : 0.22;
  const baseH = Math.round(feat.height * extrudeScale);
  const h = isIsometric ? (isHovered ? baseH + 4 : baseH) : 0;

  return (
    <g
      className={styles.buildingGroup}
      style={{ opacity, transition: 'opacity 0.2s ease' }}
      onClick={(e) => {
        if (isPlantingActive) return;
        e.stopPropagation();
        onSelect(feat);
      }}
      onMouseEnter={() => onHover(feat)}
      onMouseLeave={onHoverLeave}
    >
      {/* 2.5D Ground Cast Shadow */}
      {isIsometric && feat.height > 0 && (
        <path
          d={feat.pathD}
          className={styles.buildingShadow}
          transform="translate(4, 7)"
        />
      )}

      {/* 2.5D Extruded Vertical Walls with Directional Sunlight Shading & Glass Windows */}
      {isIsometric && feat.wallFacets?.map((wall, wIdx) => {
        const wallD = `M ${wall.x1.toFixed(1)},${wall.y1.toFixed(1)} L ${wall.x2.toFixed(1)},${wall.y2.toFixed(1)} L ${wall.x2.toFixed(1)},${(wall.y2 - h).toFixed(1)} L ${wall.x1.toFixed(1)},${(wall.y1 - h).toFixed(1)} Z`;

        // Calculate architectural windows along this wall facet
        const normName = (feat.name || '').toUpperCase();
        const isNoWindowBuilding = normName.includes('MSR') || normName.includes('GYM') || normName.includes('KALAMBUAN');
        const dx = wall.x2 - wall.x1;
        const dy = wall.y2 - wall.y1;
        const wallLen = Math.sqrt(dx * dx + dy * dy);
        const windows = [];

        // Only place smaller windows on eligible academic & admin buildings
        if (!isNoWindowBuilding && wallLen >= 18 && h >= 10) {
          const stories = h >= 22 ? 2 : 1;
          const windowSpacing = 13;
          const numWindows = Math.floor((wallLen - 6) / windowSpacing);

          if (numWindows >= 1) {
            const ux = dx / wallLen;
            const uy = dy / wallLen;
            const winWidth = 4.8;
            const margin = (wallLen - numWindows * windowSpacing) / 2;

            for (let s = 0; s < stories; s++) {
              const storyH = h / stories;
              const winBaseY = (s * storyH) + storyH * 0.30;
              const winHeight = storyH * 0.35;

              for (let i = 0; i < numWindows; i++) {
                const pos = margin + i * windowSpacing + (windowSpacing - winWidth) / 2;
                const wx1 = wall.x1 + ux * pos;
                const wy1 = wall.y1 + uy * pos;
                const wx2 = wall.x1 + ux * (pos + winWidth);
                const wy2 = wall.y1 + uy * (pos + winWidth);

                const winD = `M ${wx1.toFixed(1)},${(wy1 - winBaseY).toFixed(1)} L ${wx2.toFixed(1)},${(wy2 - winBaseY).toFixed(1)} L ${wx2.toFixed(1)},${(wy2 - winBaseY - winHeight).toFixed(1)} L ${wx1.toFixed(1)},${(wy1 - winBaseY - winHeight).toFixed(1)} Z`;
                windows.push({ id: `win-${s}-${i}`, d: winD });
              }
            }
          }
        }

        return (
          <g key={`wall-group-${wIdx}`}>
            {/* Wall Surface */}
            <path
              d={wallD}
              className={styles.buildingWall}
              style={{
                fill: feat.category.color,
                filter: `brightness(${wall.brightness})`,
                stroke: feat.category.color,
                strokeWidth: 0.5
              }}
            />

            {/* Architectural Glass Windows with Reflective Blue Glazing */}
            {windows.map((win) => (
              <path
                key={win.id}
                d={win.d}
                className={styles.wallWindow}
                style={{
                  fill: 'rgba(219, 234, 254, 0.75)',
                  stroke: 'rgba(30, 58, 138, 0.85)',
                  strokeWidth: 0.65
                }}
              />
            ))}
          </g>
        );
      })}

      {/* 🏠 3D Pitched / Gabled Roof Surface or Flat Ground Plaza */}
      {feat.height > 0 && feat.roofData ? (
        <g className={styles.roofStructureGroup}>
          {/* Base Roof Footprint with Selected Roof Material Pattern */}
          <path
            d={feat.pathD}
            transform={`translate(0, -${h})`}
            className={`${styles.buildingPath} ${isSelected ? styles.buildingSelected : ''} ${isHovered ? styles.buildingHovered : ''}`}
            style={{
              fill: isSelected
                ? 'rgba(217, 79, 31, 0.88)'
                : feat.roofData.isMsr
                  ? 'url(#roofPlainSteel)'
                  : `url(#${ROOF_COLOR_PALETTES[roofColor]?.pattern || 'roofRibsEmerald'})`,
              stroke: isSelected
                ? '#FF8A50'
                : isHovered
                  ? '#FFFFFF'
                  : feat.roofData.isMsr
                    ? '#9CA3AF'
                    : (ROOF_COLOR_PALETTES[roofColor]?.dark || '#065F46'),
              strokeWidth: isSelected ? 3.5 : isHovered ? 2.5 : 1.5,
              filter: isSelected ? 'url(#glowAccent)' : 'none',
              transition: 'transform 0.2s ease, fill 0.2s ease'
            }}
          />

          {/* 3D Hip Ridge Line and Slope Creases in Isometric Mode */}
          {isIsometric && (
            <g className={styles.roofRidgeGroup} opacity={0.92}>
              {/* Central Ridge Beam */}
              <line
                x1={feat.roofData.r1[0]}
                y1={feat.roofData.r1[1] - h - feat.roofData.ridgeRise}
                x2={feat.roofData.r2[0]}
                y2={feat.roofData.r2[1] - h - feat.roofData.ridgeRise}
                stroke="#FFFFFF"
                strokeWidth={2.4}
                strokeLinecap="round"
                filter="drop-shadow(0 2px 3px rgba(0,0,0,0.45))"
              />

              {/* Hip Crease Rafter Lines Connecting Ridge Ends to Building Corners */}
              <line
                x1={feat.roofData.r1[0]}
                y1={feat.roofData.r1[1] - h - feat.roofData.ridgeRise}
                x2={feat.roofData.minX}
                y2={feat.roofData.minY - h}
                stroke="rgba(255, 255, 255, 0.45)"
                strokeWidth={1.2}
                strokeDasharray="none"
              />
              <line
                x1={feat.roofData.r1[0]}
                y1={feat.roofData.r1[1] - h - feat.roofData.ridgeRise}
                x2={feat.roofData.minX}
                y2={feat.roofData.maxY - h}
                stroke="rgba(0, 0, 0, 0.35)"
                strokeWidth={1.2}
                strokeDasharray="none"
              />
              <line
                x1={feat.roofData.r2[0]}
                y1={feat.roofData.r2[1] - h - feat.roofData.ridgeRise}
                x2={feat.roofData.maxX}
                y2={feat.roofData.minY - h}
                stroke="rgba(255, 255, 255, 0.45)"
                strokeWidth={1.2}
                strokeDasharray="none"
              />
              <line
                x1={feat.roofData.r2[0]}
                y1={feat.roofData.r2[1] - h - feat.roofData.ridgeRise}
                x2={feat.roofData.maxX}
                y2={feat.roofData.maxY - h}
                stroke="rgba(0, 0, 0, 0.35)"
                strokeWidth={1.2}
                strokeDasharray="none"
              />

              {/* Shaded Southern/Eastern Roof Hip Slope (Ambient Occlusion) */}
              {feat.roofData.isHoriz ? (
                <polygon
                  points={`${feat.roofData.r1[0]},${feat.roofData.r1[1] - h - feat.roofData.ridgeRise} ${feat.roofData.r2[0]},${feat.roofData.r2[1] - h - feat.roofData.ridgeRise} ${feat.roofData.maxX},${feat.roofData.maxY - h} ${feat.roofData.minX},${feat.roofData.maxY - h}`}
                  fill="rgba(0, 0, 0, 0.16)"
                  pointerEvents="none"
                />
              ) : (
                <polygon
                  points={`${feat.roofData.r1[0]},${feat.roofData.r1[1] - h - feat.roofData.ridgeRise} ${feat.roofData.r2[0]},${feat.roofData.r2[1] - h - feat.roofData.ridgeRise} ${feat.roofData.maxX},${feat.roofData.maxY - h} ${feat.roofData.maxX},${feat.roofData.minY - h}`}
                  fill="rgba(0, 0, 0, 0.16)"
                  pointerEvents="none"
                />
              )}
            </g>
          )}
        </g>
      ) : (
        /* Flat Ground Plaza / Sand Court */
        <path
          d={feat.pathD}
          className={`${styles.buildingPath} ${isSelected ? styles.buildingSelected : ''} ${isHovered ? styles.buildingHovered : ''} ${feat.isGroundPlaza ? styles.groundPlazaPath : ''}`}
          style={{
            fill: isSelected
              ? 'rgba(217, 79, 31, 0.85)'
              : feat.isBeachVolley
                ? 'url(#beachSandPattern)'
                : feat.isGroundPlaza
                  ? 'url(#plazaPavingPattern)'
                  : isIsometric
                    ? feat.category.color + (isSatellite ? 'CC' : 'E6')
                    : feat.category.color + (isSatellite ? '59' : '26'),
            stroke: isSelected ? '#FF8A50' : isHovered ? '#FFFFFF' : feat.category.color,
            strokeWidth: isSelected ? 3.5 : isHovered ? 2.8 : feat.isGroundPlaza ? 2 : 1.8,
            strokeDasharray: feat.isGroundPlaza ? '5 3' : 'none',
            filter: isSelected ? 'url(#glowAccent)' : 'none',
            transition: 'transform 0.2s ease, fill 0.2s ease'
          }}
        />
      )}

      {/* Building Centroid Label (Floating above 3D Roof or on Ground Plaza) */}
      <text
        x={feat.centroid[0]}
        y={h > 0 ? feat.centroid[1] - h - 6 : feat.centroid[1]}
        className={`${styles.buildingLabel} ${feat.isGroundPlaza ? styles.groundPlazaLabel : ''}`}
        textAnchor="middle"
        dominantBaseline="middle"
      >
        {feat.isBeachVolley
          ? `🏐 ${feat.name} (SAND)`
          : feat.isGroundPlaza
            ? `🍽️ ${feat.name} (PLAZA)`
            : feat.name}
      </text>
    </g>
  );
});

function CampusMap() {
  // Admin permissions check (Strictly Admin Only for Tree Planting)
  const { isAdmin, userRole } = usePermissions();
  const isStrictAdmin = isAdmin || userRole === 'admin';

  // Map pan, zoom, and 2.5D isometric perspective state
  const [zoom, setZoom] = useState(1.55);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [isZooming, setIsZooming] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [isMaximized, setIsMaximized] = useState(false);
  const zoomingTimerRef = useRef(null);

  // Trigger high-performance instant zoom mode during fast wheel or pinch gestures
  const triggerInstantZoomMode = useCallback(() => {
    setIsZooming(true);
    if (zoomingTimerRef.current) {
      clearTimeout(zoomingTimerRef.current);
    }
    zoomingTimerRef.current = setTimeout(() => {
      setIsZooming(false);
    }, 120);
  }, []);

  // Dedicated View Mode: '2d' (Top-Down Sky View) vs '2.5d' (Tactical Isometric 3D)
  const [viewMode, setViewMode] = useState('2.5d');
  const isIsometric = viewMode === '2.5d';
  const [isoAngle, setIsoAngle] = useState(52); // Tilt angle: 40° High, 52° Tactical, 64° Low
  const [extrudeScale, setExtrudeScale] = useState(1.0); // Height multiplier: 1.0x, 1.4x

  // Basemap & Satellite Imagery Overlay state
  const [basemapMode, setBasemapMode] = useState('satellite'); // 'blueprint' | 'satellite'
  const isSatellite = basemapMode === 'satellite';
  const [satelliteOpacity, setSatelliteOpacity] = useState(0.88);
  const [clipToBoundary, setClipToBoundary] = useState(false);

  // Isometric Trees State (Cloud synced & Local fallback)
  const [trees, setTrees] = useState(DEFAULT_CAMPUS_TREES);
  const [isPlantingTree, setIsPlantingTree] = useState(false);
  const [selectedTreeType, setSelectedTreeType] = useState('mango'); // 'mango' | 'acacia' | 'palm'
  const svgRef = useRef(null);

  // 🏠 Building Roof Customization State (Using shared ROOF_COLOR_PALETTES)
  const [roofColor, setRoofColor] = useState(() => {
    try {
      return localStorage.getItem('ctu_campus_roof_color') || 'royalCrimson';
    } catch {
      return 'royalCrimson';
    }
  });

  const handleSetRoofColor = (colorKey) => {
    setRoofColor(colorKey);
    try {
      localStorage.setItem('ctu_campus_roof_color', colorKey);
    } catch {
      // Ignored: storage quota or private browsing
    }
  };

  // Secret Easter Egg: In March (month 2) and May (month 4), ripe golden mangoes appear!
  const currentCalendarMonth = new Date().getMonth(); // 0-indexed: Mar=2, Apr=3, May=4
  const isCalendarMangoSeason = currentCalendarMonth === 2 || currentCalendarMonth === 3 || currentCalendarMonth === 4;
  const [forceMangoFruits, setForceMangoFruits] = useState(true); // Enabled by default for preview
  const showMangoFruits = isCalendarMangoSeason || forceMangoFruits;

  // Strictly enforce admin only: if user is not admin, turn off planting mode
  useEffect(() => {
    if (!isStrictAdmin && isPlantingTree) {
      setIsPlantingTree(false);
    }
  }, [isStrictAdmin, isPlantingTree]);

  // Synchronize campus trees from Firestore & localStorage
  useEffect(() => {
    let isMounted = true;
    try {
      const cached = localStorage.getItem('ctu_campus_trees');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setTrees(parsed);
        }
      }
    } catch (e) {
      console.warn('Could not read cached trees:', e);
    }

    try {
      const unsub = onSnapshot(doc(db, 'campusMetadata', 'trees'), (docSnap) => {
        if (!isMounted) return;
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (Array.isArray(data.list)) {
            setTrees(data.list);
            try {
              localStorage.setItem('ctu_campus_trees', JSON.stringify(data.list));
            } catch {
              // Local storage fallback ignored
            }
          }
        }
      }, (err) => {
        console.warn('Real-time trees sync fallback:', err);
      });
      return () => {
        isMounted = false;
        unsub();
      };
    } catch (err) {
      console.warn('Could not connect to campusMetadata/trees:', err);
    }
  }, []);

  // Save trees mutation (Strictly guarded by admin check)
  const saveTreesToCloudAndLocal = useCallback((newList) => {
    if (!isStrictAdmin) return;
    setTrees(newList);
    try {
      localStorage.setItem('ctu_campus_trees', JSON.stringify(newList));
    } catch {
      // Local storage fallback ignored
    }
    try {
      setDoc(doc(db, 'campusMetadata', 'trees'), {
        list: newList,
        updatedAt: new Date().toISOString(),
        updatedBy: userRole || 'admin'
      }, { merge: true });
    } catch (err) {
      console.warn('Error saving trees to Firestore:', err);
    }
  }, [isStrictAdmin, userRole]);

  const handleAddTree = useCallback((newTree) => {
    if (!isStrictAdmin) return;
    saveTreesToCloudAndLocal([...trees, newTree]);
  }, [isStrictAdmin, trees, saveTreesToCloudAndLocal]);

  const handleRemoveTree = useCallback((treeId) => {
    if (!isStrictAdmin) return;
    saveTreesToCloudAndLocal(trees.filter(t => t.id !== treeId));
  }, [isStrictAdmin, trees, saveTreesToCloudAndLocal]);

  const handleUndoTree = useCallback(() => {
    if (!isStrictAdmin || trees.length === 0) return;
    saveTreesToCloudAndLocal(trees.slice(0, -1));
  }, [isStrictAdmin, trees, saveTreesToCloudAndLocal]);

  const handleClearAllTrees = useCallback(() => {
    if (!isStrictAdmin) return;
    if (window.confirm('Are you sure you want to clear all planted trees?')) {
      saveTreesToCloudAndLocal([]);
    }
  }, [isStrictAdmin, saveTreesToCloudAndLocal]);

  // UI state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [selectedFeature, setSelectedFeature] = useState(null);
  const [hoveredFeature, setHoveredFeature] = useState(null);
  const [copiedLocation, setCopiedLocation] = useState(false);
  const [activeAnnouncements, setActiveAnnouncements] = useState([]);

  const containerRef = useRef(null);
  const mapPageRef = useRef(null);
  const mapGroupRef = useRef(null);

  // Calculate responsive default zoom so the entire campus fits automatically on mobile vs desktop
  const getResponsiveDefaultZoom = useCallback(() => {
    if (typeof window === 'undefined') return 2.15;
    const w = window.innerWidth;
    if (w < 480) return 1.45; // Mobile phones: fills full boundary width comfortably
    if (w < 768) return 1.70; // Phablets/tablets
    if (w < 1200) return 1.95; // Compact laptops
    return 2.15; // High-res desktop screens: fills container expansively
  }, []);

  // Set responsive initial zoom and update on viewport resize
  useEffect(() => {
    const handleResize = () => {
      // If user hasn't heavily zoomed in, gracefully adapt the scale
      setZoom((prevZoom) => {
        const base = getResponsiveDefaultZoom();
        return prevZoom < 2.2 ? base : prevZoom;
      });
    };
    // Initial responsive calibration
    setZoom(getResponsiveDefaultZoom());
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [getResponsiveDefaultZoom]);

  // Pin page to top on mount to ensure clean alignment
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, []);

  // Escape key exits maximized view
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isMaximized) {
        setIsMaximized(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMaximized]);

  // Fetch campus announcements to correlate with venues (with defensive error boundary)
  useEffect(() => {
    let isMounted = true;
    try {
      const unsub = onSnapshot(
        collection(db, 'announcements'),
        (snapshot) => {
          if (!isMounted) return;
          const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          setActiveAnnouncements(list);
        },
        (err) => {
          console.warn('Could not subscribe to announcements for map:', err);
        }
      );
      return () => {
        isMounted = false;
        unsub();
      };
    } catch (err) {
      console.warn('Could not initialize announcements subscription:', err);
    }
  }, []);

  // Coordinate projection from GPS Longitude/Latitude to SVG (x, y)
  const projectCoords = useCallback((lng, lat) => {
    const x = PADDING + ((lng - BOUNDS.minLng) / (BOUNDS.maxLng - BOUNDS.minLng)) * (SVG_WIDTH - 2 * PADDING);
    // Invert latitude because SVG Y grows downwards while Latitude grows Northwards
    const y = PADDING + ((BOUNDS.maxLat - lat) / (BOUNDS.maxLat - BOUNDS.minLat)) * (SVG_HEIGHT - 2 * PADDING);
    return [x, y];
  }, []);

  // Projected Satellite Tiles (maps EPSG:3857 tile bounds to campus SVG coordinate system)
  const satelliteTiles = useMemo(() => {
    return SATELLITE_TILES_META.map((t) => {
      const nwLng = tile2lon(t.x, SATELLITE_Z);
      const nwLat = tile2lat(t.y, SATELLITE_Z);
      const seLng = tile2lon(t.x + 1, SATELLITE_Z);
      const seLat = tile2lat(t.y + 1, SATELLITE_Z);

      const [x1, y1] = projectCoords(nwLng, nwLat);
      const [x2, y2] = projectCoords(seLng, seLat);

      return {
        id: `tile-${SATELLITE_Z}-${t.x}-${t.y}`,
        x: x1,
        y: y1,
        width: x2 - x1,
        height: y2 - y1,
        src: `/satellite/tile-${SATELLITE_Z}-${t.x}-${t.y}.jpg`,
        fallbackSrc: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${SATELLITE_Z}/${t.y}/${t.x}`
      };
    });
  }, [projectCoords]);

  // Process all GeoJSON features into projected SVG paths & polygons
  const processedFeatures = useMemo(() => {
    if (!ctuMapData || !ctuMapData.features) return [];

    return ctuMapData.features.map((feature, idx) => {
      const name = feature.properties?.name || `Area ${idx + 1}`;
      const category = getFeatureCategory(name);
      const isBoundary = name === 'CTU Shape';
      const isOval = name === 'CTU OVAL';
      const isBeachVolley = (name || '').toUpperCase().includes('BEACH') || (name || '').toUpperCase().includes('VOLLEY');
      const isGroundPlaza = isBeachVolley || (name || '').toUpperCase().includes('FOOD COURT') || (name || '').toUpperCase().includes('QUADRANGLE');
      const height = isGroundPlaza ? 0 : getFeatureHeight(name);

      let pathD = '';
      let centroid = [0, 0];
      let pointCoord = null;
      let wallFacets = [];
      let roofData = null;
      let projectedPtsList = [];

      if (feature.geometry.type === 'Polygon') {
        const rings = feature.geometry.coordinates;
        if (rings && rings.length > 0) {
          const outerRing = rings[0];
          let sumX = 0;
          let sumY = 0;

          const projectedPts = outerRing.map((pt) => {
            const [x, y] = projectCoords(pt[0], pt[1]);
            sumX += x;
            sumY += y;
            return [x, y];
          });

          pathD = `M ${projectedPts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' L ')} Z`;
          centroid = [sumX / outerRing.length, sumY / outerRing.length];

          // Generate 3D extruded vertical wall facets with directional lighting
          if (height > 0) {
            for (let i = 0; i < projectedPts.length - 1; i++) {
              const [x1, y1] = projectedPts[i];
              const [x2, y2] = projectedPts[i + 1];

              const dx = x2 - x1;
              const dy = y2 - y1;
              // Directional sunlight angle from North-West
              const angle = Math.atan2(dy, dx);
              const brightness = Math.min(1.0, Math.max(0.35, Math.sin(angle - 0.78) * 0.35 + 0.65));

              wallFacets.push({
                x1,
                y1,
                x2,
                y2,
                brightness
              });
            }
          }

          // Generate Pitched / Gabled 3D Roof Geometry with Ridge Line
          if (height > 0) {
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            projectedPts.forEach(([x, y]) => {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            });
            const w = maxX - minX;
            const l = maxY - minY;
            const isHoriz = w >= l;
            const span = isHoriz ? l : w;
            const ridgeRise = Math.min(18, Math.max(7, span * 0.28));
            const isMsr = (name || '').toUpperCase().includes('MSR');

            // Ridge endpoints
            const inset = Math.min(span * 0.35, (isHoriz ? w : l) * 0.15);
            let r1, r2;
            if (isHoriz) {
              r1 = [minX + inset, centroid[1]];
              r2 = [maxX - inset, centroid[1]];
            } else {
              r1 = [centroid[0], minY + inset];
              r2 = [centroid[0], maxY - inset];
            }

            roofData = {
              isMsr,
              isHoriz,
              ridgeRise,
              r1,
              r2,
              minX,
              maxX,
              minY,
              maxY,
              width: w,
              length: l
            };
            projectedPtsList = projectedPts;
          }
        }
      } else if (feature.geometry.type === 'Point') {
        const [x, y] = projectCoords(feature.geometry.coordinates[0], feature.geometry.coordinates[1]);
        centroid = [x, y];
        pointCoord = [x, y];
      } else if (feature.geometry.type === 'LineString') {
        const pts = feature.geometry.coordinates.map((pt) => {
          const [x, y] = projectCoords(pt[0], pt[1]);
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        });
        pathD = `M ${pts.join(' L ')}`;
        centroid = [SVG_WIDTH / 2, SVG_HEIGHT / 2];
      }

      return {
        id: `feat-${idx}`,
        name,
        category,
        isBoundary,
        isOval,
        isGroundPlaza,
        height,
        wallFacets,
        roofData,
        projectedPts: projectedPtsList,
        pathD,
        centroid,
        pointCoord,
        raw: feature
      };
    });
  }, [projectCoords]);

  // Separate boundary, oval, buildings, and point markers
  const boundaryFeature = useMemo(() => processedFeatures.find(f => f.isBoundary), [processedFeatures]);
  const ovalFeature = useMemo(() => processedFeatures.find(f => f.isOval), [processedFeatures]);
  
  // Sort building features by topological isometric depth (Painter's Algorithm):
  // Smaller Y (North / Background) renders first, larger Y (South / Foreground) renders on top!
  // This guarantees Education Building 2 & 3 (North) will never overlap or occlude Education Building 1 (South/Foreground).
  const buildingFeatures = useMemo(() => {
    return processedFeatures
      .filter(f => !f.isBoundary && !f.isOval && !f.pointCoord)
      .slice()
      .sort((a, b) => {
        // Ground plazas always render at the very base
        if (a.isGroundPlaza && !b.isGroundPlaza) return -1;
        if (!a.isGroundPlaza && b.isGroundPlaza) return 1;
        // Depth key calculated from Y (dominant) + slight X offset for 22° isometric tilt
        const depthA = a.centroid[1] + a.centroid[0] * 0.15;
        const depthB = b.centroid[1] + b.centroid[0] * 0.15;
        return depthA - depthB;
      });
  }, [processedFeatures]);

  // Exclude duplicate point pins that already have an exact polygon representation (e.g. FOOD COURT, QUADRANGLE)
  const pointFeatures = useMemo(() => {
    return processedFeatures.filter(f => {
      if (!f.pointCoord) return false;
      const norm = (f.name || '').toUpperCase().trim();
      const hasPolygon = buildingFeatures.some(b => {
        const bNorm = (b.name || '').toUpperCase().trim();
        return bNorm === norm || bNorm.includes(norm) || norm.includes(bNorm);
      });
      return !hasPolygon;
    });
  }, [processedFeatures, buildingFeatures]);

  // Search filtered items
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return processedFeatures.filter(f =>
      !f.isBoundary && f.name.toLowerCase().includes(q)
    ).slice(0, 8);
  }, [searchQuery, processedFeatures]);

  // Center constants
  const CX = SVG_WIDTH / 2; // 550
  const CY = SVG_HEIGHT / 2; // 925
  const MIN_ZOOM = 0.8;
  const MAX_ZOOM = 5.0;
  const DEFAULT_ZOOM = 2.15;

  // Strict Pan Clamping to prevent outbound drift
  const clampPan = useCallback((targetPan, currentZoom) => {
    // Only allow panning if zoomed in; otherwise lock to center
    const maxPanX = Math.max(0, (SVG_WIDTH * (currentZoom - 0.78)) / 2);
    const maxPanY = Math.max(0, (SVG_HEIGHT * (currentZoom - 0.78)) / 2);

    return {
      x: Math.max(-maxPanX, Math.min(maxPanX, targetPan.x)),
      y: Math.max(-maxPanY, Math.min(maxPanY, targetPan.y))
    };
  }, []);

  // Center-Pivoted Zoom Controls (Tuned for faster, snappier response)
  const handleZoom = (direction) => {
    setZoom((prevZoom) => {
      const nextZoom = direction === 'in'
        ? Math.min(prevZoom * 1.35, MAX_ZOOM)
        : Math.max(prevZoom / 1.35, MIN_ZOOM);
      setPan((currPan) => clampPan(currPan, nextZoom));
      return nextZoom;
    });
  };

  const handleSliderZoom = (newZoomVal) => {
    triggerInstantZoomMode();
    const nextZoom = Math.min(Math.max(parseFloat(newZoomVal), MIN_ZOOM), MAX_ZOOM);
    setZoom(nextZoom);
    setPan((currPan) => clampPan(currPan, nextZoom));
  };

  const handleReset = () => {
    setZoom(getResponsiveDefaultZoom());
    setPan({ x: 0, y: 0 });
    setSelectedFeature(null);
  };

  // Center camera onto a specific feature (used explicitly for search or center action)
  const centerOnFeature = (feature) => {
    if (!feature || !feature.centroid) return;
    const [fx, fy] = feature.centroid;
    const currentZoom = zoom || DEFAULT_ZOOM;
    const targetPan = {
      x: (CX - fx) * currentZoom,
      y: (CY - fy) * currentZoom
    };
    setPan(clampPan(targetPan, currentZoom));
  };

  // Select building / feature WITHOUT snapping or shifting camera pan
  const focusFeature = (feature) => {
    if (!feature) return;
    setSelectedFeature(feature);
    setSearchQuery('');
  };

  // Drag & Pan mouse handlers with outbound boundary clamping and rAF batching
  const [dragStartClient, setDragStartClient] = useState({ x: 0, y: 0 });
  const panRafRef = useRef(null);
  const wheelZoomRafRef = useRef(null);
  const momentumRafRef = useRef(null);
  const velocityRef = useRef({ vx: 0, vy: 0, lastX: 0, lastY: 0, lastTime: 0 });
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);

  // Keep refs in sync with current state
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    panRef.current = pan;
  }, [pan]);

  const handleBuildingLeave = useCallback(() => {
    setHoveredFeature(null);
  }, []);

  // Cancel any active momentum or animation frames
  const stopKineticMotion = useCallback(() => {
    if (momentumRafRef.current) {
      cancelAnimationFrame(momentumRafRef.current);
      momentumRafRef.current = null;
    }
    if (panRafRef.current) {
      cancelAnimationFrame(panRafRef.current);
      panRafRef.current = null;
    }
  }, []);

  const handleMouseDown = (e) => {
    if (e.button !== 0) return; // Left click only
    stopKineticMotion();
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    setDragStartClient({ x: e.clientX, y: e.clientY });
    velocityRef.current = {
      vx: 0,
      vy: 0,
      lastX: e.clientX,
      lastY: e.clientY,
      lastTime: performance.now()
    };
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    const now = performance.now();
    const dt = Math.max(1, now - velocityRef.current.lastTime);
    const dx = e.clientX - velocityRef.current.lastX;
    const dy = e.clientY - velocityRef.current.lastY;

    // Track smoothed flick velocity
    velocityRef.current.vx = dx / dt;
    velocityRef.current.vy = dy / dt;
    velocityRef.current.lastX = e.clientX;
    velocityRef.current.lastY = e.clientY;
    velocityRef.current.lastTime = now;

    const rawX = e.clientX - dragStart.x;
    const rawY = e.clientY - dragStart.y;

    // Throttle to display refresh tick (60Hz / 120Hz) via rAF
    if (!panRafRef.current) {
      panRafRef.current = requestAnimationFrame(() => {
        const nextClamped = clampPan({ x: rawX, y: rawY }, zoomRef.current);
        panRef.current = nextClamped;
        if (mapGroupRef.current) {
          mapGroupRef.current.setAttribute(
            'transform',
            `translate(${CX + nextClamped.x}, ${CY + nextClamped.y}) scale(${zoomRef.current}) translate(${-CX}, ${-CY})`
          );
        }
        setPan(nextClamped);
        panRafRef.current = null;
      });
    }
  };

  const handleMouseUp = () => {
    if (!isDragging) return;
    setIsDragging(false);
    if (panRafRef.current) {
      cancelAnimationFrame(panRafRef.current);
      panRafRef.current = null;
    }

    // Apply gentle kinetic momentum if released with velocity
    const { vx, vy } = velocityRef.current;
    const speed = Math.hypot(vx, vy);
    if (speed > 0.15) {
      let curVx = vx * 14;
      let curVy = vy * 14;

      const stepMomentum = () => {
        curVx *= 0.90; // Gentle friction decay
        curVy *= 0.90;

        if (Math.hypot(curVx, curVy) < 0.3) {
          momentumRafRef.current = null;
          return;
        }

        setPan((prevPan) => {
          const nextPan = {
            x: prevPan.x + curVx,
            y: prevPan.y + curVy
          };
          return clampPan(nextPan, zoom);
        });

        momentumRafRef.current = requestAnimationFrame(stepMomentum);
      };
      momentumRafRef.current = requestAnimationFrame(stepMomentum);
    }
  };

  // Admin click handler for planting isometric trees
  const handleMapClick = (e) => {
    if (!isStrictAdmin || !isPlantingTree) return;

    // Check if the user was dragging the map rather than clicking
    const dist = Math.hypot(e.clientX - dragStartClient.x, e.clientY - dragStartClient.y);
    if (dist > 6) return;

    const svgEl = svgRef.current;
    if (!svgEl) return;

    try {
      const pt = svgEl.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const svgP = pt.matrixTransform(svgEl.getScreenCTM().inverse());

      // Invert pan and zoom
      const mapX = CX + (svgP.x - (CX + pan.x)) / zoom;
      const mapY = CY + (svgP.y - (CY + pan.y)) / zoom;

      if (mapX < 30 || mapX > SVG_WIDTH - 30 || mapY < 30 || mapY > SVG_HEIGHT - 30) return;

      const newTree = {
        id: `tree-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        x: Math.round(mapX * 10) / 10,
        y: Math.round(mapY * 10) / 10,
        type: selectedTreeType,
        scale: Math.round((0.92 + Math.random() * 0.2) * 100) / 100,
        createdAt: Date.now()
      };

      handleAddTree(newTree);
    } catch (err) {
      console.warn('Could not plant tree at coordinate:', err);
    }
  };

  // Touch handlers for mobile and trackpad gestures with Pinch-to-Zoom support
  const touchStateRef = useRef({ initialDist: 0, initialZoom: 1 });

  const handleTouchStart = (e) => {
    if (!e.touches) return;
    stopKineticMotion();
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      setIsDragging(true);
      setDragStart({ x: touch.clientX - pan.x, y: touch.clientY - pan.y });
      velocityRef.current = {
        vx: 0,
        vy: 0,
        lastX: touch.clientX,
        lastY: touch.clientY,
        lastTime: performance.now()
      };
    } else if (e.touches.length === 2) {
      // 2-finger pinch gesture start
      setIsDragging(false);
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      touchStateRef.current = {
        initialDist: dist,
        initialZoom: zoom
      };
    }
  };

  const handleTouchMove = (e) => {
    if (!e.touches) return;
    if (e.touches.length === 1 && isDragging) {
      const touch = e.touches[0];
      const now = performance.now();
      const dt = Math.max(1, now - velocityRef.current.lastTime);
      const dx = touch.clientX - velocityRef.current.lastX;
      const dy = touch.clientY - velocityRef.current.lastY;

      velocityRef.current.vx = dx / dt;
      velocityRef.current.vy = dy / dt;
      velocityRef.current.lastX = touch.clientX;
      velocityRef.current.lastY = touch.clientY;
      velocityRef.current.lastTime = now;

      const rawX = touch.clientX - dragStart.x;
      const rawY = touch.clientY - dragStart.y;

      // Throttle single touch pan via rAF
      if (!panRafRef.current) {
        panRafRef.current = requestAnimationFrame(() => {
          setPan(clampPan({ x: rawX, y: rawY }, zoom));
          panRafRef.current = null;
        });
      }
    } else if (e.touches.length === 2) {
      // Pinch to zoom in / out (Batched for instant response)
      triggerInstantZoomMode();
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      if (touchStateRef.current.initialDist > 0) {
        const factor = dist / touchStateRef.current.initialDist;
        const newZoom = Math.min(
          Math.max(touchStateRef.current.initialZoom * factor, MIN_ZOOM),
          MAX_ZOOM
        );
        if (!panRafRef.current) {
          panRafRef.current = requestAnimationFrame(() => {
            setZoom(newZoom);
            setPan((currPan) => clampPan(currPan, newZoom));
            panRafRef.current = null;
          });
        }
      }
    }
  };



  const handleTouchEnd = (e) => {
    if (!e.touches || e.touches.length === 0) {
      setIsDragging(false);
      touchStateRef.current.initialDist = 0;
      if (panRafRef.current) {
        cancelAnimationFrame(panRafRef.current);
        panRafRef.current = null;
      }

      // Apply touch momentum
      const { vx, vy } = velocityRef.current;
      const speed = Math.hypot(vx, vy);
      if (speed > 0.18) {
        let curVx = vx * 12;
        let curVy = vy * 12;

        const stepTouchMomentum = () => {
          curVx *= 0.88;
          curVy *= 0.88;

          if (Math.hypot(curVx, curVy) < 0.4) {
            momentumRafRef.current = null;
            return;
          }

          setPan((prevPan) => {
            const nextPan = {
              x: prevPan.x + curVx,
              y: prevPan.y + curVy
            };
            return clampPan(nextPan, zoom);
          });

          momentumRafRef.current = requestAnimationFrame(stepTouchMomentum);
        };
        momentumRafRef.current = requestAnimationFrame(stepTouchMomentum);
      }
    } else if (e.touches.length === 1) {
      // Transitioned from pinch to 1 finger
      const touch = e.touches[0];
      setIsDragging(true);
      setDragStart({ x: touch.clientX - pan.x, y: touch.clientY - pan.y });
      touchStateRef.current.initialDist = 0;
      velocityRef.current = {
        vx: 0,
        vy: 0,
        lastX: touch.clientX,
        lastY: touch.clientY,
        lastTime: performance.now()
      };
    }
  };

  // Prevent browser window from scrolling down when zooming on map via non-passive capture listeners
  useEffect(() => {
    const el = containerRef.current;
    const onWheelZoom = (e) => {
      // Allow internal scrolling inside announcements drawer or search dropdown
      if (e.target && e.target.closest) {
        if (e.target.closest(`.${styles.announcementsList}`) || e.target.closest(`.${styles.searchResultsDropdown}`)) {
          return;
        }
      }

      // Strictly stop browser page from scrolling down or up
      e.preventDefault();
      e.stopPropagation();

      triggerInstantZoomMode();
      const rect = el ? el.getBoundingClientRect() : null;
      const mouseClientX = e.clientX ?? (rect ? rect.left + rect.width / 2 : window.innerWidth / 2);
      const mouseClientY = e.clientY ?? (rect ? rect.top + rect.height / 2 : window.innerHeight / 2);

      // Ultra-smooth continuous exponential scaling calibrated for natural, responsive wheel zoom
      // Clamps delta so huge notches scale smoothly without jumping
      const normalizedDelta = Math.max(-100, Math.min(100, e.deltaY));
      const factor = Math.exp(-normalizedDelta * 0.0012);

      const prevZoom = zoomRef.current;
      const nextZoom = Math.min(Math.max(prevZoom * factor, MIN_ZOOM), MAX_ZOOM);

      if (rect && Math.abs(nextZoom - prevZoom) > 0.0001) {
        const cursorOffsetX = mouseClientX - (rect.left + rect.width / 2);
        const cursorOffsetY = mouseClientY - (rect.top + rect.height / 2);
        const ratio = nextZoom / prevZoom;

        const currPan = panRef.current;
        const scaledPan = {
          x: cursorOffsetX - (cursorOffsetX - currPan.x) * ratio,
          y: cursorOffsetY - (cursorOffsetY - currPan.y) * ratio
        };
        const clamped = clampPan(scaledPan, nextZoom);

        zoomRef.current = nextZoom;
        panRef.current = clamped;

        // Directly apply transform to SVG DOM node for instant 60/120fps hardware response
        if (mapGroupRef.current) {
          mapGroupRef.current.setAttribute(
            'transform',
            `translate(${CX + clamped.x}, ${CY + clamped.y}) scale(${nextZoom}) translate(${-CX}, ${-CY})`
          );
        }

        // Schedule React state sync on display refresh tick via rAF
        if (!wheelZoomRafRef.current) {
          wheelZoomRafRef.current = requestAnimationFrame(() => {
            setZoom(zoomRef.current);
            setPan(panRef.current);
            wheelZoomRafRef.current = null;
          });
        }
      }
    };

    if (el) {
      el.addEventListener('wheel', onWheelZoom, { passive: false });
    }

    return () => {
      if (el) {
        el.removeEventListener('wheel', onWheelZoom);
      }
      if (wheelZoomRafRef.current) {
        cancelAnimationFrame(wheelZoomRafRef.current);
      }
      if (panRafRef.current) {
        cancelAnimationFrame(panRafRef.current);
      }
      if (momentumRafRef.current) {
        cancelAnimationFrame(momentumRafRef.current);
      }
    };
  }, [CX, CY, clampPan, triggerInstantZoomMode]);

  // Copy building name
  const handleCopyName = (name) => {
    navigator.clipboard.writeText(name);
    setCopiedLocation(true);
    setTimeout(() => setCopiedLocation(false), 2000);
  };

  // Linked announcements for the selected building
  const venueAnnouncements = useMemo(() => {
    if (!selectedFeature) return [];
    const name = selectedFeature.name.toLowerCase();
    return activeAnnouncements.filter((a) => {
      const v = (a.venue || '').toLowerCase();
      const t = (a.title || '').toLowerCase();
      const d = (a.description || '').toLowerCase();
      return v.includes(name) || t.includes(name) || d.includes(name);
    });
  }, [selectedFeature, activeAnnouncements]);

  const { theme } = useTheme();
  const isClassic = theme === 'dark' || !theme;

  return (
    <div ref={mapPageRef} className={`${styles.mapPage} ${isClassic ? styles.mapPageClassic : ''}`}>
      {/* Ethnic Tribal Gold Accent Band (Crimson / Classic Theme) */}
      {isClassic && <div className={styles.tribalBorderTop} aria-hidden="true" />}

      {/* Editorial Page Masthead */}
      <header className={styles.masthead}>
        <div className={styles.mastheadContent}>
          {isClassic ? (
            <div className={styles.classicEyebrowRow}>
              <span className={styles.eyebrowLine} />
              <span className={styles.eyebrowDiamond}>◆</span>
              <div className={styles.eyebrowBadge}>
                <FiCompass size={13} className={styles.eyebrowIcon} />
                <span>CTU-DB GEOSPATIAL INTELLIGENCE & TELEMETRY</span>
              </div>
              <span className={styles.eyebrowDiamond}>◆</span>
              <span className={styles.eyebrowLine} />
            </div>
          ) : (
            <div className={styles.eyebrowBadge}>
              <FiCompass size={13} className={styles.eyebrowIcon} />
              <span>Campus Geospatial Telemetry</span>
            </div>
          )}
          <h1 className={styles.pageTitle}>Campus Interactive Map</h1>
          <p className={styles.pageSubtitle}>
            Full topological 2.5D tactical sky-view of Cebu Technological University – Daanbantayan Campus.
            Explore interactive architectural zoning, real-time venue dispatches, and student governance facilities.
          </p>
        </div>

        {/* Real-World Telemetry Metric Chips */}
        <div className={styles.telemetryChips}>
          <div className={styles.telemetryCard}>
            <span className={styles.telemetryLabel}>Total Campus Area</span>
            <strong className={styles.telemetryValue}>54,525.64 m²</strong>
            <span className={styles.telemetrySub}>5.45 Hectares</span>
          </div>
          <div className={styles.telemetryDivider} />
          <div className={styles.telemetryCard}>
            <span className={styles.telemetryLabel}>Perimeter Distance</span>
            <strong className={styles.telemetryValue}>987.92 m</strong>
            <span className={styles.telemetrySub}>Boundary Fence</span>
          </div>
          <div className={styles.telemetryDivider} />
          <div className={styles.telemetryCard}>
            <span className={styles.telemetryLabel}>Mapped Buildings</span>
            <strong className={styles.telemetryValue}>35 Zones</strong>
            <span className={styles.telemetrySub}>Verified GIS Assets</span>
          </div>
        </div>
      </header>

      {/* Control HUD Bar */}
      <div className={styles.hudBar}>
        {/* Search Input */}
        <div className={styles.searchWrapper}>
          <HiSearch className={styles.searchIcon} size={18} />
          <input
            type="text"
            placeholder="Search building, hall, laboratory, or gym..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={styles.searchInput}
          />
          {searchQuery && (
            <button
              type="button"
              className={styles.clearSearchBtn}
              onClick={() => setSearchQuery('')}
            >
              <HiX size={14} />
            </button>
          )}

          {/* Autocomplete Dropdown */}
          {searchResults.length > 0 && (
            <div className={styles.searchResultsDropdown}>
              {searchResults.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={styles.searchResultItem}
                  onClick={() => {
                    focusFeature(f);
                    centerOnFeature(f);
                  }}
                >
                  <span
                    className={styles.searchItemDot}
                    style={{ backgroundColor: f.category.color }}
                  />
                  <span className={styles.searchItemName}>{f.name}</span>
                  <span className={styles.searchItemCategory}>{f.category.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Category Filter Pills */}
        <div className={styles.categoryPills}>
          {MAP_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              className={`${styles.categoryPill} ${selectedCategory === cat.id ? styles.categoryPillActive : ''}`}
              onClick={() => setSelectedCategory(cat.id)}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Dedicated 2D vs 2.5D View Options Switcher */}
        <div className={styles.viewSegmentedGroup}>
          <button
            type="button"
            className={`${styles.viewSegmentBtn} ${viewMode === '2d' ? styles.viewSegmentBtnActive : ''}`}
            onClick={() => setViewMode('2d')}
            title="Switch to 2D Top-Down Sky View"
          >
            <FiCompass size={15} />
            <span>2D Sky View</span>
          </button>
          <button
            type="button"
            className={`${styles.viewSegmentBtn} ${viewMode === '2.5d' ? styles.viewSegmentBtnActive : ''}`}
            onClick={() => setViewMode('2.5d')}
            title="Switch to 2.5D Isometric 3D Tactical Model"
          >
            <FiLayers size={15} />
            <span>2.5D Isometric</span>
          </button>
        </div>

        {/* Basemap Imagery Mode Switcher: Blueprint vs Satellite */}
        <div className={styles.viewSegmentedGroup}>
          <button
            type="button"
            className={`${styles.viewSegmentBtn} ${basemapMode === 'blueprint' ? styles.viewSegmentBtnActive : ''}`}
            onClick={() => setBasemapMode('blueprint')}
            title="Switch to Vector Tactical Blueprint"
          >
            <HiViewGrid size={15} />
            <span>Blueprint</span>
          </button>
          <button
            type="button"
            className={`${styles.viewSegmentBtn} ${basemapMode === 'satellite' ? styles.viewSegmentBtnActive : ''}`}
            onClick={() => setBasemapMode('satellite')}
            title="Overlay High-Resolution Real Satellite Aerial Imagery"
          >
            <HiGlobeAlt size={15} />
            <span>🛰️ Satellite</span>
          </button>
        </div>

        {/* Satellite Imagery Controls (Opacity slider & Fence clip toggle) */}
        {isSatellite && (
          <div className={styles.satelliteOptionsGroup}>
            <span className={styles.satelliteOpacityLabel}>Opacity:</span>
            <input
              type="range"
              min="0.35"
              max="1.0"
              step="0.05"
              value={satelliteOpacity}
              onChange={(e) => setSatelliteOpacity(parseFloat(e.target.value))}
              className={styles.satelliteSlider}
              title={`Satellite Layer Opacity: ${(satelliteOpacity * 100).toFixed(0)}%`}
            />
            <span className={styles.isoDivider} />
            <button
              type="button"
              className={`${styles.satelliteClipBtn} ${clipToBoundary ? styles.satelliteClipBtnActive : ''}`}
              onClick={() => setClipToBoundary(!clipToBoundary)}
              title="Clip satellite imagery strictly inside the campus perimeter fence"
            >
              <span>{clipToBoundary ? '✂️ Clipped to Fence' : '🌐 Full Surroundings'}</span>
            </button>
          </div>
        )}

        {/* 2.5D Perspective Camera Tilt & Height Extrusion Options */}
        {isIsometric && (
          <div className={styles.isoOptionsGroup}>
            <span className={styles.isoOptionsLabel}>Tilt:</span>
            {[
              { label: '40° High', angle: 40, title: 'Bird\'s-Eye High Perspective (40°)' },
              { label: '52° Tactical', angle: 52, title: 'Tactical Isometric Standard (52°)' },
              { label: '64° Low', angle: 64, title: 'Dramatic Low-Altitude Skyline (64°)' },
            ].map((opt) => (
              <button
                key={opt.angle}
                type="button"
                className={`${styles.isoOptionBtn} ${isoAngle === opt.angle ? styles.isoOptionBtnActive : ''}`}
                onClick={() => setIsoAngle(opt.angle)}
                title={opt.title}
              >
                {opt.label}
              </button>
            ))}

            <span className={styles.isoDivider} />

            <span className={styles.isoOptionsLabel}>Height:</span>
            {[
              { label: '1.0x Normal', scale: 1.0, title: 'Standard 1:1 Architectural Height Extrusion' },
              { label: '1.4x Enhanced', scale: 1.4, title: 'Elevated 1.4x High-Contrast Facet Extrusion' }
            ].map((opt) => (
              <button
                key={opt.scale}
                type="button"
                className={`${styles.isoOptionBtn} ${extrudeScale === opt.scale ? styles.isoOptionBtnActive : ''}`}
                onClick={() => setExtrudeScale(opt.scale)}
                title={opt.title}
              >
                {opt.label}
              </button>
            ))}

            <span className={styles.isoDivider} />

            <span className={styles.isoOptionsLabel}>Roof Sheets:</span>
            {Object.values(ROOF_COLOR_PALETTES).map((pal) => (
              <button
                key={pal.id}
                type="button"
                className={`${styles.roofColorBtn} ${roofColor === pal.id ? styles.roofColorBtnActive : ''}`}
                onClick={() => handleSetRoofColor(pal.id)}
                title={`${pal.label} Corrugated Metal Roofing (MSR Halls keep Plain Galvanized Steel)`}
              >
                <span className={styles.roofColorSwatch} style={{ backgroundColor: pal.base }} />
                <span>{pal.label.split(' ')[1]}</span>
              </button>
            ))}
          </div>
        )}

        {/* Strictly Admin Only: Isometric Trees Manual Planting Toolbar */}
        {isStrictAdmin && (
          <div className={styles.adminTreeToolbar}>
            <button
              type="button"
              className={`${styles.adminTreeToggleBtn} ${isPlantingTree ? styles.adminTreeToggleBtnActive : ''}`}
              onClick={() => setIsPlantingTree(!isPlantingTree)}
              title="Admin Only: Toggle Isometric Tree Planting Mode"
            >
              <span className={styles.adminBadge}>ADMIN</span>
              <span>{isPlantingTree ? '🌲 Planting Active' : '🌲 Plant Trees'}</span>
            </button>

            {isPlantingTree && (
              <div className={styles.adminTreeControls}>
                <div className={styles.treeTypeSelector}>
                  {[
                    { id: 'mango', label: '🥭 Mango Tree' },
                    { id: 'acacia', label: '🌳 Acacia Tree' },
                    { id: 'palm', label: '🌴 Coconut Palm' },
                  ].map((type) => (
                    <button
                      key={type.id}
                      type="button"
                      className={`${styles.treeTypeBtn} ${selectedTreeType === type.id ? styles.treeTypeBtnActive : ''}`}
                      onClick={() => setSelectedTreeType(type.id)}
                    >
                      {type.label}
                    </button>
                  ))}
                </div>

                <span className={styles.isoDivider} />

                <span className={styles.treeCountBadge}>{trees.length} trees</span>

                {/* 🌟 Easter Egg Mango Fruit Season Indicator & Toggle */}
                <button
                  type="button"
                  className={`${styles.treeActionBtn} ${showMangoFruits ? styles.mangoSeasonBtnActive : ''}`}
                  onClick={() => setForceMangoFruits(!forceMangoFruits)}
                  title={isCalendarMangoSeason ? "March & May Harvest Season (Active by Calendar Month!)" : "Toggle March & May Mango Harvest Fruits Easter Egg"}
                >
                  {showMangoFruits ? '🥭 Mango Fruits: ACTIVE' : '🥭 Mango Fruits: OFF'}
                </button>

                <button
                  type="button"
                  className={styles.treeActionBtn}
                  onClick={handleUndoTree}
                  disabled={trees.length === 0}
                  title="Undo last planted tree"
                >
                  Undo
                </button>

                <button
                  type="button"
                  className={`${styles.treeActionBtn} ${styles.treeClearBtn}`}
                  onClick={handleClearAllTrees}
                  disabled={trees.length === 0}
                  title="Clear all planted trees"
                >
                  Clear
                </button>
              </div>
            )}
          </div>
        )}

        {/* Zoom Level Borders HUD & Actions */}
        <div className={styles.zoomControlsGroup}>
          <div className={styles.zoomRangeGauge}>
            <span className={styles.zoomMinLabel}>{(MIN_ZOOM * 100).toFixed(0)}%</span>
            <input
              type="range"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step="0.05"
              value={zoom}
              onChange={(e) => handleSliderZoom(e.target.value)}
              className={styles.zoomSlider}
              title="Adjust Zoom Level"
              aria-label="Zoom Level"
            />
            <span className={styles.zoomMaxLabel}>{(MAX_ZOOM * 100).toFixed(0)}%</span>
          </div>

          <div className={styles.zoomActions}>
            <button
              type="button"
              className={styles.hudActionBtn}
              onClick={() => handleZoom('in')}
              disabled={zoom >= MAX_ZOOM}
              title="Zoom In"
            >
              <HiZoomIn size={18} />
            </button>
            <button
              type="button"
              className={styles.hudActionBtn}
              onClick={() => handleZoom('out')}
              disabled={zoom <= MIN_ZOOM}
              title="Zoom Out"
            >
              <HiZoomOut size={18} />
            </button>
            <button
              type="button"
              className={styles.hudActionBtn}
              onClick={handleReset}
              title="Reset & Center Campus"
            >
              <HiRefresh size={18} />
            </button>
            <button
              type="button"
              className={`${styles.hudActionBtn} ${isMaximized ? styles.hudActionBtnActive : ''}`}
              onClick={() => setIsMaximized(!isMaximized)}
              title={isMaximized ? "Exit Fullscreen (Esc)" : "Expand / Fullscreen Map View"}
            >
              <FiMaximize2 size={18} />
            </button>
          </div>
        </div>
      </div>

      {/* Main Canvas Viewport Area */}
      <div
        ref={containerRef}
        className={`${styles.viewportContainer} ${isMaximized ? styles.viewportMaximized : ''} ${isDragging ? styles.viewportDragging : ''} ${isZooming ? styles.viewportZooming : ''} ${isPlantingTree && isStrictAdmin ? styles.plantingCursor : ''}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        {/* Fullscreen Exit Button */}
        {isMaximized && (
          <button
            type="button"
            className={styles.exitFullscreenBtn}
            onClick={() => setIsMaximized(false)}
            title="Exit Fullscreen (Esc)"
          >
            <HiX size={16} />
            <span>Exit Fullscreen</span>
          </button>
        )}

        {/* Admin Tree Planting Active Banner */}
        {isStrictAdmin && isPlantingTree && (
          <div className={styles.plantingBanner}>
            <span>🌿</span>
            <span>Admin Planting Active: Click on campus map to plant a {selectedTreeType}. Click any tree to remove it.</span>
          </div>
        )}

        {/* Tactical HUD Overlay Elements */}
        <div className={styles.compassRose}>
          <div
            className={styles.compassNeedle}
            style={{
              transform: isIsometric ? 'rotate(-22deg)' : 'rotate(0deg)',
              transition: 'transform 0.65s cubic-bezier(0.16, 1, 0.3, 1)'
            }}
          >
            <div className={styles.needleNorth} />
            <div className={styles.needleSouth} />
          </div>
          <span className={styles.compassNorthLabel}>N</span>
        </div>

        <div className={styles.gpsReadout}>
          <span>GPS: 11.2665° N, 124.0086° E</span>
          <span className={styles.gpsZoom}>Zoom: {(zoom * 100).toFixed(0)}%</span>
          <span className={styles.gpsModeBadge}>
            {isIsometric ? '2.5D ISO TACTICAL' : '2D SKY VIEW'}
          </span>
          <span className={styles.gpsBasemapBadge}>
            {isSatellite ? '🛰️ SATELLITE OVERLAY' : '🗺️ VECTOR BLUEPRINT'}
          </span>
        </div>

        {/* 3D Perspective Canvas Wrapper */}
        <div
          className={`${styles.mapSvgWrapper} ${isIsometric ? styles.mapSvgWrapperIsometric : ''}`}
          style={isIsometric ? { transform: `rotateX(${isoAngle}deg) rotateZ(-22deg) scale(1.14)` } : undefined}
        >
          {/* SVG Vector Map Rendering */}
          <svg
            ref={svgRef}
            viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
            className={styles.mapSvg}
            onClick={handleMapClick}
          >
            <defs>
              {/* Campus Boundary Fence Clip Path for Satellite Imagery */}
              {boundaryFeature && (
                <clipPath id="campusBoundaryClip">
                  <path d={boundaryFeature.pathD} />
                </clipPath>
              )}

              {/* Impeccable Architectural Blueprint Grid Patterns */}
              <pattern id="blueprintFineGrid" width="20" height="20" patternUnits="userSpaceOnUse">
                <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#00E5FF" strokeWidth="0.6" strokeOpacity="0.07" />
              </pattern>

              <pattern id="blueprintMajorGrid" width="100" height="100" patternUnits="userSpaceOnUse">
                <rect width="100" height="100" fill="url(#blueprintFineGrid)" />
                {/* Major Cadastral Grid Lines */}
                <path d="M 100 0 L 0 0 0 100" fill="none" stroke="#00E5FF" strokeWidth="1.2" strokeOpacity="0.18" />
                {/* Precision Crosshair Tick at Major Intersections */}
                <path d="M 0 6 L 0 -6 M -6 0 L 6 0" stroke="#00E5FF" strokeWidth="1.5" strokeOpacity="0.45" />
                {/* Subtle Dot in Center of Major Cell */}
                <circle cx="50" cy="50" r="1.2" fill="#00E5FF" fillOpacity="0.25" />
              </pattern>

              {/* Radial Vignette Lighting for Blueprint Substrate */}
              <radialGradient id="blueprintSubstrateGrad" cx="50%" cy="50%" r="75%">
                <stop offset="0%" stopColor="#0B1A30" />
                <stop offset="60%" stopColor="#071120" />
                <stop offset="100%" stopColor="#030812" />
              </radialGradient>

              {/* Architectural Wall Depth Drop-Shadow Filter */}
              <filter id="wallShadow" x="-30%" y="-30%" width="160%" height="160%">
                <feDropShadow dx="3" dy="6" stdDeviation="5" floodColor="#000000" floodOpacity="0.65" />
              </filter>

              {/* Glowing filter for active selection */}
              <filter id="glowAccent" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="8" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>

              {/* Campus Walkways & Promenade Cobblestone Pattern */}
              <pattern id="campusWalkwayPattern" width="16" height="16" patternUnits="userSpaceOnUse">
                <rect width="16" height="16" fill="#3D1D16" fillOpacity="0.45" />
                <path d="M 0 8 L 16 8 M 8 0 L 8 16" stroke="rgba(212, 175, 55, 0.22)" strokeWidth="0.8" />
                <rect x="1" y="1" width="6" height="6" fill="rgba(255, 234, 159, 0.05)" />
                <rect x="9" y="9" width="6" height="6" fill="rgba(255, 234, 159, 0.05)" />
              </pattern>

              {/* Lush Bermuda Grass Mowed Striped Pattern */}
              <pattern id="bermudaTurfPattern" width="44" height="44" patternUnits="userSpaceOnUse" patternTransform="rotate(25)">
                <rect width="44" height="22" fill="#14532D" />
                <rect y="22" width="44" height="22" fill="#15803D" />
                {/* Fine grass grain lines */}
                <line x1="11" y1="0" x2="11" y2="44" stroke="rgba(255, 255, 255, 0.04)" strokeWidth="1" />
                <line x1="33" y1="0" x2="33" y2="44" stroke="rgba(0, 0, 0, 0.07)" strokeWidth="1" />
              </pattern>

              {/* Food Court / Open Ground Pavers Pattern */}
              <pattern id="plazaPavingPattern" width="24" height="24" patternUnits="userSpaceOnUse">
                <rect width="24" height="24" fill="#B45309" fillOpacity="0.16" />
                <path d="M 0 12 L 24 12 M 12 0 L 12 24" stroke="rgba(245, 158, 11, 0.3)" strokeWidth="1" />
                <rect x="2" y="2" width="8" height="8" fill="rgba(251, 191, 36, 0.12)" />
                <rect x="14" y="14" width="8" height="8" fill="rgba(251, 191, 36, 0.12)" />
              </pattern>

              {/* Beach Volleyball Sand Court Pattern */}
              <pattern id="beachSandPattern" width="18" height="18" patternUnits="userSpaceOnUse">
                <rect width="18" height="18" fill="#F59E0B" fillOpacity="0.32" />
                <circle cx="4" cy="5" r="1.5" fill="#D97706" fillOpacity="0.4" />
                <circle cx="13" cy="12" r="1.5" fill="#D97706" fillOpacity="0.4" />
                <circle cx="10" cy="4" r="1" fill="#FDE68A" fillOpacity="0.5" />
                <circle cx="5" cy="14" r="1" fill="#FDE68A" fillOpacity="0.5" />
              </pattern>

              {/* 🏠 Corrugated Metal Ribbed Roof Patterns (Philippine Academic Standards) */}
              {/* Royal Crimson Corrugated Roofing */}
              <pattern id="roofRibsCrimson" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="10" height="10" fill="#881337" />
                <line x1="0" y1="5" x2="10" y2="5" stroke="#4C0519" strokeWidth="2.5" />
                <line x1="0" y1="3" x2="10" y2="3" stroke="#F43F5E" strokeWidth="1" strokeOpacity="0.6" />
              </pattern>

              {/* Imperial Gold Corrugated Roofing */}
              <pattern id="roofRibsGold" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="10" height="10" fill="#B45309" />
                <line x1="0" y1="5" x2="10" y2="5" stroke="#78350F" strokeWidth="2.5" />
                <line x1="0" y1="3" x2="10" y2="3" stroke="#FDE047" strokeWidth="1.2" strokeOpacity="0.75" />
              </pattern>

              {/* Terracotta Clay Corrugated Roofing */}
              <pattern id="roofRibsTerracotta" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="10" height="10" fill="#B45309" />
                <line x1="0" y1="5" x2="10" y2="5" stroke="#78350F" strokeWidth="2.5" />
                <line x1="0" y1="3" x2="10" y2="3" stroke="#F59E0B" strokeWidth="1" strokeOpacity="0.6" />
              </pattern>

              {/* Emerald Green Corrugated Roofing */}
              <pattern id="roofRibsEmerald" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="10" height="10" fill="#047857" />
                <line x1="0" y1="5" x2="10" y2="5" stroke="#064E3B" strokeWidth="2.5" />
                <line x1="0" y1="3" x2="10" y2="3" stroke="#34D399" strokeWidth="1" strokeOpacity="0.6" />
              </pattern>

              {/* Modern Navy Blue Corrugated Roofing */}
              <pattern id="roofRibsModernBlue" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="10" height="10" fill="#1D4ED8" />
                <line x1="0" y1="5" x2="10" y2="5" stroke="#1E3A8A" strokeWidth="2.5" />
                <line x1="0" y1="3" x2="10" y2="3" stroke="#60A5FA" strokeWidth="1" strokeOpacity="0.6" />
              </pattern>

              {/* Charcoal / Steel Corrugated Roofing */}
              <pattern id="roofRibsCharcoal" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="10" height="10" fill="#374151" />
                <line x1="0" y1="5" x2="10" y2="5" stroke="#1F2937" strokeWidth="2.5" />
                <line x1="0" y1="3" x2="10" y2="3" stroke="#9CA3AF" strokeWidth="1" strokeOpacity="0.5" />
              </pattern>

              {/* MSR Halls: Plain Galvanized Industrial Steel Sheets (Smooth, clean sheen with subtle seams) */}
              <pattern id="roofPlainSteel" width="28" height="28" patternUnits="userSpaceOnUse">
                <rect width="28" height="28" fill="#4B5563" />
                {/* Horizontal and vertical galvanized sheet seams */}
                <line x1="0" y1="0" x2="28" y2="0" stroke="#374151" strokeWidth="1.2" />
                <line x1="0" y1="1" x2="28" y2="1" stroke="#9CA3AF" strokeWidth="0.8" strokeOpacity="0.4" />
                <line x1="0" y1="0" x2="0" y2="28" stroke="#374151" strokeWidth="1" />
              </pattern>
            </defs>

            {/* Fixed Outer Bounds Guide */}
            <rect
              x={PADDING - 30}
              y={PADDING - 30}
              width={SVG_WIDTH - (PADDING - 30) * 2}
              height={SVG_HEIGHT - (PADDING - 30) * 2}
              rx="16"
              className={styles.mapBorderGuide}
            />

            {/* Zoom & Pan Group (Pivot Locked to SVG Center CX, CY) */}
            <g
              ref={mapGroupRef}
              className={isDragging ? styles.mapGroupDragging : isZooming ? styles.mapGroupZooming : styles.mapGroupSmooth}
              transform={`translate(${CX + pan.x}, ${CY + pan.y}) scale(${zoom}) translate(${-CX}, ${-CY})`}
            >
              {/* Background Blueprint Substrate (visible in Blueprint mode) */}
              {!isSatellite && (
                <g className={styles.blueprintSubstrateLayer}>
                  {/* Deep Blueprint Midnight Base */}
                  <rect width={SVG_WIDTH} height={SVG_HEIGHT} fill="url(#blueprintSubstrateGrad)" />
                  {/* Precision Major and Minor Grid Layer */}
                  <rect width={SVG_WIDTH} height={SVG_HEIGHT} fill="url(#blueprintMajorGrid)" />
                </g>
              )}

              {/* High-Resolution Satellite Aerial Photography Layer */}
              {isSatellite && (
                <g
                  clipPath={clipToBoundary ? "url(#campusBoundaryClip)" : undefined}
                  style={{ opacity: satelliteOpacity, transition: 'opacity 0.25s ease' }}
                >
                  {satelliteTiles.map((tile) => (
                    <image
                      key={tile.id}
                      href={tile.src}
                      x={tile.x}
                      y={tile.y}
                      width={tile.width}
                      height={tile.height}
                      preserveAspectRatio="none"
                      onError={(e) => {
                        if (e.currentTarget.href.baseVal !== tile.fallbackSrc) {
                          e.currentTarget.href.baseVal = tile.fallbackSrc;
                        }
                      }}
                    />
                  ))}
                </g>
              )}

              {/* Campus Boundary Layer (CTU Shape) */}
              {boundaryFeature && (
                <g className={styles.boundaryGroup}>
                  <path
                    d={boundaryFeature.pathD}
                    className={isSatellite ? styles.boundaryFillSatellite : styles.boundaryFill}
                  />
                  <path
                    d={boundaryFeature.pathD}
                    className={isSatellite ? styles.boundaryStrokeSatellite : styles.boundaryStroke}
                  />
                </g>
              )}

              {/* 🚶 Architectural Pedestrian Walkway Corridors & Landscaped Grounds */}
              <g className={styles.campusEnvironmentLayer} pointerEvents="none">
                {/* Main East-West Promenade Connecting Entrance Gate to Oval */}
                <path
                  d="M 270 1010 L 910 1010 M 740 700 L 740 1480 M 590 850 L 890 850 M 590 1260 L 890 1260"
                  stroke="url(#campusWalkwayPattern)"
                  strokeWidth="22"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={isSatellite ? 0.65 : 0.9}
                />
                {/* Polished Gold Curbs along Promenade */}
                <path
                  d="M 270 999 L 910 999 M 270 1021 L 910 1021 M 729 700 L 729 1480 M 751 700 L 751 1480"
                  stroke="rgba(212, 175, 55, 0.4)"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeDasharray="8 6"
                  opacity={0.8}
                />

                {/* Campus Quadrangle Central Fountain / Compass Plaza */}
                <g transform="translate(740, 1010)">
                  {/* Outer Plaza Ring */}
                  <circle r="42" fill="rgba(30, 6, 10, 0.7)" stroke="#D4AF37" strokeWidth="2" strokeDasharray="4 3" />
                  <circle r="36" fill="url(#campusWalkwayPattern)" />
                  {/* Decorative Compass Medallion */}
                  <circle r="18" fill="rgba(136, 19, 55, 0.85)" stroke="#E5B842" strokeWidth="1.5" />
                  <polygon points="0,-14 4,-4 14,0 4,4 0,14 -4,4 -14,0 -4,-4" fill="#E5B842" />
                  <circle r="3" fill="#140305" />
                </g>
              </g>

              {/* Sports Oval Layer with Lush Bermuda Grass Turf & Athletics Track */}
              {ovalFeature && (
                <g
                  className={styles.ovalGroup}
                  onClick={() => focusFeature(ovalFeature)}
                  onMouseEnter={() => setHoveredFeature(ovalFeature)}
                  onMouseLeave={() => setHoveredFeature(null)}
                >
                  {/* 1. Outer Athletics Running Track Surface (Terracotta/Brick Red Clay) */}
                  <path
                    d={ovalFeature.pathD}
                    className={styles.ovalTrackBase}
                  />

                  {/* Running Track Guideline Lanes */}
                  <path
                    d={ovalFeature.pathD}
                    className={styles.ovalTrackLanes}
                  />

                  {/* 2. Inner Lush Bermuda Grass Turf (Scaled inward from Oval center CX: 430, CY: 1013) */}
                  <g transform="translate(430, 1013) scale(0.82, 0.88) translate(-430, -1013)">
                    {/* Bermuda Grass Base Fill */}
                    <path
                      d={ovalFeature.pathD}
                      className={styles.bermudaTurfFill}
                    />
                    {/* Alternating Mowed Bermuda Turf Pattern */}
                    <path
                      d={ovalFeature.pathD}
                      fill="url(#bermudaTurfPattern)"
                      opacity="0.9"
                    />
                    {/* Crisp Turf Outer Perimeter Border */}
                    <path
                      d={ovalFeature.pathD}
                      className={styles.bermudaTurfBorder}
                    />

                    {/* Regulation Football / Soccer Field Markings */}
                    {/* Halfway Line */}
                    <line
                      x1="280"
                      y1="1013"
                      x2="580"
                      y2="1013"
                      stroke="rgba(255, 255, 255, 0.5)"
                      strokeWidth="2.5"
                    />
                    {/* Center Circle */}
                    <circle
                      cx="430"
                      cy="1013"
                      r="44"
                      fill="none"
                      stroke="rgba(255, 255, 255, 0.5)"
                      strokeWidth="2.5"
                    />
                    {/* Center Spot */}
                    <circle
                      cx="430"
                      cy="1013"
                      r="4"
                      fill="#FFFFFF"
                    />

                    {/* North Goal Penalty Box */}
                    <rect
                      x="365"
                      y="700"
                      width="130"
                      height="75"
                      fill="none"
                      stroke="rgba(255, 255, 255, 0.5)"
                      strokeWidth="2"
                    />
                    {/* South Goal Penalty Box */}
                    <rect
                      x="365"
                      y="1250"
                      width="130"
                      height="75"
                      fill="none"
                      stroke="rgba(255, 255, 255, 0.5)"
                      strokeWidth="2"
                    />
                  </g>

                  {/* Tactical Oval Badge with Bermuda Turf Indicator */}
                  <g transform={`translate(${ovalFeature.centroid[0]}, ${ovalFeature.centroid[1]})`}>
                    <rect
                      x="-105"
                      y="-22"
                      width="210"
                      height="44"
                      rx="8"
                      className={styles.ovalBadgeBg}
                    />
                    <text
                      y="-3"
                      className={styles.ovalLabel}
                      textAnchor="middle"
                    >
                      CTU ATHLETIC OVAL
                    </text>
                    <text
                      y="14"
                      className={styles.ovalSubLabel}
                      textAnchor="middle"
                    >
                      🌱 BERMUDA GRASS TURF
                    </text>
                  </g>
                </g>
              )}

              {/* Isometric Trees Layer */}
              <g className={styles.treesLayer}>
                {trees.map((t) => (
                  <IsometricTree
                    key={t.id}
                    tree={t}
                    isIsometric={isIsometric}
                    isAdmin={isStrictAdmin}
                    isPlantingMode={isPlantingTree}
                    showMangoFruits={showMangoFruits}
                    onRemove={handleRemoveTree}
                  />
                ))}
              </g>

              {/* Building Polygons Layer (Memoized for Butter-Smooth 60/120fps Pan & Drag) */}
              {buildingFeatures.map((feat) => {
                const isSelected = selectedFeature?.id === feat.id;
                const isHovered = hoveredFeature?.id === feat.id;
                const matchesFilter = selectedCategory === 'ALL' || feat.category.id === selectedCategory;

                return (
                  <BuildingFeatureItem
                    key={feat.id}
                    feat={feat}
                    isSelected={isSelected}
                    isHovered={isHovered}
                    matchesFilter={matchesFilter}
                    isIsometric={isIsometric}
                    extrudeScale={extrudeScale}
                    isSatellite={isSatellite}
                    roofColor={roofColor}
                    onSelect={focusFeature}
                    onHover={setHoveredFeature}
                    onHoverLeave={handleBuildingLeave}
                    isPlantingActive={isStrictAdmin && isPlantingTree}
                  />
                );
              })}

              {/* Point Markers Layer (Pins with radar pulse) */}
              {pointFeatures.map((feat) => {
                const [px, py] = feat.pointCoord;
                const isSelected = selectedFeature?.id === feat.id;
                const isHovered = hoveredFeature?.id === feat.id;
                const matchesFilter = selectedCategory === 'ALL' || feat.category.id === selectedCategory;
                if (!matchesFilter) return null;

                return (
                  <g
                    key={feat.id}
                    className={styles.pinGroup}
                    transform={`translate(${px}, ${py})`}
                    onClick={(e) => {
                      e.stopPropagation();
                      focusFeature(feat);
                    }}
                    onMouseEnter={() => setHoveredFeature(feat)}
                    onMouseLeave={() => setHoveredFeature(null)}
                  >
                    {/* Radar Pulse Ring */}
                    <circle r="16" className={styles.pinRadar} style={{ stroke: feat.category.color }} />
                    {/* Solid Center Pin */}
                    <circle
                      r={isHovered ? 10 : 8}
                      className={styles.pinDot}
                      style={{
                        fill: feat.category.color,
                        stroke: '#FFFFFF',
                        strokeWidth: isSelected || isHovered ? 3 : 1.5
                      }}
                    />
                    {/* Label */}
                    <text
                      x="12"
                      y="4"
                      className={styles.pinText}
                      style={{ fill: '#FFFFFF' }}
                    >
                      {feat.name}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        </div>

        {/* Mobile Floating Action Controls Bar (Thumb-reach FABs) */}
        <div className={styles.mobileFloatingActions}>
          <button
            type="button"
            className={styles.mobileFabBtn}
            onClick={() => handleZoom('in')}
            disabled={zoom >= MAX_ZOOM}
            aria-label="Zoom in"
          >
            <HiZoomIn size={20} />
          </button>
          <button
            type="button"
            className={styles.mobileFabBtn}
            onClick={() => handleZoom('out')}
            disabled={zoom <= MIN_ZOOM}
            aria-label="Zoom out"
          >
            <HiZoomOut size={20} />
          </button>
          <button
            type="button"
            className={styles.mobileFabBtn}
            onClick={handleReset}
            aria-label="Reset map view"
          >
            <HiRefresh size={20} />
          </button>
          <button
            type="button"
            className={`${styles.mobileFabBtn} ${isIsometric ? styles.mobileFabBtnActive : ''}`}
            onClick={() => setViewMode(isIsometric ? '2d' : '2.5d')}
            aria-label="Toggle 2D / 2.5D Isometric view"
          >
            <FiLayers size={18} />
          </button>
          <button
            type="button"
            className={`${styles.mobileFabBtn} ${isMaximized ? styles.mobileFabBtnActive : ''}`}
            onClick={() => setIsMaximized(!isMaximized)}
            aria-label="Toggle fullscreen view"
          >
            <FiMaximize2 size={18} />
          </button>
        </div>

        {/* Selected Building Detail Drawer / Modal Card */}
        {selectedFeature && (
          <div className={styles.detailCard}>
            <div className={styles.drawerHandleBar}>
              <div className={styles.drawerHandle} />
            </div>
            <div className={styles.detailHeader}>
              <div className={styles.detailHeaderMeta}>
                <span
                  className={styles.detailCategoryBadge}
                  style={{
                    backgroundColor: selectedFeature.category.color + '25',
                    color: selectedFeature.category.color,
                    borderColor: selectedFeature.category.color + '55'
                  }}
                >
                  {selectedFeature.category.label}
                </span>
                <h3 className={styles.detailTitle}>{selectedFeature.name}</h3>
              </div>
              <button
                type="button"
                className={styles.detailCloseBtn}
                onClick={() => setSelectedFeature(null)}
                aria-label="Close details"
              >
                <HiX size={18} />
              </button>
            </div>

            <div className={styles.detailBody}>
              <div className={styles.detailRow}>
                <span className={styles.detailRowLabel}>Campus Zone:</span>
                <span className={styles.detailRowVal}>CTU Daanbantayan Grounds</span>
              </div>
              <div className={styles.detailRow}>
                <span className={styles.detailRowLabel}>Feature Type:</span>
                <span className={styles.detailRowVal}>
                  {selectedFeature.isOval
                    ? 'Bermuda Grass Athletic Oval'
                    : selectedFeature.isGroundPlaza
                      ? 'Open-Air Ground Plaza / Student Dining Square'
                      : `${selectedFeature.raw.geometry.type} (${selectedFeature.height > 0 ? `${selectedFeature.height}m Extruded Building` : 'Ground Area'})`}
                </span>
              </div>

              {/* Action Buttons */}
              <div className={styles.detailActions} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <button
                  type="button"
                  className={styles.copyActionBtn}
                  onClick={() => centerOnFeature(selectedFeature)}
                  title="Recenter camera smoothly on this building"
                >
                  <FiNavigation size={14} />
                  <span>Center in View</span>
                </button>
                <button
                  type="button"
                  className={styles.copyActionBtn}
                  onClick={() => handleCopyName(selectedFeature.name)}
                >
                  {copiedLocation ? <FiCheck size={14} /> : <FiCopy size={14} />}
                  <span>{copiedLocation ? 'Copied to Clipboard!' : 'Copy Venue Name'}</span>
                </button>
              </div>

              {/* Linked Announcements Section */}
              <div className={styles.announcementsSection}>
                <div className={styles.announcementsHeading}>
                  <HiSpeakerphone size={16} />
                  <h4>Live Venue Dispatches ({venueAnnouncements.length})</h4>
                </div>

                {venueAnnouncements.length > 0 ? (
                  <div className={styles.announcementsList}>
                    {venueAnnouncements.map((ann) => (
                      <div key={ann.id} className={styles.announcementItem}>
                        <div className={styles.annHeader}>
                          <span className={styles.annCategory}>{ann.category || 'General'}</span>
                          <span className={styles.annDate}>{ann.eventDate || 'Upcoming'}</span>
                        </div>
                        <h5 className={styles.annTitle}>{ann.title}</h5>
                        {ann.description && (
                          <p className={styles.annDesc}>
                            {ann.description.length > 110 ? ann.description.slice(0, 105) + '…' : ann.description}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={styles.emptyAnnouncements}>
                    <HiInformationCircle size={18} />
                    <p>No active dispatches specifically assigned to this venue at this moment.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Campus Map Legend Strip at Bottom */}
      <footer className={styles.mapFooter}>
        <div className={styles.legendContainer}>
          <div className={styles.legendTitle}>
            <HiTag size={14} />
            <span>Campus Legend:</span>
          </div>
          <div className={styles.legendItems}>
            <div className={styles.legendItem}>
              <span className={styles.legendSwatch} style={{ backgroundColor: '#991B1B' }} />
              <span>Admin & Governance</span>
            </div>
            <div className={styles.legendItem}>
              <span className={styles.legendSwatch} style={{ backgroundColor: '#D4AF37' }} />
              <span>SSG Headquarters</span>
            </div>
            <div className={styles.legendItem}>
              <span className={styles.legendSwatch} style={{ backgroundColor: '#BE185D' }} />
              <span>Academic Buildings & Classrooms</span>
            </div>
            <div className={styles.legendItem}>
              <span className={styles.legendSwatch} style={{ backgroundColor: '#BE123C' }} />
              <span>Kalambuan Sports Gym</span>
            </div>
            <div className={styles.legendItem}>
              <span className={styles.legendSwatch} style={{ backgroundColor: '#10B981' }} />
              <span>Athletics & Bermuda Oval</span>
            </div>
            <div className={styles.legendItem}>
              <span className={styles.legendSwatch} style={{ backgroundColor: '#E11D48' }} />
              <span>Canteen & Food Court</span>
            </div>
            <div className={styles.legendItem}>
              <span className={styles.legendSwatch} style={{ backgroundColor: '#9333EA' }} />
              <span>Workshops & MSR Labs</span>
            </div>
            <div className={styles.legendItem}>
              <span className={styles.legendSwatch} style={{ backgroundColor: '#881337' }} />
              <span>54,525 m² Perimeter Fence</span>
            </div>
          </div>
        </div>
      </footer>

      {/* Bottom Decorative Tribal Band (Classic Theme Only) */}
      {isClassic && <div className={styles.tribalBorderBottom} aria-hidden="true" />}
    </div>
  );
}

export default CampusMap;
