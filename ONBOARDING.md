# Onboarding: a working workspace in 15 minutes

Goal: a new laptop (or a teammate, or you after a reinstall) gets exactly the repositories it needs, by scope, using only git.

## 1. Get the control repo

```sh
git clone https://github.com/DawitBK/workspace
cd workspace
```

## 2. Bootstrap

| OS | Command |
|---|---|
| Windows | `.\bootstrap.ps1 -Scope showcase` |
| macOS, Linux | `./bootstrap.sh showcase` |

It installs Node 22+ if missing, clones every repo in the scope into `~/dev/<group>/<name>` (override with `WORKSPACE_DEV_ROOT`), then runs the doctor. Prefer a container? Open the repo in a dev container or GitHub Codespaces (`.devcontainer/`).

## 3. Scopes

| Scope | What you get |
|---|---|
| `core` | this repo and the shared tooling |
| `showcase` | the public apps and sites |
| `product` | the SaaS product line and its infrastructure |
| `odoo` | MOS on Odoo (needs access) and the read-only Odoo upstream |
| `company` | private company repositories (needs access) |
| `learning` | archived coursework |

Repositories you cannot access are reported and skipped; they never stop the rest.

## 4. Daily commands

```sh
node src/cli.mjs status --scope=showcase       # ahead, behind, dirty, no commits
node src/cli.mjs pull   --scope=showcase       # clone what is missing, fast-forward the rest (dirty trees are skipped)
node src/cli.mjs push   --scope=showcase       # dry run; add --execute to push; never forces
node src/cli.mjs env init <repo>               # .env from .env.example with generated secrets
node src/cli.mjs up <repo>                     # local database via the repo's compose.dev.yml, then migrate and seed
node src/cli.mjs doctor                        # read-only health check
```

## 5. Databases: every machine has its own

By default a machine is a `dev` machine: each app runs a local compose database (PostgreSQL, Valkey, MinIO, Mailpit) with deterministic seed data. No tunnel, no backups.

One machine, the owner's laptop, is the **database host** for the hosted demos. That role is explicit (`role set db-host --confirm`), is stored only in `~/.workspace/machine.json`, is bound to that machine's hardware id, and the data-plane commands (`data up|backup|restore|tunnel`) refuse everywhere else, including on a machine where the file was copied. Other machines may still use the host's databases, by choice, through the connection strings in each app's README.

## 6. Secrets

None in git. Every app ships `.env.example`; `env init` fills placeholders with generated values. CI uses GitHub environment secrets.

## 7. Line endings and tools

New repos carry `.gitattributes` (LF) and `.editorconfig`, so Windows, macOS and Linux agree. `mise.toml` pins Node, pnpm and Python.

## 8. Proof it works

The `clone-to-green` workflow runs this exact path (pull the showcase scope into an empty folder, install, build) on Windows, Ubuntu and macOS every week and on every change.
