# Wedding Seating Chart

A small, single‑page app for mapping out a wedding venue and planning who sits where.
Lay out the room with rectangular and round tables in the same arrangement as the real
venue, import your guest list, then drag guests into seats.

No build step, no server, no account. Everything is plain HTML/CSS/JS and your plan is
saved in your browser (with JSON export/import for backups and sharing).

## Using it

**Live:** https://jbasbill.github.io/wedding-seating-chart/

**Locally:** download or clone the repo and open `index.html` in any browser. No server
needed.

Your plan is stored in the browser you use (localStorage), per device. Use **Export**
for a `.json` backup you can move between devices or share.

### Deployment

Pushing to `main` publishes the site via the *Deploy to GitHub Pages* workflow
(`.github/workflows/pages.yml`). The job is gated on a repository variable
`PAGES_ENABLED = true` (Settings → Secrets and variables → Actions → Variables); without
it the workflow is skipped, which is what you want on a private repo where Pages is
unavailable.

### Guests
- **Paste names** — one per line — into the box and click *Add names*.
- **Import CSV** — the app uses a `Name` / `Full Name` column, or `First` + `Last`
  columns, otherwise the first column. Quoted fields with commas are handled.
  See `sample-guests.csv`.
- Duplicates (same name) are skipped.
- The guest list is sorted by **last name, then first name**, and shown as
  `Last, First` (the last whitespace‑separated word is taken as the surname, or the part
  before a comma if you type `Lovelace, Ada`). Search matches either form. Toggle
  *Show seated guests* to see everyone plus where they're sitting.

### Tables
- *Rectangular table* and *Round table* buttons add a table at the centre of the view.
- Drag a table anywhere. Movement snaps to the grid — toggle *Snap to grid* off for
  fine positioning, or change the grid size.
- Select a table to rename it (e.g. "Table 1", "Head Table"), set the seat count,
  resize it, rotate a rectangular table, duplicate it, or delete it.
- Rectangular tables seat guests along the two long edges; round tables seat guests
  evenly around the circumference.
- **Edit tables as a group:** select several tables (Shift‑click or drag a box) and the
  Details panel shows shared *Seats / Width / Height / Radius* fields — change one and it
  applies to every selected table. A blank field leaves that value untouched; a field
  shows `mixed` when the selected tables don't currently agree.
- **Copy / paste:** select one or more tables and press `Ctrl/Cmd+C`, then `Ctrl/Cmd+V`
  to drop offset duplicates (relative spacing is preserved; repeated pastes stack
  diagonally). *Copy tables* / *Duplicate tables* buttons in the Details panel do the
  same. Seat assignments are not copied.
- **Infinite grid:** drag a table toward any edge and the grid extends in that
  direction — including up and left — so you're never boxed in. The layout tidies its
  coordinates back toward the origin when you drag everything far out.
- **Zoom:** the `−` / `+` buttons (or `Ctrl/Cmd` + `-` / `=`, or `Ctrl/Cmd` + scroll /
  trackpad pinch) zoom from 20% to 200%; the middle button shows the level and resets to
  100% (`Ctrl/Cmd 0`). **Fit** zooms so every table is visible at once. Zoom is
  remembered between sessions.

### Seating guests
- Drag a guest from the list onto a seat. Drop onto the table body to take the first
  free seat.
- **Dropping a guest onto a seat that's already taken swaps them:** if the dragged guest
  came from another seat, the person who was there moves into that now-empty seat; if the
  dragged guest came from the list, the person who was there goes back to the list.
- Drag a guest back to the list to unseat them.
- Guests show as small squares with their name, sitting at their seat.

### Locking (so nothing moves by accident)
- Select one item (click) or many (Shift‑click, or drag a box around them on the
  canvas — the grid pans when the box reaches the edge of the view), then click
  **Lock selected**. Works on tables and guests together.
- Locked tables won't drag; locked guests won't move between seats. **Unlock selected**
  reverses it. Single items also have a *Locked* checkbox in the Details panel.

### Keyboard
- `Esc` clear selection · `Delete` remove selected · `Ctrl/Cmd+A` select all ·
  `Ctrl/Cmd+C` / `Ctrl/Cmd+V` copy / paste selected tables ·
  `Ctrl/Cmd` `+` / `-` / `0` zoom in / out / reset.

### Saving
- The plan auto‑saves to this browser. Use **Export** for a `.json` backup and
  **Import** to load one (replaces the current plan). **Clear** wipes everything.

## Development

It's three files: `index.html`, `styles.css`, `app.js`. Edit and refresh.

A jsdom smoke test lives outside the repo during development; the app has no runtime
dependencies.
