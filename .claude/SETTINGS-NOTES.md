# What this project's settings.json can and cannot do

This repo runs on a fleet with `/etc/claude-code/managed-settings.json` in place. Managed
settings sit above every other level, and a lower level can only make a managed value
*stricter*, never looser. Check the live picture with `/status` (which managed source was
selected) and `claude doctor` (what got dropped).

## The permission lists here mirror the managed file

They are byte-for-byte the same rules. On a managed machine they are **ignored** -
`allowManagedPermissionRulesOnly: true` makes Claude Code disregard permission rules from
user, project, and local files and from `--allowedTools`. Only the managed rules apply.

They are kept here anyway for two reasons:

1. **Cloud sessions and CI do not read a device's managed file.** An Anthropic-hosted
   session or a CI container falls back to this file as its only permission policy. Without
   these rules, those contexts would run with no policy at all.
2. **One place to read.** A developer opening this repo sees the same policy that is in
   force, rather than having to go find the managed file.

The cost of the mirror is that it can drift. When the managed file changes, update this
file in the same commit, or the fallback policy silently diverges from the real one.

## The sandbox is off, deliberately

Managed settings no longer configure the sandbox, which means a project or user file
*could* turn it on. This file sets `sandbox.enabled: false` explicitly rather than
omitting the key, so a developer's own `~/.claude/settings.json` cannot re-enable it here.

The VM is the isolation boundary. Consequences worth knowing:

- `sandbox.credentials` deny and mask rules do not apply. Nothing unsets credential
  environment variables before a Bash command runs.
- There is no network egress allowlist on Bash. Outbound requests are governed only by
  the `Bash(curl *)` / `Bash(wget *)` ask rules and by whatever the VM's network permits.
- The permission deny rules still cover Claude's Read tool and the Bash commands it
  recognizes as file reads, but not an arbitrary script that opens a file itself.
- `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` still applies. It is set in the managed `env` block
  and works regardless of sandboxing.

## What this file genuinely controls

- **Hooks.** `allowManagedHooksOnly` is `false`, so the three hooks in `.claude/hooks/`
  run alongside the managed ones. With the sandbox off, these are the only deterministic
  control that travels with the repo. Treat them as load-bearing.
- **Plugins**, skills, subagents, rules, and `CLAUDE.md`.

## Two things that will not work here

- **MCP servers.** `allowManagedMcpServersOnly: true` with an empty `allowedMcpServers`
  means no MCP server loads. A `.mcp.json` in this repo would be inert.
- **Shell injection in skills.** `disableSkillShellExecution: true` replaces every
  `` !`command` `` in a project skill with `[shell command execution disabled by policy]`.
  The skills here ask Claude to run those commands as normal Bash calls instead. Do not
  reintroduce `!` injection - it will not fire, and the skill will read as a broken prompt.

## Model strings

`enforceAvailableModels: true` restricts models to the managed `availableModels` list.
Use exact strings in agent frontmatter (`claude-haiku-4-5`), never aliases (`haiku`).
