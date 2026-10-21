# ⚡ Agent Skills Quick Reference & Command Palette Guide

This guide lists all **56 installed agent skills** across repositories (`mattpocock/skills`, `Leonxlnx/taste-skill`, `cathrynlavery/diagram-design`, and built-in Antigravity IDE engines), categorized by workflow, with trigger phrases, use cases, shortcut keys, and prompt patterns.

---

## ⌨️ Shortcut Keys & Invocations in the IDE

| Action | Windows Shortcut | What it Does |
| :--- | :--- | :--- |
| **Open Command Palette** | <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>P</kbd> | Search all IDE actions, skills, and tools |
| **Focus Chat Input** | <kbd>Ctrl</kbd> + <kbd>L</kbd> | Jump cursor straight into chat to type a skill command |
| **Trigger Slash Commands** | Type `/` in chat | Brings up the live auto-complete list of available skills |
| **Quick File Switcher** | <kbd>Ctrl</kbd> + <kbd>P</kbd> | Quickly open any skill instruction file (`SKILL.md`) |
| **Direct Prompt Invocation** | `Run <skill-name>` | Works with natural phrases (e.g., *"run brandkit for my logo"*, *"redesign this page"*) |

---

## 📦 Installed Skill Repositories & Origins

- 🎨 **`Leonxlnx/taste-skill`**: Elite UI/UX, brand design systems, GSAP motion engineering, image generation, and brutalist/minimalist aesthetics.
- 📐 **`cathrynlavery/diagram-design`**: Branded architecture models, workflows, flowcharts, ER/data diagrams, and system visualizations.
- ⚙️ **`mattpocock/skills`**: Full software lifecycle (debugging, TDD, codebase design, specs, ticketing, grilling, and session handoffs).
- 🚀 **Built-in IDE Skills**: Antigravity customization engine, AGY guide, and GitHub automation.

---

## 🎯 Categorized Skill Reference

### 1. 🎨 Elite Visual Design, UI/UX & Motion (Frontend)
*Powered by `Leonxlnx/taste-skill`*

| Command / Trigger | Use Case & When to Use | Key Output |
| :--- | :--- | :--- |
| `/design-taste-frontend` | Anti-slop frontend design for landing pages, portfolios, and redesigns without template look | High-agency, bespoke UI components & clean layouts |
| `/design-taste-frontend-v1` | Legacy version of design taste frontend (preserved for strict backward compatibility) | Classic anti-slop frontend styling and patterns |
| `/high-end-visual-design` | Agency-level visual polish ($150k+ look); bans cheap defaults (Inter, harsh shadows, generic borders) | Premium typography, haptic depth, diffused shadows, glassmorphism |
| `/gpt-taste` | Advanced GSAP motion engineering, AIDA flow, true randomized layouts, and wide editorial typography | Awwwards-tier animated web sections with GSAP ScrollTriggers |
| `/stitch-design-taste` | Generates semantic `DESIGN.md` design system specs for Google Stitch screen generation | Complete `DESIGN.md` system guidelines (colors, typography, motion) |
| `/redesign-existing-projects` | Audits existing code for generic AI UI clichés and upgrades it without rewriting logic | Non-breaking visual overhaul, elevated typography & spacing |
| `/minimalist-ui` | Editorial, document-style minimalist interfaces (monochrome palette, flat bento, muted pastels) | Clean, distraction-free UI with refined typography and zero heavy shadows |
| `/industrial-brutalist-ui` | Raw mechanical interfaces, Swiss print typography, tactical telemetry, and CRT terminal vibes | Declassified blueprint aesthetics, rigid grids, and monospace tabular telemetry |

---

### 2. 🖼️ AI Image Direction & Visual Assets
*Powered by `Leonxlnx/taste-skill` & Image-to-Code Pipelines*

| Command / Trigger | Use Case & When to Use | Key Output |
| :--- | :--- | :--- |
| `/brandkit` | Studio-grade brand-guidelines boards, logo systems, identity decks, and visual-world presentations | Cinematic brand presentation board with typography and logo mark |
| `/imagegen-frontend-web` | Generates section-by-section horizontal reference images for landing pages (1 section = 1 image) | High-fidelity visual reference images for frontends |
| `/imagegen-frontend-mobile` | Elite mobile app screen concepts (iOS/Android native mockups, onboarding, dashboards, settings) | Clean phone mockup-framed mobile app screen designs |
| `/image-to-code` | Image-first web development: generates design images first, inspects them, then translates directly into code | Pixel-faithful implementation matching generated art direction |

