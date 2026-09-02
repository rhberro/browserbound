# Triage Labels

The `triage` skill uses these label names to route issues:

| Label | Role |
|-------|------|
| `needs-triage` | Issue is unreviewed; triage skill will assess it |
| `needs-info` | Issue needs more context; waiting for author or stakeholder |
| `ready-for-agent` | Issue is clear enough for an agent to pick up; `to-spec` can draft a solution |
| `ready-for-human` | Issue needs human judgment, pairing, or code review |
| `wontfix` | Intentionally closed; issue will not be addressed |

These are the **canonical labels**. If your GitHub repo already uses different names (e.g., `bug:needs-triage`), edit the mapping in this file so `triage` applies existing labels instead of creating duplicates.

---

**Mapping** (repo labels → canonical role):

```yaml
needs-triage: needs-triage
needs-info: needs-info
ready-for-agent: ready-for-agent
ready-for-human: ready-for-human
wontfix: wontfix
```
