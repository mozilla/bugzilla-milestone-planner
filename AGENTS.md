# Repository Guidelines

## Project Structure & Module Organization
- `index.html` is the entry point and wires in the client app.
- `js/` holds the application modules (API client, scheduler, UI controller, Gantt renderer, worker).
- `css/` contains styling assets.
- `data/` stores static JSON configuration like `data/engineers.json`.
- `test/unit/` contains Vitest unit tests (`*.test.js`).
- `test/e2e/` contains Playwright specs (`*.spec.js`).
- `test/fixtures/` stores synthetic and snapshot data used by tests.
- `scripts/` includes helper utilities like snapshot capture.

## Build, Test, and Development Commands
- `npm run serve` starts a local static server on port `8080` for manual testing.
- `npm test` runs the Vitest unit suite once.
- `npm run test:watch` runs Vitest in watch mode.
- `npm run test:coverage` runs unit tests with coverage output.
- `npm run test:e2e` runs Playwright E2E tests (expects the app on port `8081`).
- `npm run test:all` runs unit tests and then E2E tests.

## Coding Style & Naming Conventions
- JavaScript is ES modules (`"type": "module"` in `package.json`).
- Indentation is 2 spaces; use semicolons and match existing file formatting.
- Filenames are kebab-case (for modules) and tests use `*.test.js` or `*.spec.js`.
- No dedicated linter is configured; keep changes consistent with nearby code.

## Testing Guidelines
- Unit tests use Vitest in `test/unit/` and follow `*.test.js` naming.
- E2E tests use Playwright in `test/e2e/` and follow `*.spec.js` naming.
- When updating live data snapshots, run:
  `node scripts/capture-snapshot.js`

## Commit & Pull Request Guidelines
- Commit messages follow an imperative, sentence-case style (e.g., “Fix …”, “Add …”, “Increase …”).
- PRs should include a short summary, testing notes (commands run), and UI screenshots or a screen recording if visual changes are involved.

## Configuration & Deployment Notes
- The app calls the public Bugzilla REST API; no auth is required for public bugs.
- E2E tests assume a running server on `http://localhost:8081`.
