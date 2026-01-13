# TypeComp

TypeComp is a TypeScript library for managing World Cube Association (WCA) competition scheduling and group assignments. It provides a fluent builder API for creating groups, assigning competitors, and managing staff roles.

Inspired by [CompScript](https://github.com/cubingusa/compscript).
This project was largely implemented by AI Agents as it might only be used for a single competition (DublinPickNMix2026), so the quality of the library cannot be guarenteed

## Installation

Requires [Bun](https://bun.sh) v1.0.0 or later.

```bash
bun install
```

## Authentication

TypeComp uses OAuth to interact with the WCA API. You'll need to set up credentials before fetching or pushing competition data.

### 1. Create an OAuth Application

1. Go to [WCA OAuth Applications](https://www.worldcubeassociation.org/oauth/applications)
2. Create a new application with redirect URI: `http://localhost:3030/auth/oauth_response`
3. Note your **Client ID** and **Client Secret**

### 2. Configure Environment

Create a `.env` file in the project root:

```bash
WCA_CLIENT=your_client_id
WCA_SECRET=your_client_secret
```

Optional settings:
- `WCA_API` - API base URL (default: `https://www.worldcubeassociation.org`)
- `PORT` - OAuth callback port (default: `3030`)

### 3. Login

```bash
bun run login
```

This opens the WCA OAuth page. After authorizing, tokens are saved to `.typecomp/`.

## Quick Start

```typescript
import { createTypeComp, competingIn, canScramble } from 'typecomp';

const tc = await createTypeComp('YourCompetition2026');

// Create groups for a round
tc.round('333-r1')
  .createGroups(4, {
    room: 'Main Hall',
    from: '2026-01-17T10:00:00',
    to: '2026-01-17T11:00:00',
  })
  .competitors(competingIn('333'))
  .maxGroupSize(20)
  .groupBy.sameCountry(4)
  .differentNames(-5)
  .done()
  .stations.bySpeed('333', 'average')
  .done()
  .assign();

// Assign staff
tc.staff('333-r1')
  .from(competingIn('333'))
  .judges(12)
  .scramblers(4, canScramble('333'))
  .runners(2)
  .overwrite(true)
  .assign();

// Save changes
await tc.commit();
```

## Command Line Options

When running scripts, TypeComp supports these flags:

| Flag | Description |
|------|-------------|
| `--commit`, `-c` | Push changes to WCA (default: dry-run, saves locally only) |
| `--no-local-cache` | Fetch fresh WCIF from WCA API instead of using local cache |
| `--verbose`, `-v` | Enable verbose logging |
| `--clean` | Remove all assignments, groups (childActivities), and custom extensions from WCIF |

```bash
# Dry run (saves locally only)
bun run scripts/examples/basic.ts

# Push changes to WCA
bun run scripts/examples/basic.ts --commit

# Fetch fresh data
bun run scripts/examples/basic.ts --no-local-cache
```

## API Reference

### Creating a TypeComp Instance

```typescript
const tc = await createTypeComp('CompetitionId');

// Access competition data
tc.competition          // Full WCIF competition object
tc.id                   // Competition ID
tc.dryRun               // Whether running in dry-run mode

// Query people
tc.persons.registered() // All registered competitors
tc.persons.all()        // All persons (including non-competing)
tc.persons.filter(fn)   // Filter by predicate
tc.persons.byWcaId(id)  // Find by WCA ID
tc.persons.count()      // Count people
```

### Round Builder

Create groups and assign competitors to a round:

```typescript
tc.round('333-r1')
  .createGroups(count, options)   // Create N groups
  .competitors(filter)            // Who to assign
  .maxGroupSize(size)             // Cap per group
  .groupBy                        // Configure grouping preferences
  .stations                       // Configure station assignment
  .assign()                       // Execute assignment
```

#### Group Options

```typescript
.createGroups(4, {
  room: 'Main Hall',           // Room name (optional if round exists in schedule)
  from: '2026-01-17T10:00:00', // Start time (optional)
  to: '2026-01-17T11:00:00',   // End time (optional)
})
```

#### Grouping Preferences

Scoring functions determine how competitors are grouped. Positive scores encourage assignment, negative scores discourage it.

```typescript
.groupBy
  .sameCountry(score, limit?)     // Group people from same country
  .differentNames(penalty)        // Penalize same first names
  .matching(valueFn, score)       // Group by matching values
  .when(personFilter, groupFilter, score)  // Conditional scoring
  .custom(scorer)                 // Custom scorer function
  .done()
```

#### Station Assignment

Assign station numbers within groups:

```typescript
.stations
  .bySpeed(eventId, 'single' | 'average', 'ascending' | 'descending')
  .by(scoreFn, order)             // Custom ordering
  .none()                         // Disable stations
  .done()
```

### Staff Builder

Assign staff to groups:

```typescript
tc.staff('333-r1')
  .from(filter)                   // Pool of eligible staff
  .groups(groupFilter)            // Which groups to staff
  .judges(count, options?)        // Number of judges
  .scramblers(count, eligibility?) // Scramblers (with optional filter)
  .runners(count)                 // Runners
  .dataEntry(count)               // Data entry
  .job(name, count, options?)     // Custom job type
  .preferFastScramblers()         // Prefer faster scramblers
  .scorer(staffScorer)            // Custom scoring
  .overwrite(replace?)            // Replace existing assignments
  .avoidConflicts(avoid?)         // Skip if person is competing
  .assign()
```

### Filters

Filter functions for selecting people and groups:

```typescript
// Competition-based
competingIn('333')           // Registered for event
competingInAny('333', '222') // Registered for any
competingInAll('333', 'pyram') // Registered for all
notCompetingIn('333')        // Not registered for event

// Personal bests
hasPB('333', 'average')      // Has a PB
pbFasterThan('333', 1000)    // PB under 10 seconds (in centiseconds)
pbSlowerThan('333', 3000)    // PB over 30 seconds
canScramble('333')           // Can scramble this event

// Demographics
fromCountry('IE')            // From specific country
fromCountries('IE', 'GB')    // From any of these countries
newcomer                     // No WCA ID
hasWcaId                     // Has WCA ID
gender('f')                  // Gender filter

// Roles
isDelegate                   // Is a delegate
isOrganizer                  // Is an organizer
hasRole('staff-judge')       // Has specific role

// Combining filters
and(filter1, filter2)        // Both must match
or(filter1, filter2)         // Either must match
not(filter)                  // Invert filter
```

### Custom Scorers

Create custom scoring functions for group assignment:

```typescript
import type { Scorer, Person, Group } from 'typecomp';

const myScorer: Scorer = {
  getScore(person: Person, group: Group, otherPeople: Person[]): number {
    // Return positive to encourage assignment
    // Return negative to discourage
    // Return 0 for neutral
    return someCalculation;
  }
};

tc.round('333-r1')
  .groupBy.custom(myScorer)
  // ...
```

### Saving Changes

```typescript
// Save locally only (always happens)
await tc.save();

// Save locally and push to WCA if --commit flag was used
await tc.commit();
```

## Examples

See the `scripts/examples/` directory:

- `basic.ts` - Simple group and staff assignment
- `custom-scorers.ts` - Custom scoring functions
- `wave-optimization.ts` - Parallel event scheduling
- `availability-assignment.ts` - Handling availability constraints

Run an example:

```bash
bun run scripts/examples/basic.ts
```

## Development

```bash
# Type checking
bun run typecheck

# Linting
bun run lint
bun run lint:fix

# Formatting
bun run format

# Run tests
bun test
```

## Project Structure

```
typecomp/
├── engine/         # Core WCIF loading/saving and authentication
├── lib/
│   ├── api/        # Main API (TypeComp, builders, filters, scorers)
│   ├── functions/  # Helper functions for WCIF manipulation
│   ├── solvers/    # Linear programming solvers for optimization
│   ├── types/      # TypeScript types
│   └── utils/      # Utilities
└── scripts/        # Example and competition-specific scripts
```

## License

MIT
