# TypeComp
---

TypeComp is a TypeScript library for managing World Cube Association competition scheduling and group assignments. It is heavily inspired by [CompScript](https://github.com/cubingusa/compscript) which is a far more tried and tested utility.

## Getting Started

You will need Bun and Python installed.

```bash
bun install

pip install ortools
```

### Authentication

Before using TypeComp, you need to set up OAuth authentication with the WCA API.

#### 1. Create an OAuth Application

1. Go to [WCA OAuth Applications](https://www.worldcubeassociation.org/oauth/applications)
2. Create a new OAuth application
3. Set the redirect URI to: `http://localhost:3030/auth/oauth_response` (or adjust based on your `PORT`, `SCHEME`, and `HOST` settings)
4. Note your **Client ID** and **Client Secret**

#### 2. Configure Environment Variables

Create a `.env` file in the project root with:

```bash
WCA_CLIENT=your_client_id_here
WCA_SECRET=your_client_secret_here
```

Optional environment variables (with defaults):
- `WCA_API` - WCA API base URL (default: `https://www.worldcubeassociation.org`)
- `PORT` - OAuth callback port (default: `3030`)
- `SCHEME` - OAuth callback scheme (default: `http`)
- `HOST` - OAuth callback host (default: `localhost`)

#### 3. Login

Run the login command:

```bash
bun run login
```

This will open the WCA's OAuth page in a browser. After authorizing, the tokens will be saved in the `.typecomp` folder.

## Core Concepts

TypeComp uses the competition's WCIF. This will be downloaded and cached locally (including changes). When running TypeComp scripts, you can use the following command-line arguments:

- `--commit` or `-c` - Commits changes to the WCA. By default, TypeComp runs in dry-run mode and only saves changes locally. Use this flag to push changes to the WCA API.
- `--no-local-cache` - Bypasses the local cache and fetches fresh WCIF data from the WCA API. Useful when you need to ensure you're working with the latest/clean data.
- `--verbose` or `-v` - Enables verbose logging, providing additional information about what TypeComp is doing (e.g., which cache file is being used).

Here is an example of how to run a script

```bash
bun run scripts/examples/basic.ts --no-local-cache
```

## Basic Usage

Typically scripts are put in a competition specific subfolder of the `scripts` directory.

### Creating a Competition Context

```typescript
import { createTypeComp } from '@/lib/api';

const tc = await createTypeComp('CompetitionId');
```

### Creating Groups and Assigning Competitors

The core API uses a builder pattern, most of which can be chained together:

```typescript
const round = tc
  .round('333-r1')  // Event and round ID
  .createGroups(4, {  // Number of groups
    room: 'Ballroom',
    from: '2026-01-17T14:15:00',
    to: '2026-01-17T15:00:00',
  })
  .competitors(competingIn('333'))  // Filter competitors
  .maxGroupSize(25);

// Configure grouping preferences
round.groupBy.sameCountry(4);  // Prefer grouping by country
round.groupBy.differentNames(-5);  // Penalize same names

// Assign competitors to groups
const result = round.assign();
```

### Custom Scoring

For round grouping, scoring functions are used to find the assignments that **maximise the total score** across all competitors and groups. Multiple scoring functions are combined by summing their scores together.

You can create custom scoring functions to create additional items to be factored into assignments:

```typescript
round.groupBy.custom({
  getScore(person: Person, group: Group, otherPeople: Person[]): number {
    // Positive scores makes it more likely to be assigned
    // Negative scores try to prevent it being assigned
    return someScore;
  }
});
```

### Station Assignment

Assign stations within groups (e.g., by speed):

```typescript
round.stations.by(
  (person) => person.personalBests?.['333']?.best || Infinity,
  'ascending'  // Fastest first
);

round.stations.bySpeed('333', 'best', 'ascending'); // essentially the same
```

### Staff Assignment

Assign staff to groups:

```typescript
const staffResult = tc
  .staff('333-r1')
  .judges(18)
  .scramblers(4)
  .runners(2)
  .assign();
```

### Committing Changes

After making assignments, commit them to the WCA:

```typescript
await tc.commit();
```

## Key Features

### Filters

TypeComp provides a rich set of filters for selecting competitors and groups:

- `competingIn(eventId)` - Competitors registered for an event
- `fromCountry(country)` - Competitors from a specific country
- `hasPB(eventId)` - Competitors with a personal best
- `pbFasterThan(eventId, time)` - Competitors faster than a time
- `newcomer()` - First-time competitors
- `isDelegate()`, `isOrganizer()` - Staff roles

Filters can be combined with `and()`, `or()`, and `not()`.

### Presets

For common scenarios, TypeComp provides preset functions:

- `quickAssign()` - Quick assignment for small competitions
- `assignRound()` - Standard round assignment with balanced groups
- `assignLaterRound()` - Assignment for subsequent rounds based on results
- `assignBlindfolded()` - Special handling for blindfolded events
- `assignWaveStaff()` - Staff assignment for parallel wave scheduling

### Parallel Wave Scheduling

For competitions with multiple events running simultaneously:

```typescript
// For this just look at the DublinPickNMix2026 code
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
```

## License

MIT

