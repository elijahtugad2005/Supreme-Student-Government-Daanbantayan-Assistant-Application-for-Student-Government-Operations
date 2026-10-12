`# ⚡ Agent Skills Quick Reference & Command Palette Guide

This guide lists all **38 installed agent skills**, categorized by workflow, with trigger phrases, use cases, and shortcut keys.

---

## ⌨️ Shortcut Keys to Access Skills in the IDE

| Action | Windows Shortcut | What it Does |
| :--- | :--- | :--- |
| **Open Command Palette** | <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>P</kbd> | Search all IDE actions, skills, and tools |
| **Focus Chat Input** | <kbd>Ctrl</kbd> + <kbd>L</kbd> | Jump cursor straight into chat to type a skill command |
| **Trigger Slash Commands** | Type `/` in chat | Brings up the live auto-complete list of available skills |
| **Quick File Switcher** | <kbd>Ctrl</kbd> + <kbd>P</kbd> | Quickly open any skill instruction file (`SKILL.md`) |

---

## 🎯 Categorized Skill Reference

### 1. 🐛 Debugging & Code Review
| Command / Trigger | Use Case & When to Use | Key Output |
| :--- | :--- | :--- |
| `/diagnosing-bugs` or *"diagnose this"* | Hard-to-trace bugs, performance slowdowns, or uncaught server/browser errors | Systematic root-cause isolation and minimal fix |
| `/code-review` or *"review my changes"* | Before merging a branch or commit; audits code against standards & spec | Dual review report: Standards vs. Specification |
| `/tdd` or *"test-driven"* | Writing robust features with unit or integration tests (Red $\rightarrow$ Green $\rightarrow$ Refactor) | Test suites written before implementation code |
| `/migrate-to-shoehorn` | Replacing unsafe `as` type assertions in test data fixtures | Clean test data using `@total-typescript/shoehorn` |

---

### 2. 🏗️ Architecture & Codebase Design
| Command / Trigger | Use Case & When to Use | Key Output |
| :--- | :--- | :--- |
| `/codebase-design` | Designing deep modules, reducing interface surface area, and hiding complexity | Deep module boundaries and clean APIs |
| `/domain-modeling` | Defining consistent domain terminology and business logic terms | Project `GLOSSARY.md` and Architectural Decision Records (ADRs) |
| `/improve-codebase-architecture` | Auditing large codebases for architectural debt and refactoring seams | Visual HTML inspection report and remediation plan |
| `/setup-ts-deep-modules` | Enforcing module boundaries so private code is reachable only via entry points | `dependency-cruiser` configuration and boundary guards |
| `/prototype` or *"build prototype"* | Throwaway prototype to sanity-check UX or test state models quickly | Rapid sandbox demo before committing to full code |

---

### 3. 🎯 Planning, Specifications & Tickets
| Command / Trigger | Use Case & When to Use | Key Output |
| :--- | :--- | :--- |
| `/to-spec` or *"make spec"* | Turning a discussion or requirements into an exact engineering spec | Technical specification document ready for tracking |
| `/to-tickets` | Breaking a big feature into modular tasks with dependency blockers | Ordered ticket list with explicit dependencies |
| `/wayfinder` | Managing huge multi-session initiatives across days or weeks | Shared dependency map of decision points |
| `/implement-spec` | Building code directly from a `/to-spec` document | Executed code strictly adhering to the written spec |
| `/implement` | Implementing a feature based on a specific ticket or prompt | Working code addressing the issue |
| `/triage` | Categorizing bug reports, verifying reproducibility, and drafting briefs | Triaged issue brief ready for development |

---

### 4. 🥊 Design Stress-Testing ("Grilling")
| Command / Trigger | Use Case & When to Use | Key Output |
| :--- | :--- | :--- |
| `/grill-me` | Interactive stress-test where the agent relentlessly interviews you on your design | Uncovers blind spots, edge cases, and missing logic |
| `/grill-with-docs` | Same as grilling, but simultaneously documents your decisions as ADRs and Glossary | Decision records + Glossary entries generated on the fly |
| `/loop-me` | Interactive interrogation about workflow specs you want to create | Concrete workflow definition |

---

### 5. 🛠️ Tooling, Git & CI Setup
| Command / Trigger | Use Case & When to Use | Key Output |
| :--- | :--- | :--- |
| `/git-guardrails-claude-code` | Setting up hooks to block destructive commands (`push`, `reset --hard`, `clean`) | Git safety shell hooks |
| `/setup-pre-commit` | Adding Husky pre-commit hooks (Prettier, type check, lint-staged) | Configured `.husky/` and `lint-staged` rules |
| `/wizard` | Generating an interactive bash wizard for human-only steps (API keys, cloud dashboard setup) | Step-by-step interactive terminal guide |
| `/scaffold-exercises` | Generating structured exercise directories with solutions and explainers | Linted boilerplate directories |

---

### 6. ✍️ Technical Writing & Research
| Command / Trigger | Use Case & When to Use | Key Output |
| :--- | :--- | :--- |
| `/research` | Deeply researching an API, framework documentation, or standard against primary sources | `research.md` finding document |
| `/writing-for-agents` | Crafting guidelines or instructions specifically for AI agents (`AGENTS.md`, `CLAUDE.md`, Skills) | High-precision agent instruction docs |
| `/writing-shape` | Structuring rough notes into a polished technical article | Paragraph-by-paragraph technical article |
| `/writing-beats` | Organizing complex writing so every concept is grounded before it's used | Step-by-step outline of beats |
| `/writing-fragments` | Extracting raw ideas and brainstorming fragments without structure | Freeform idea catalogue |
| `/to-questionnaire` | Turning ambiguous design questions into a survey for stakeholders | Clean questionnaire document |
| `/diagram-design` | Generating branded architecture, flowcharts, sequence diagrams, ER/data models, UI wireframes, and data flowcharts as HTML/SVG/PNG, Mermaid, or Draw.io | Production-grade diagrams and architecture visualizations |
| `/caveman` | Ultra-concise communication mode: no filler, no pleasantries, pure technical bullets & code diffs | Direct, high-density responses |

---

### 7. 🤝 Multi-Agent & Session Management
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

## 📍 Skill Files Location
All skill definition instructions are saved in:
[`c:\Users\User\Desktop\REACT PROJECTS\React js BootCamp\Shirio\.agents\skills`](file:///c:/Users/User/Desktop/REACT%20PROJECTS/React%20js%20BootCamp/Shirio/.agents/skills)
