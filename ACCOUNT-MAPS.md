# Account map workflow

Set the `feedback-url` meta tag in `index.html` to the feedback app’s exact
origin. Configure the feedback app with this editor’s exact `EDITOR_PUBLIC_URL`
and the portal’s internal `PORTAL_API_URL`. Both backend apps use the existing
`FEEDBACK_STAFF_TOKEN`. Deploy editor and feedback on HTTPS sibling subdomains;
for local use, serve both on localhost with different ports.

My maps opens an account-owned gallery with search, folders and Draft,
Submitted and Accepted filters. Defuse is the only map type. Save (or Ctrl/Cmd+S)
saves the entire draft, including incomplete work. Submission validates first,
saves an immutable revision and opens the map’s feedback conversation. The
creator can reopen that map from feedback, make changes and submit another
revision to the same conversation. Editing an accepted map creates a draft;
the accepted revision changes only after a map moderator merges the update.

Sign-in is handled by feedback once. Account requests include its existing
HttpOnly cookie; no player token or staff secret is copied to this static app.
The feedback backend enforces ownership, revision conflicts, size limits and
review permissions. A stale save never overwrites another tab. While account
services are unavailable, the existing local editing and file tools remain
available. Save or Submit asks signed-out users to sign in.

The map engine’s production document adapter reuses its parser and serializer;
opening an account map resets undo and mirror state. Leave a live collaboration
session before opening another map, so a private draft cannot replace an active
shared session. Imported JSON starts a fresh account document rather than
silently replacing a previously opened map.

The related Cosmowar-Portal PR adds persistent documents, immutable revisions,
reviewer assignment, the existing feedback conversation and Accept and merge.
Apply both PRs when deployment is approved. No deployment is part of this PR.