---

### 3. 🐛 Debugging, Code Review & Quality Assurance
*Powered by `mattpocock/skills`*

| Command / Trigger | Use Case & When to Use | Key Output |
| :--- | :--- | :--- |
| `/diagnosing-bugs` or *"diagnose this"* | Hard-to-trace bugs, performance slowdowns, memory leaks, or uncaught errors | Systematic root-cause isolation and verified minimal fix |
| `/code-review` or *"review my changes"* | Before merging a branch or commit; audits code against standards and requirements | Dual review report: Standards vs. Specification |
| `/tdd` or *"test-driven"* | Writing robust features with unit or integration tests (Red $\rightarrow$ Green $\rightarrow$ Refactor) | Test suites written and passing before implementation code |
| `/migrate-to-shoehorn` | Replacing unsafe `as` type assertions in test data fixtures | Clean test data fixtures using `@total-typescript/shoehorn` |
| `/full-output-enforcement` | Enforces 100% complete file output with zero placeholders (`// TODO`, `...`, omitted blocks) | Exhaustive, complete code files without truncation |

---

### 4. 🏗️ Architecture & Codebase Design
*Powered by `mattpocock/skills`*

| Command / Trigger | Use Case & When to Use | Key Output |
| :--- | :--- | :--- |
| `/codebase-design` | Designing deep modules, reducing interface surface area, and hiding internal complexity | Deep module boundaries and clean minimal APIs |
| `/domain-modeling` | Defining consistent domain terminology and business logic terms | Project `GLOSSARY.md` and Architectural Decision Records (ADRs) |
| `/improve-codebase-architecture` | Auditing large codebases for architectural debt, leakage, and refactoring seams | Visual HTML inspection report and remediation plan |
| `/setup-ts-deep-modules` | Enforcing module boundaries so private code is reachable only via entry points | `dependency-cruiser` configuration and boundary guards |
| `/prototype` or *"build prototype"* | Throwaway prototype to sanity-check UX or test state models quickly | Rapid sandbox demo before committing to full code |

---

### 5. 🎯 Planning, Specifications & Tickets
*Powered by `mattpocock/skills`*

| Command / Trigger | Use Case & When to Use | Key Output |
| :--- | :--- | :--- |
| `/to-spec` or *"make spec"* | Turning a discussion or feature requirements into an exact engineering spec | Technical specification document ready for tracking |
| `/to-tickets` | Breaking a big feature into modular tasks with dependency blockers | Ordered ticket list with explicit dependencies |
| `/wayfinder` | Managing huge multi-session initiatives across days or weeks | Shared dependency map of decision points |
| `/implement-spec` | Building code directly from a `/to-spec` document | Executed code strictly adhering to the written spec |
| `/implement` | Implementing a feature based on a specific ticket or prompt | Working code addressing the issue |
| `/triage` | Categorizing bug reports, verifying reproducibility, and drafting briefs | Triaged issue brief ready for development |

---

### 6. 🥊 Design Stress-Testing ("Grilling")
*Powered by `mattpocock/skills`*

| Command / Trigger | Use Case & When to Use | Key Output |
| :--- | :--- | :--- |
| `/grilling` or `/grill-me` | Interactive stress-test where the agent relentlessly interviews you on your design | Uncovers blind spots, edge cases, and missing logic |
| `/grill-with-docs` | Same as grilling, but simultaneously documents your decisions as ADRs and Glossary | Decision records + Glossary entries generated on the fly |
| `/loop-me` | Interactive interrogation about workflow specs you want to create | Concrete workflow definition |

---

### 7. 🛠️ Tooling, Git & CI Setup
*Powered by `mattpocock/skills`*

