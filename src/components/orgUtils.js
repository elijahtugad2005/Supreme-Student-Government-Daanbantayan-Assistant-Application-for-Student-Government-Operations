// Shared constants + helpers for the multi-organization member module.

export const SSG_ID = "ssg";
export const SSG_DEFAULT_NAME = "Supreme Student Government";
export const FALLBACK_TERM = "2025-2026"; // members saved before terms were selectable
export const DEFAULT_TERMS = ["2024-2025", "2025-2026"];

export const isValidTerm = (t) => {
  const m = /^(\d{4})-(\d{4})$/.exec(t || "");
  return !!m && Number(m[2]) === Number(m[1]) + 1;
};

// Resize + compress an image file to a base64 data URL.
// Logos keep transparency (PNG); photos become JPEG.
export function compressImage(file, { maxSize = 1000, quality = 0.8, keepTransparency = false } = {}) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(keepTransparency ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

export function getPositionLogo(position) {
  const pos = position?.toLowerCase() || "";
  if (pos.includes("vice president")) return "🎖️";
  if (pos.includes("president")) return "👑";
  if (pos.includes("governor")) return "🏛️";
  if (pos.includes("senator")) return "⚖️";
  if (pos.includes("secretary")) return "📋";
  if (pos.includes("treasurer")) return "💰";
  if (pos.includes("auditor")) return "🔍";
  if (pos.includes("representative")) return "🗳️";
  if (pos.includes("adviser") || pos.includes("advisor")) return "🎓";
  if (pos.includes("director") || pos.includes("head")) return "🎬";
  if (pos.includes("multimedia")) return "🎨";
  if (pos.includes("activity")) return "⚡";
  return "👤";
}

// ── Hierarchy config ───────────────────────────────────────────────
// A custom org stores `sections` (default template) and optional
// `termConfigs[term].sections` so every term can have its own chart.
export const getSections = (org, term) =>
  org?.termConfigs?.[term]?.sections ?? org?.sections ?? [];

export const ICON_CHOICES = ["👑", "🎓", "🏛️", "📋", "💼", "🎨", "🏢", "⭐", "🤝", "📣", "💰", "🛠️", "⚖️", "🎬"];

export const SECTION_PRESETS = {
  officers: {
    label: "Executive Officers", icon: "👑", limit: 6, layout: "tree",
    positions: [
      { title: "President" },
      { title: "Vice President" },
      { title: "Secretary" },
      { title: "Treasurer", sameLevel: true },
      { title: "Auditor", sameLevel: true },
    ],
  },
  secretaries: {
    label: "Secretaries", icon: "📋", limit: 8, layout: "tree",
    positions: [
      { title: "Executive Secretary" },
      { title: "Secretary" },
      { title: "Assistant Secretary", sameLevel: true },
    ],
  },
  departments: {
    label: "Departments", icon: "🏢", limit: 12, layout: "tree",
    positions: [
      { title: "Department Head" },
      { title: "Assistant Head" },
      { title: "Department Member" },
    ],
  },
  committee: {
    label: "Committee", icon: "🤝", limit: 10, layout: "grid",
    positions: [{ title: "Chairperson" }, { title: "Member" }],
  },
  blank: { label: "New Section", icon: "⭐", limit: 10, layout: "grid", positions: [] },
};

export const makeSection = (presetKey = "blank") => ({
  key: `sec_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
  ...JSON.parse(JSON.stringify(SECTION_PRESETS[presetKey] || SECTION_PRESETS.blank)),
});

// Turn a section's ordered position list into hierarchy levels.
// First position = top of the chart; `sameLevel` puts a position beside the previous one.
// Members whose position isn't in the list drop into a final "Other" level.
export function buildLevels(section, sectionMembers) {
  const levels = [];
  const levelOf = new Map();
  const order = new Map();

  (section.positions || []).forEach((p, i) => {
    if (i === 0 || !p.sameLevel) levels.push({ titles: [], members: [] });
    levels[levels.length - 1].titles.push(p.title);
    const k = p.title.trim().toLowerCase();
    levelOf.set(k, levels.length - 1);
    order.set(k, i);
  });

  const other = [];
  sectionMembers.forEach((m) => {
    const idx = levelOf.get((m.position || "").trim().toLowerCase());
    if (idx === undefined) other.push(m);
    else levels[idx].members.push(m);
  });

  const rank = (m) => order.get((m.position || "").trim().toLowerCase()) ?? 0;
  levels.forEach((l) => l.members.sort((a, b) => rank(a) - rank(b)));
  if (other.length) levels.push({ titles: ["Other"], members: other, isOther: true });
  return levels;
}

export const timeOf = (ts) => ts?.toMillis?.() ?? (ts instanceof Date ? ts.getTime() : 0);
