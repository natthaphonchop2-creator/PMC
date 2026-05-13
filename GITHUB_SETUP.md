# GitHub Setup

## Current Local State

This project is already initialized as a local git repository on branch `main`.

Current first commit:

```txt
Initial PMC Ads Agent dashboard
```

Secrets are ignored:

- `.env`
- `.env.*`
- `.meta-api.local.json`
- `.mcp.local.json`

Large/generated files are ignored:

- `node_modules/`
- `dist/`
- `dist-server/`
- `*.zip`
- `*.tar.gz`

## Option A: GitHub Plugin / Connector

The Codex GitHub plugin is enabled, but the GitHub App currently has no installed account/repository access for this user.

To use it fully:

1. Install/authorize the GitHub App for `natthaphonchop2-creator`.
2. Give access to a repository.
3. Return to Codex and ask it to push/create files/PRs in that repository.

## Option B: Create Repo Manually, Then Push

Create an empty private GitHub repository named:

```txt
pmc-ads-agent
```

Then run:

```bash
git remote add origin https://github.com/natthaphonchop2-creator/pmc-ads-agent.git
git push -u origin main
```

If GitHub asks for credentials, use a fine-grained personal access token with repository write access.

## Option C: GitHub MCP Server

An example MCP config is included:

```txt
mcp.github.example.json
```

Copy it to a local secret file before using:

```bash
cp mcp.github.example.json .mcp.local.json
```

Then replace:

```txt
replace_with_github_pat
```

with a GitHub personal access token.

The example uses GitHub's official MCP server Docker image:

```txt
ghcr.io/github/github-mcp-server
```

This machine currently does not have Docker installed, so the Docker-based MCP server cannot run until Docker is installed.