| Command / Trigger | Use Case & When to Use | Key Output |
| :--- | :--- | :--- |
| `/git-guardrails-claude-code` | Setting up hooks to block destructive commands (`push`, `reset --hard`, `clean`) | Git safety shell hooks |
| `/setup-pre-commit` | Adding Husky pre-commit hooks (Prettier, type check, lint-staged) | Configured `.husky/` and `lint-staged` rules |
| `/wizard` | Generating an interactive bash wizard for human-only steps (API keys, cloud dashboard setup) | Step-by-step interactive terminal guide |
| `/scaffold-exercises` | Generating structured exercise directories with solutions and explainers | Linted boilerplate directories |
| `/setup-matt-pocock-skills` | Scaffolds per-repo configuration for engineering skills (issue tracker, triage labels, domain docs) | Repo baseline config (`GLOSSARY.md`, ADR directories) |

---

### 8. ✍️ Technical Writing, Diagrams & Research
*Powered by `cathrynlavery/diagram-design` & `mattpocock/skills`*

| Command / Trigger | Use Case & When to Use | Key Output |
| :--- | :--- | :--- |
| `/diagram-design` | Generating branded architecture, flowcharts, sequence, ER/data models, UI wireframes, and data flowcharts as HTML/SVG/PNG, Mermaid, or Draw.io | Production-grade diagrams and architecture visualizations |
| `/research` | Deeply researching an API, framework documentation, or standard against primary sources | `research.md` finding document |
| `/writing-for-agents` | Crafting guidelines or instructions specifically for AI agents (`AGENTS.md`, `CLAUDE.md`, Skills) | High-precision agent instruction docs |
| `/writing-shape` | Structuring rough notes into a polished technical article | Paragraph-by-paragraph technical article |
| `/writing-beats` | Organizing complex writing so every concept is grounded before it's used | Step-by-step outline of beats |
| `/writing-fragments` | Extracting raw ideas and brainstorming fragments without structure | Freeform idea catalogue |
| `/to-questionnaire` | Turning ambiguous design questions into a survey for stakeholders | Clean questionnaire document |
| `/caveman` | Ultra-concise communication mode: no filler, no pleasantries, pure technical bullets & code diffs | Direct, high-density responses |

---

### 9. 🤝 Multi-Agent & Session Management
*Powered by `mattpocock/skills`*

| Command / Trigger | Use Case & When to Use | Key Output |
| :--- | :--- | :--- |
| `/ask-matt` | **Unsure which skill to use?** Ask this router to recommend the best skill for your task | Recommends the ideal skill and invocation |
| `/chief-of-staff` | Running a long-term goal that coordinates multiple sub-agents in a single turn | Orchestrated subagent plan and progress updates |
| `/handoff` | Compacting current session work into a handover doc for the next chat session | Handoff summary document |
| `/claude-handoff` | Passing work to a background sub-agent to continue immediately | Background agent spawn |
| `/retro` | Conducting a retrospective on a completed coding session | Retrospective log with lessons and action items |
| `/wait-what` | Telling the agent its last response missed the mark and needs re-pitching | Re-framed explanation |
| `/teach` | Explaining a complex coding concept within this workspace | Interactive lesson tailored to your repo |
| `/pr` | Drafting an official pull request title, description, and test summary | Standardized PR markdown description |

---

### 10. ⚡ Built-in IDE & Antigravity Guides
*Built into Antigravity IDE*

| Command / Trigger | Use Case & When to Use | Key Output |
| :--- | :--- | :--- |
| `/agy-customizations` | Reference and guide for creating new workspace skills, rules, plugins, hooks, and MCP servers | Customization architecture reference |
| `/antigravity-guide` | Complete manual for Google Antigravity, AGY CLI, slash commands, keybindings, and sidecars | Interactive platform reference |
| `/permissioned-github` | Workflow instructions for running permissioned GitHub operations securely | Authenticated git workflow actions |

---

## 📍 Skill Files Locations

All skill definition instructions are saved locally in:
- Workspace Customizations: [`c:\Users\User\Desktop\REACT PROJECTS\React js BootCamp\Shirio\.agents\skills`](file:///c:/Users/User/Desktop/REACT%20PROJECTS/React%20js%20BootCamp/Shirio/.agents/skills)
- Skills Lockfile: [`c:\Users\User\Desktop\REACT PROJECTS\React js BootCamp\Shirio\skills-lock.json`](file:///c:/Users/User/Desktop/REACT%20PROJECTS/React%20js%20BootCamp/Shirio/skills-lock.json)
