# Issue Tracker

**Where**: GitHub Issues (this repo's issue board)

**Workflow**: The following engineering skills read from and write to GitHub Issues for this repo:

- `to-tickets` — converts designs or specs into structured GitHub issues
- `triage` — labels and routes issues to agents or humans based on triage vocabulary
- `to-spec` — converts issues into design specs

**CLI**: These skills use the `gh` CLI (`gh issue create`, `gh issue list`, etc.). Ensure you're authenticated:

```bash
gh auth status
```

**PRs as a request surface**: Disabled by default. If you'd like external PRs to appear in the triage queue, edit this file and set `external_prs: true` in the frontmatter.

---

**Frontmatter**:
```yaml
tracker: github
external_prs: false
```
