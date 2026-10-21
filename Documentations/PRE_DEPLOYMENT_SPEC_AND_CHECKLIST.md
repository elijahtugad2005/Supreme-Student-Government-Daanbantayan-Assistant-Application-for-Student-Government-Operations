# Pre-Deployment System Specification & Verification Checklist

## Problem Statement

As the Supreme Student Government (SSG) system expands to handle real-world operations across university campuses (CTU Daanbantayan), unstandardized access control, unverified role capabilities, and client-side performance regressions (such as table scroll jank) threaten operational reliability and security during official deployment. 

Officers and stakeholders require a predictable, documented, and hardened access model with role-based presets, zero unverified actions, and high-performance client rendering before promoting the codebase to production.

---

## Solution

A consolidated operational specification and pre-deployment verification checklist that codifies:
1. **Three-Tier Access Architecture**: Higher Access (Full CRUD), Medium Access (Add/Edit/Update without Delete), and Low/Specialized Access (View-Only or domain-restricted).
2. **Administrative Role Presets**: Clear departmental presets for Executive Leadership (President, VP), Secretariat, Treasury & Audit, Legislative Body (Senators, Representatives), and Creative Unit.
3. **Client-Side Scroll & UI Hardening**: Hardware composite acceleration, row-level DOM containment, subcomponent memoization, and interactive KPI filters.
4. **Pre-Flight Environment Verification**: Explicit checks for backend secrets, dual-storage failover, and build integrity.

---

## User Stories

1. As an **Administrator or President**, I want general access across all sidebar modules, so that I can oversee, edit, update, and manage all student government operations.
2. As an **Administrator or President**, I want delete privileges across all collections, so that I can prune obsolete or erroneous entries from the system.
3. As a **Vice President**, I want Higher Access to Documents, Inventory, Finance, Audit Trail, and Commerce Hub, so that I can manage primary executive operations without touching user role configurations.
4. As an **Executive Secretary**, I want Higher Access to Documents, Inventory, and Sections & Contributions, so that I can coordinate official student records, class rosters, and equipment without requiring developer intervention.
5. As a **Press Secretary**, I want Higher Access to Documents, Inventory, Sections, and Announcements, so that I can publish institutional communications and archive documentation.
6. As a **Finance Secretary, Auditor, or Budget Officer**, I want Higher Access to Finance, Inventory, Documents, Commerce Hub, and the Audit Trail, so that I can verify fiscal transactions, balance sheets, and asset purchases.
7. As an **Auditor**, I want read and write access to the Audit Trail and financial registers, so that I can detect discrepancies and enforce accountability.
8. As a **Senator or Representative**, I want Medium Access to Documents, Inventory, Sections, Announcements, and Commerce Hub, so that I can create and update items and assist students with orders.
9. As a **Senator or Representative**, I want permanent deletion disabled on my account, so that critical institutional records cannot be accidentally or maliciously destroyed.
10. As a **Creative Department Member**, I want specialized access restricted to Announcements and creative asset management, so that our team can post updates without exposure to confidential financial or student records.
11. As a **Student Member**, I want view access and the ability to place merchandise/uniform orders, so that I can participate in campus commerce safely.
12. As an **Anonymous Class Mayor or Guest**, I want to submit class rosters and death aid collection records without forced authentication, so that submissions are never bottlenecked by account setup.
13. As an **Inventory Officer**, I want smooth 60fps scrolling when browsing large inventory tables, so that my browser does not stutter or freeze.
14. As an **Inventory Officer**, I want to click the "Low Stock Alerts" metric card to instantly filter the asset table, so that I can immediately identify items requiring restocking.
15. As a **System Administrator**, I want a structured pre-deployment checklist, so that I can verify environmental secrets and database rules before launching.

---

## Implementation Decisions

### Access Tiers & Capability Contracts
- **Higher Access Tier**: Granted `canCreate`, `canRead`, `canUpdate`, and `canDelete`. Assigned to President, Vice President, Secretariat, and Treasury/Audit.
- **Medium Access Tier**: Granted `canCreate`, `canRead`, and `canUpdate`, but `canDelete` is strictly denied. Assigned to Senators and Representatives.
- **Specialized Access Tier**: Scoped exclusively to Announcements and Creative media. Assigned to the Creative Department.
- **Low Access Tier**: Read-only telemetry and public self-service actions. Assigned to Members and Guests.

