import fs from 'fs';
import path from 'path';

const VAULT_DIRS = ['Obisidian Documentation'];

function getTagClassification(relativePath, fileName) {
  const rel = relativePath.toLowerCase();
  const name = fileName.toLowerCase();

  const tags = new Set(['ssg-app']);

  // 1. MANUSCRIPT
  if (rel.includes('06_research_manuscripts') || name.includes('chapter') || name.includes('manuscript') || name.includes('literature')) {
    tags.add('manuscript');
  }

  // 2. CHANGELOGS
  if (
    name.includes('progress_report') ||
    name.includes('bugfix') ||
    name.includes('fix_summary') ||
    name.includes('update_summary') ||
    name.includes('session') ||
    name.includes('changelog') ||
    name.includes('implementation_summary') ||
    name.includes('completion_summary')
  ) {
    tags.add('changelogs');
  }

  // 3. COMPONENTS
  if (
    rel.includes('05_system_ui_components') ||
    name.includes('modal') ||
    name.includes('carousel') ||
    name.includes('calendar') ||
    name.includes('widget') ||
    name.includes('table') ||
    name.includes('sidebar') ||
    name.includes('animation') ||
    name.includes('theme') ||
    name.includes('card') ||
    name.includes('button') ||
    name.includes('catalog')
  ) {
    tags.add('components');
  }

  // 4. FRONT END
  if (
    rel.includes('05_system_ui_components') ||
    rel.includes('02_commerce_merchandising') ||
    name.includes('ui') ||
    name.includes('visual') ||
    name.includes('design') ||
    name.includes('hero') ||
    name.includes('login') ||
    name.includes('password') ||
    name.includes('dashboard') ||
    name.includes('commerce_hub') ||
    name.includes('track_order') ||
    name.includes('tutorial')
  ) {
    tags.add('front-end');
  }

  // 5. BACKEND
  if (
    rel.includes('01_architecture_database') ||
    rel.includes('03_finance_ledger') ||
    rel.includes('07_devops_deployment') ||
    rel.includes('db-atlas') ||
    name.includes('firebase') ||
    name.includes('mongodb') ||
    name.includes('ledger') ||
    name.includes('stock_management') ||
    name.includes('schema') ||
    name.includes('erd') ||
    name.includes('order_submission') ||
    name.includes('auth') ||
    name.includes('admin_sdk') ||
    name.includes('deploy')
  ) {
    tags.add('backend');
  }

  // Edge cases for MOCs & Indices
  if (name.includes('00_vault_index')) {
    tags.add('front-end');
    tags.add('backend');
    tags.add('components');
    tags.add('manuscript');
    tags.add('changelogs');
  }

  return Array.from(tags);
}

function processMarkdownFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8');
  const fileName = path.basename(filePath);
  const relPath = filePath.replace(/^[^\/\\]+[\/\\]/, '');

  const newTags = getTagClassification(relPath, fileName);

  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/);

  if (frontmatterMatch) {
    let fContent = frontmatterMatch[1];

    // Remove ctu-daanbantayan
    fContent = fContent.replace(/^\s*-\s*ctu-daanbantayan\r?\n?/gm, '');

    // Parse existing tags if present
    const existingTagsMatch = fContent.match(/tags:\r?\n((?:\s*-\s*[\w\-\/]+\r?\n?)+)/);
    let mergedTags = new Set(newTags);

    if (existingTagsMatch) {
      const existingTagLines = existingTagsMatch[1].match(/^\s*-\s*([\w\-\/]+)/gm) || [];
      for (const line of existingTagLines) {
        const clean = line.replace(/^\s*-\s*/, '').trim();
        if (clean && clean !== 'ctu-daanbantayan') {
          mergedTags.add(clean);
        }
      }

      // Replace tags block
      const tagsYaml = 'tags:\n' + Array.from(mergedTags).map(t => `  - ${t}`).join('\n');
      fContent = fContent.replace(/tags:\r?\n(?:\s*-\s*[\w\-\/]+\r?\n?)+/, tagsYaml + '\n');
    } else {
      // Add tags block at the top of frontmatter
      const tagsYaml = 'tags:\n' + Array.from(mergedTags).map(t => `  - ${t}`).join('\n');
      fContent = tagsYaml + '\n' + fContent;
    }

    content = content.replace(/^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/, `---\n${fContent.trim()}\n---\n`);
  } else {
    // Inject brand new frontmatter
    const tagsYaml = 'tags:\n' + newTags.map(t => `  - ${t}`).join('\n');
    content = `---\ntitle: "${fileName.replace(/\.md$/, '').replace(/_/g, ' ')}"\n${tagsYaml}\n---\n\n` + content;
  }

  fs.writeFileSync(filePath, content, 'utf-8');
}

function walkAndProcess(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '.git' && entry.name !== 'node_modules') {
        walkAndProcess(full);
      }
    } else if (entry.name.endsWith('.md')) {
      processMarkdownFile(full);
    }
  }
}

// Process both Documents and Documentations
for (const vaultDir of VAULT_DIRS) {
  if (fs.existsSync(vaultDir)) {
    console.log(`Updating tags in: ${vaultDir}...`);
    walkAndProcess(vaultDir);

    // Update .obsidian/graph.json with new tags
    const graphFile = path.join(vaultDir, '.obsidian', 'graph.json');
    const graphConfig = {
      "collapse-filter": false,
      "search": "",
      "localJumps": 1,
      "localBacklinks": true,
      "localForelinks": true,
      "localInterlinks": false,
      "showTags": true,
      "showAttachments": false,
      "hideUnresolved": false,
      "collapse-color-groups": false,
      "colorGroups": [
        { "query": "tag:#ssg-app", "color": { "a": 1, "rgb": 6513649 } },      // Indigo (#6366f1)
        { "query": "tag:#front-end", "color": { "a": 1, "rgb": 440212 } },       // Cyan (#06b6d4)
        { "query": "tag:#backend", "color": { "a": 1, "rgb": 16096779 } },      // Amber (#f59e0b)
        { "query": "tag:#components", "color": { "a": 1, "rgb": 11032055 } },   // Purple (#a855f7)
        { "query": "tag:#changelogs", "color": { "a": 1, "rgb": 1096065 } },     // Emerald (#10b981)
        { "query": "tag:#manuscript", "color": { "a": 1, "rgb": 15485081 } }     // Pink (#ec4899)
      ],
      "collapse-display": false,
      "showArrow": true,
      "textFadeMultiplier": 0,
      "nodeSizeMultiplier": 1.25,
      "lineSizeMultiplier": 1.1,
      "collapse-forces": false,
      "centerStrength": 0.45,
      "repelStrength": 14,
      "linkStrength": 1.2,
      "linkDistance": 220,
      "scale": 1.0,
      "close": false
    };

    const obsDir = path.join(vaultDir, '.obsidian');
    if (!fs.existsSync(obsDir)) fs.mkdirSync(obsDir, { recursive: true });
    fs.writeFileSync(graphFile, JSON.stringify(graphConfig, null, 2), 'utf-8');
    console.log(`Updated graph.json for ${vaultDir}`);
  }
}

console.log('✅ All tags updated: "ctu-daanbantayan" replaced with "ssg-app", and added "front-end", "backend", "components", "changelogs", "manuscript".');
