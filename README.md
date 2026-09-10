# Wedding Seating Chart

A small, single‑page app for mapping out a wedding venue and planning who sits where.
Lay out the room with rectangular and round tables in the same arrangement as the real
venue, import your guest list, then drag guests into seats.

No build step, no server, no account. Everything is plain HTML/CSS/JS and your plan is
saved in your browser (with JSON export/import for backups and sharing).

## Using it

**Locally (works right now):** download or clone the repo and open `index.html` in any
browser. No server needed. Your plan is stored in that browser.

**Hosted on GitHub Pages:** GitHub Pages is not available for private repositories on the
free plan. To publish this:

1. Make the repo public, or upgrade the account to GitHub Pro.
2. Settings → Pages → Build and deployment → Source: **GitHub Actions**.
3. Settings → Secrets and variables → Actions → Variables → add `PAGES_ENABLED` = `true`.
4. Push, or re-run the *Deploy to GitHub Pages* workflow. The site publishes at
   `https://<user>.github.io/wedding-seating-chart/`.

The deploy workflow is gated on that `PAGES_ENABLED` variable so it stays green until
you opt in.

### Guests
- **Paste names** — one per line — into the box and click *Add names*.
- **Import CSV** — the app uses a `Name` / `Full Name` column, or `First` + `Last`
  columns, otherwise the first column. Quoted fields with commas are handled.
  See `sample-guests.csv`.
- Duplicates (same name) are skipped.
- The guest list is always sorted alphabetically. Toggle *Show seated guests* to see
  everyone plus where they're sitting.

### Tables
- *Rectangular table* and *Round table* buttons add a table at the centre of the view.
- Drag a table anywhere. Movement snaps to the grid — toggle *Snap to grid* off for
  fine positioning, or change the grid size.
- Select a table to rename it (e.g. "Table 1", "Head Table"), set the seat count,
  resize it, rotate a rectangular table, duplicate it, or delete it.
- Rectangular tables seat guests along the two long edges; round tables seat guests
  evenly around the circumference.

### Seating guests
- Drag a guest from the list onto a seat. Drop onto the table body to take the first
  free seat. Drag a seated guest onto another seat to move them (occupied seats swap).
- Drag a guest back to the list to unseat them.
- Guests show as small squares with their name, sitting at their seat.

### Locking (so nothing moves by accident)
- Select one item (click) or many (Shift‑click, or drag a box around them on the
  canvas), then click **Lock selected**. Works on tables and guests together.
- Locked tables won't drag; locked guests won't move between seats. **Unlock selected**
  reverses it. Single items also have a *Locked* checkbox in the Details panel.

### Keyboard
- `Esc` clears the selection · `Delete` removes selected items · `Ctrl/Cmd+A` selects all.

### Saving
- The plan auto‑saves to this browser. Use **Export** for a `.json` backup and
  **Import** to load one (replaces the current plan). **Clear** wipes everything.

## Development

It's three files: `index.html`, `styles.css`, `app.js`. Edit and refresh.

A jsdom smoke test lives outside the repo during development; the app has no runtime
dependencies.
