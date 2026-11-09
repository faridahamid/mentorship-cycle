# NASA Space Apps Cairo — Mentor Cycle Platform (2026)

> **Official Mentorship Scheduling & Command Center for NASA Space Apps Cairo**  
> *Note on Branding:* **NSAC** stands for the first letter of each word in **N**ASA **S**pace **A**pps **C**airo. All generated mentor email accounts use the `@nsac.com` domain.

---

## Table of Contents

1. [Platform Overview & Architecture](#platform-overview--architecture)
2. [Quick Start & Setup](#quick-start--setup)
3. [Section-by-Section Guide](#section-by-section-guide)
   - [1. Challenge Tracks / Categories](#1-challenge-tracks--categories-admincategories)
   - [2. Venue Stations & Physical Locations](#2-venue-stations--physical-locations-adminlocations)
   - [3. Mentors Hub & Automatic Credential Provisioning](#3-mentors-hub--automatic-credential-provisioning-adminmentors)
   - [4. Teams Hub & Dynamic Category Importer](#4-teams-hub--dynamic-category-importer-adminteams)
   - [5. Mentoring Cycles & Rotation Timetables](#5-mentoring-cycles--rotation-timetables-admincycles)
   - [6. The Distribution & Scheduling Engine](#6-the-distribution--scheduling-engine-legacy-modernized)
   - [7. Interactive Schedule Control Board](#7-interactive-schedule-control-board-admincyclesid)
   - [8. Real-time Analytics & Exposure Reports](#8-real-time-analytics--exposure-reports-admincyclesidanalytics)
   - [9. Mentor Portal & Self-Service Operations](#9-mentor-portal--self-service-operations-mentor)
   - [10. User Governance & Role Management](#10-user-governance--role-management-adminusers)
   - [11. Audit Logs & System Health](#11-audit-logs--system-health-adminaudit--adminsystem)
4. [Testing & Quality Verification](#testing--quality-verification)
5. [Database Migrations & Maintenance](#database-migrations--maintenance)

---

## Platform Overview & Architecture

**Mentor Cycle** is a high-performance, real-time command center designed to orchestrate hundreds of hackathon teams, dozens of specialized technical mentors, physical venue stations, and multi-round rotation schedules during NASA Space Apps Cairo.

### Technology Stack
- **Framework**: Next.js 16 (App Router, Turbopack, React 19)
- **Session Routing**: `src/proxy.ts` (Next.js 16 server-side session refresher & auth routing)
- **Database & Auth**: Supabase PostgreSQL with Row Level Security (RLS), atomic PL/pgSQL RPCs, and Realtime publications
- **Distribution Algorithm**: Multi-round Hungarian matching with spatial clustering and cyclic rotation shifts
- **Styling**: Tailwind CSS with custom NASA Space Apps deep-space theme
- **Testing**: Vitest with unit and scale test suites (28/28 tests passing)
- **Export Formats**: Native Excel (`xlsx`) and formatted PDF reports (`jspdf`, `jspdf-autotable`)

---

## Quick Start & Setup

### 1. Prerequisites
- Node.js $\ge 20$
- PostgreSQL connection string (Supabase)

### 2. Environment Configuration
Create a `.env.local` file in the root directory:
```env
NEXT_PUBLIC_SUPABASE_URL="https://your-project-ref.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="your-anon-key"
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
DATABASE_URL="postgresql://postgres.your-project-ref:your-password@aws-0-eu-west-1.pooler.supabase.com:5432/postgres"
```

### 3. Install & Run Migrations
```bash
npm install
npm run migrate
```

### 4. Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Section-by-Section Guide

### 1. Challenge Tracks / Categories (`/admin/categories`)

Challenge Tracks represent the technical domains of the hackathon (e.g. Earth Observation, Astrophysics, Space Medicine, AI/ML, Planetary Exploration, Robotics).

#### Key Capabilities:
- **Add / Edit Track**: Define track names and choose a color swatch from NASA presets or custom hex codes.
- **Dynamic Spreadsheet Import**:
  - Upload any spreadsheet (`.xlsx`, `.xls`, `.ods`, `.csv`, `.tsv`).
  - **Dynamic Column Mapping**: Map the track name column and optional color column.
  - **Auto-assigned Palette**: If a color column is unmapped or blank, vibrant NASA Space Apps palette colors are auto-assigned.
  - **Preview & Validation**: Displays duplicate detection (against existing database records and rows inside the file) before importing.
- **Template Download**: One-click download of a sample pre-formatted Excel template.
- **Data Export**: Export all tracks, color codes, and assigned mentor/team counts to Excel.

---

### 2. Venue Stations & Physical Locations (`/admin/locations`)

Physical stations define the geographic layout of the hackathon venue to minimize mentor walking distances.

#### Key Capabilities:
- **Location Hierarchy**:
  - **Building / Venue**: e.g., "Engineering Hall", "Main Campus Tower".
  - **Floor**: Numeric floor level (`1`, `2`, `3`).
  - **Section / Table / Room**: e.g., "Table 04", "Lab 102", "Zone A".
- **Dynamic Spreadsheet Import**:
  - Map Building, Floor (optional, defaults to 1), and Section columns dynamically from `.xlsx`, `.xls`, `.ods`, `.csv`, `.tsv`.
  - Pre-validates duplicate station entries and missing building names.
- **Hierarchical Spatial Distance Calculation**:
  - The scheduling engine uses `locationDistance` and `compareLocations` to cluster teams:
    $$\text{Same Section} < \text{Same Floor} < \text{Different Floor} < \text{Different Building}$$
- **Template & Export**: Download sample location spreadsheet or export existing venue stations.

---

### 3. Mentors Hub & Automatic Credential Provisioning (`/admin/mentors`)

The central directory for technical mentors. Supports single addition, direct account creation, dynamic multi-column bulk import, and automatic account generation.

#### Dynamic Spreadsheet Importer (.xlsx, .xls, .ods, .csv, .tsv) & Credential Generator:
- **Spreadsheet Flexibility**: Supports Excel and OpenDocument (`.ods`) files with any column order or naming.
- **Name Resolution Options**:
  - **Single Name Column**: Auto-strips honorifics/titles (`Dr.`, `Eng.`, `Prof.`, `Mr.`, `Ms.`) to identify first and last names.
  - **Split Name Columns**: Separate First Name and Last Name columns.
- **Automatic `@nsac.com` Email Generation**:
  - Automatically formats emails as `[first].[last]@nsac.com` or `[first]@nsac.com`.
  - Collision protection: appends numeric suffixes (`omar.tarek2@nsac.com`) if identical names exist.
  - Explanatory callout: Informs admins that **NSAC** stands for **NASA Space Apps Cairo**.
- **Automatic `[name]12345` Password Generation**:
  - Formats initial passwords as `[firstName]12345`.
  - Guarantees minimum 8 characters to meet Supabase Auth constraints (e.g., short names like `Ali` become `ali12345`).
- **Dynamic 1 to $N$ Specialty Columns**:
  - Add any number of specialty columns (Primary Track, Secondary Track, etc.).
  - Multi-delimiter parsing: parses `,`, `;`, `|`, `\n`, `•` while preserving track names like `AI/ML` and `UI/UX`.
- **Automatic Supabase Auth Provisioning**:
  - Server action `importMentors` automatically provisions authenticated users in Supabase Auth with `email_confirm: true`.
  - The PostgreSQL trigger `handle_new_user()` creates linked `profiles`, `mentors`, and `mentor_categories` records.
- **Credential Export**:
  - After import, admins can download the complete credentials roster (`.xlsx`) or copy all credentials to the clipboard.

---

### 4. Teams Hub & Dynamic Category Importer (`/admin/teams`)

Manages hackathon project teams and their challenge track categories.

#### Key Capabilities:
- **Dynamic Column Mapping**:
  - **Team Name Column**: Required.
  - **1 to $N$ Category Columns**: Map multiple category columns from your spreadsheet. Teams can have 1 or multiple categories.
  - **Station / Location Column**: Maps team venue station.
  - **Custom Metadata Columns**: Capture additional attributes (e.g. GitHub repo, Leader Phone, Discord tag).
- **Multi-delimiter Parsing**: Safely handles compound fields (`Earth Science; AI/ML`) without splitting composite tracks like `AI/ML`.
- **Duplicate & Missing Checks**: Highlights duplicate team names or unmapped categories in live preview.
- **Inline Category Creation**: If a team has a category not yet in the database, it is automatically registered with an assigned color theme.
- **Export Roster**: Export all teams, assigned tracks, locations, and metadata to Excel.

---

### 5. Mentoring Cycles & Rotation Timetables (`/admin/cycles`)

A Mentoring Cycle defines a hackathon time block (e.g. Day 1 Morning Session, Hackathon Mentoring Day 2).

#### Configuration Parameters:
- **Cycle Name**: e.g., "Cairo Hackathon Mentoring Block A".
- **Date Range**: Start date and end date.
- **Daily Operating Window**: Daily start time (e.g. `09:00`) and daily end time (e.g. `13:00`).
- **Rotation Session Duration**: Length of each rotation slot in minutes (e.g. `20` min or `90` min).
- **Daily Breaks**: Number of breaks per day (e.g. `1`) and duration in minutes (e.g. `15` min).
- **Slot Cap (Optional)**: Cap the total number of sessions across the day or auto-fill all hours.
- **Scheduling Mode**:
  - **Sequential**: One mentor per team per slot (standard rotation).
  - **Simultaneous**: Multiple mentors per team per slot (up to `max_simultaneous`, e.g. 2).
- **Teams Per Mentor Per Rotation (`max_teams_per_mentor`)**:
  - Sets the quota of teams a mentor visits in one rotation session (e.g. `3` to `5` teams).
  - When omitted, auto-computes dynamically as:
    $$\text{quota} = \left\lceil \frac{\text{Teams}}{\text{Mentors}} \right\rceil$$
- **Cycle Member Snapshots**: Freezes team names, mentor names, and tracks into `cycle_teams` and `cycle_mentors` so historical schedules survive future roster changes.

---

### 6. The Distribution & Scheduling Engine (Legacy Modernized)

The scheduling engine combines the legacy Google Apps Script distribution logic with modern multi-round Hungarian optimization.

#### Core Algorithmic Principles:
1. **Dynamic Quota Allocation**:
   In each rotation slot, a mentor can hold multiple teams up to the rotation quota:
   $$\text{quota} = \min\left(\text{maxTeamsPerMentor}, \left\lceil \frac{T_{\text{avail}}}{M_{\text{avail}}} \right\rceil\right)$$
2. **Hierarchical Physical Clustering**:
   Teams within a category are ordered hierarchically:
   $$\text{Building} \longrightarrow \text{Floor} \longrightarrow \text{Section / Room}$$
   - When a mentor is assigned their initial team, it is chosen closest to their home station.
   - For every subsequent team assigned to that mentor in the same rotation slot, the engine penalizes spatial distance to the mentor's already-assigned teams in that slot.
   - **Result**: All teams a mentor visits during a rotation are clustered in the **same room, hall, or floor**.
3. **Exact Specialty Track Matching**:
   A mentor is only paired with teams sharing their technical category (`isEligible`).
4. **Cyclic Rotation Across Rotations**:
   Mentors shift cyclically across slots ($r \pmod N$ shift and repeat pairing penalties), ensuring that:
   - In Rotation 1: Mentor A visits Cluster 1; Mentor B visits Cluster 2.
   - In Rotation 2: Mentor A rotates to Cluster 2; Mentor B rotates to Cluster 1.
   - Teams meet different mentors throughout the cycle without mentors having to run across different buildings during a single session.
5. **Multi-category Balancing & Hungarian Fallback**:
   Teams with multiple tracks (e.g. Earth Science + AI/ML) get balanced exposure across their domains. Any leftover capacities are solved with Hungarian min-cost matching.

---

### 7. Interactive Schedule Control Board (`/admin/cycles/[id]`)

The command center for live schedule management during the event.

#### Features:
- **Matrix Views**:
  - View by **Mentor** (Mentors on rows $\times$ Slots on columns).
  - View by **Team** (Teams on rows $\times$ Slots on columns).
  - Filter by Category, Location, or Search query.
- **Multiple Team Pills per Cell**: Mentors with multiple teams in a rotation display all assigned team chips neatly within the cell.
- **Drag-and-Drop & Cell Modal**:
  - Drag and drop assignments between cells to resolve manual adjustments.
  - Click any cell to view assigned teams, add new teams, or remove assignments.
- **Manual Assignment Locking**: Lock specific mentor-team pairings; locked pairings are preserved when regenerating schedules.
- **Availability Drawer**:
  - Quickly mark mentors or teams as **Absent** or **On Break** for specific slots.
  - The engine automatically reallocates affected teams to other available mentors.
- **Realtime Sync**: Subscribed to Supabase Realtime; when any admin or mentor changes availability, the board refreshes automatically.
- **Atomic Transactional Commit**: Uses PostgreSQL RPC `commit_change` to validate against overbooking and commit assignment diffs atomically.
- **Exporting**:
  - Export Schedule Matrix to Excel (`.xlsx`).
  - Export High-Resolution PDF schedule for printouts or venue display.

---

### 8. Real-time Analytics & Exposure Reports (`/admin/cycles/[id]/analytics`)

Live metrics to monitor hackathon fairness, mentor workload balance, and coverage quality.

#### Metrics Tracked:
- **Schedule Completion %**: Assigned mentor-slot cells vs. available capacity.
- **Mentor Exposure %**: Average percentage of eligible mentors that teams have met.
- **Workload Spread**: The difference between the busiest mentor and the least-busy mentor.
- **Mentor Load Table**: Sessions conducted, unique teams met, absent slots, break slots, and attendance rate.
- **Team Coverage Table**: Number of unique mentors met vs. eligible mentors in the track.
- **Category Coverage Matrix**: Percentage of teams served per challenge track.
- **Diagnostic Issues Panel**: Immediate alerts for unassigned teams, category mismatch, or availability conflicts.

---

### 9. Mentor Portal & Self-Service Operations (`/mentor`)

A dedicated mobile-responsive portal for mentors on the hackathon floor.

#### Features:
- **Personalized Rotation Agenda**: Mentors see their exact schedule for each rotation:
  - Time slot and countdown.
  - Assigned teams, project categories, and physical table/station locations.
- **Self-Service Availability Toggle**:
  - Mentors can report an upcoming break or temporary absence.
  - Submitting an absence notifies the admin control room and rebalances the schedule.

---

### 10. User Governance & Role Management (`/admin/users`)

Super-admin governance for platform security and access control.

#### Role Hierarchy:
| Role | Capabilities |
| :--- | :--- |
| `super_admin` | Full system control: user role assignment, account deletion, password resets, database audit log pruning, cycle deletion. |
| `admin` | Event operations: manage teams, mentors, locations, categories, cycles, manual schedule overrides, and Excel imports. |
| `mentor` | View personal rotation schedule, team station locations, and request temporary breaks. |

---

### 11. Audit Logs & System Health (`/admin/audit` & `/admin/system`)

- **Audit Trail (`/admin/audit`)**: Immutable log of every action taken in the system (e.g. `team:import`, `mentor:import`, `schedule:regenerate`, `account:create`) with timestamp, actor email, and JSON metadata.
- **Pruning**: Super admins can prune logs older than $N$ days to conserve storage.
- **System Health (`/admin/system`)**: Displays database byte usage, table row counts, and health against Supabase free-tier limits.

---

## Testing & Quality Verification

The test suite covers algorithmic correctness, spatial clustering, credential generation, multi-column parsing, and large-scale execution:

```bash
# Run all unit and integration tests
npx vitest run

# Run TypeScript typecheck
npx tsc --noEmit

# Run ESLint
npm run lint

# Run Next.js production build
npm run build
```

### Test Coverage Highlights:
- **Hungarian Bipartite Matching**: Verifies min-cost rectangular matching.
- **Multi-team Rotational Proximity**: Verifies that mentors in multi-team slots get teams clustered in the same building/floor, and shift cyclically across slots.
- **Credential Generation**: Verifies `@nsac.com` formatting, collision suffixing (`user2@nsac.com`), academic title stripping, and 8-character password constraints.
- **Category Extraction**: Verifies 1 to $N$ column extraction with composite delimiters (`AI/ML`, `UI/UX`).
- **Scale Stress Test**: Verifies solving 60 mentors, 150 teams, and 30 slots in $< 1$ second.

---

## Database Migrations & Maintenance

Database migrations are stored in `supabase/migrations/`:
- `0001_schema.sql`: Core relational tables, RLS policies, indexes.
- `0002_rpcs.sql`: Transactional RPCs (`commit_change`, `assert_no_overbooking`, `usage_stats`, `prune_audit_logs`).
- `0003_multi_team_rotations.sql`: Upgrades `assignments` unique constraint to `UNIQUE (slot_id, cycle_mentor_id, cycle_team_id)` to enable multi-team rotation clusters per mentor.

Run all migrations against the database with:
```bash
npm run migrate
```
Or run a specific file:
```bash
npm run migrate --file supabase/migrations/0003_multi_team_rotations.sql
```

---

*Built with precision for NASA Space Apps Cairo 2026.*