### Centralized Role Authority
- All route permissions and action checks delegate to a single source of truth in the permissions engine.
- Navigation items in the sidebar dynamically calculate visibility using role membership and permission grants simultaneously.
- UI elements that perform destructive mutations (e.g. Delete Asset, Remove Document) check both global permission overrides and role access tiers before rendering.

### Performance & Client Rendering
- High-cost CSS rasterization effects (e.g., recursive backdrop blurs on active scroll containers) are removed in favor of opaque surfaces and GPU composite layer promotion (`transform: translateZ(0)`).
- Table rows implement CSS layout and style containment (`content-visibility: auto; contain: layout style; contain-intrinsic-size: 0 54px`), ensuring off-screen rows do not consume layout calculations.
- Table rows are memoized into distinct subcomponents with stable callback references to eliminate cascading re-renders during search or filter typing.

---

## Testing Decisions

### What Makes a Good Test
- Tests must verify observable user behavior and security barriers (e.g., verifying that a Senator cannot see or trigger a delete action; verifying that an unauthenticated user cannot navigate to `/admin`).
- Tests must not couple to internal implementation details like local state names or private helper methods.

### Target Test Scenarios
1. **Permission Guard Seam:**
   - Execute route authorization tests verifying that each preset role can only navigate to their specified whitelist routes.
   - Verify that toggling a per-user permission override takes immediate precedence over the default role preset.
2. **Action Guard Seam:**
   - Verify that calling the delete resource handler with a `senator` or `representative` context rejects the request.
   - Verify that an `auditor` or `vice_president` context successfully processes resource updates and deletions.
3. **UI Rendering Seam:**
   - Assert that `InventoryManagement` renders the Delete button only when `canDelete` is true.
   - Assert that clicking the "Low Stock Alerts" card updates the active stock filter and displays filtered rows.

---

## Pre-Deployment Verification Checklist

```markdown
### 1. Build & Bundle Integrity
- [x] Production build passes cleanly with zero errors (`vite build` exit code 0).
- [x] All 2,400+ modules transform successfully.
- [x] Static asset font files and CSS modules bundle without broken references.

### 2. Access Control & Security
- [x] Role presets configured for all administrative branches:
  - [x] Executive Council (President, Vice President)
  - [x] Secretariat (Executive, Press, Linkages, Deputy)
  - [x] Treasury & Audit (Finance Secretary, Auditor, Budget Officer)
  - [x] Legislative Body (Senators, Representatives)
  - [x] Creative Department
- [x] Destructive deletion actions restricted to Higher Access roles.
- [x] User Management UI categorizes role options using administrative `<optgroup>` groupings.
- [x] Sidebar navigation correctly filters visible sections per active role.

### 3. Client Performance
- [x] Backdrop blur removed from scrollable inventory and data tables.
- [x] CSS `content-visibility: auto` active on table row rendering.
- [x] Table rows memoized to prevent cascading re-renders on keystroke inputs.
- [x] Interactive KPI metric cards respond to keyboard and mouse interactions.

### 4. Environmental & Service Configuration (Prior to Hosting Push)
- [ ] Backend `.env` configuration contains production MongoDB connection string (`MONGODB_URI`).
- [ ] Firebase service account credentials (`firebase-service-account.json`) present on backend runtime.
- [ ] Production Firestore security rules updated to acknowledge new role claims (`president`, `vice_president`, `auditor`, etc.).
- [ ] Dual-storage fallback verified for document upload and analysis services.
```

---

## Out of Scope

- Automated user migration scripts for legacy test accounts created prior to the preset standardization (existing accounts can be updated via the User Management panel).
- Native iOS/Android shell wrapping (this spec targets the responsive PWA and desktop web dashboard).
- Third-party payment gateway integration for Commerce Hub (current scope covers requisition tracking and order status handling).

---

## Further Notes

- The complete bundle was compiled and verified locally (`dist/index.html` generated, exit code 0).
- All changes are committed to local Git under commit `748f189`.
- Proceed with `git push origin main` once the cloud environment credentials listed in step 4 are confirmed.
