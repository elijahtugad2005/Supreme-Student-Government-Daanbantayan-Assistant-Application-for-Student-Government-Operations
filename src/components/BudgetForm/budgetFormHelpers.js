export const SPONSOR_COMMITTEES = [
  'Senators',
  'Representatives',
  'Governors',
  'Secretaries',
  'Multimedia & Creatives',
];

const LEGACY_COMMITTEE_MAP = {
  'finance committee': 'Secretaries',
  'secretariat': 'Secretaries',
  'public relations': 'Multimedia & Creatives',
  'cultural committee': 'Multimedia & Creatives',
  'executive board': 'Senators',
  'general': 'Senators',
  'events committee': 'Senators',
  'academic committee': 'Representatives',
  'sports committee': 'Governors',
};

export const parseCommittees = (value) => {
  const rawParts = String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const matched = [];
  for (const part of rawParts) {
    if (SPONSOR_COMMITTEES.includes(part)) {
      if (!matched.includes(part)) matched.push(part);
    } else {
      const mapped = LEGACY_COMMITTEE_MAP[part.toLowerCase()];
      if (mapped && !matched.includes(mapped)) {
        matched.push(mapped);
      }
    }
  }

  if (matched.length === 0 && rawParts.length > 0) {
    return ['Senators'];
  }
  return matched;
};

export const joinCommittees = (list) =>
  SPONSOR_COMMITTEES.filter((c) => list.includes(c)).join(', ');

export const lineTotal = (item) =>
  (parseFloat(item.quantity) || 0) * (parseFloat(item.unitCost) || 0);
