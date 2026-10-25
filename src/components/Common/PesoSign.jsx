import React from 'react';

/**
 * Universal Philippine Peso (₱) SVG icon component
 * Designed to seamlessly blend with Lucide stroke-based icon system (24x24 viewport)
 */
export const PesoSign = ({ size = 20, strokeWidth = 2, className = '', style = {} }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    style={style}
  >
    {/* Base P stem and curved bowl */}
    <path d="M7 21V4h7a5 5 0 0 1 0 10H7" />
    {/* Dual upper horizontal crossbars of the Philippine Peso symbol */}
    <line x1="4.5" y1="7" x2="16.5" y2="7" />
    <line x1="4.5" y1="11" x2="16.5" y2="11" />
  </svg>
);

export default PesoSign;
