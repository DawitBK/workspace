# workspace

The control repo for the local workspace: where everything lives, and the tools that keep it that way. Zero dependencies (Node 22 or newer).

| Path | What it is |
|---|---|
| `repos.json` | every repository on the machine: remote, local path, scopes, visibility |
| `config/layout.json` | the declared layout `doctor` checks |
| `config/cleanup.example.json` | the rules `inventory` uses to classify loose files and folders (by name and extension only; no file is opened) |
| `src/doctor.mjs` | read-only health check: unmanaged entries, copy-style names, secret-looking names, large files, repos not in `repos.json`, repos with no commits, no remote, un-pushed or dirty work, the inbox |
| `src/inventory.mjs` | read-only: builds a manifest of intended moves for a clean-up |
| `src/cli.mjs` | the `workspace` command: `status`, `pull`, `push`, `env init`, `up`, `role`, `data` (see ONBOARDING.md) |
| `scopes.json`, `bootstrap.ps1`, `bootstrap.sh`, `mise.toml`, `.devcontainer/` | the portable-workspace pieces: scopes, one-command setup for Windows and Unix, pinned toolchain, dev container |
| `.github/workflows/clone-to-green.yml` | proves a fresh machine gets working code from git alone, on three operating systems |
| `src/apply.mjs` | executes one batch of a manifest (dry run unless `--execute`), writes an undo log, can undo |

## The clean-up protocol

1. `node src/inventory.mjs --config config/cleanup.example.json --out <dir>` writes `moves.json` and `summary.md` (kept outside git: file names are private).
2. `node src/apply.mjs --manifest <dir>/moves.json --batch A` is a dry run; add `--execute` to run it. Moves are same-volume renames, never deletes. A document leaving OneDrive is **copied**, because OneDrive is today an unintended cloud backup.
3. `node src/apply.mjs --undo <dir>/undo-A-....json --execute` restores a run.
4. `node src/doctor.mjs --strict` must come back clean.

## Layout

```
~/dev/{company,product,apps,personal,vendor,learning,workspace}   repositories, grouped by whose they are
~/Vault, ~/Inbox, ~/Tools, ~/runtime                              documents, landing zone, tools, machine-local state
```

`npm test` runs the tests.
