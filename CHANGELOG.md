# Changelog

## 1.0.0 (2026-10-19)

- First release. One node, **System One**: ask yes/no (Noul), pick-one (Choice) and score questions about any item and
  get every answer with its probabilities, on one output.
- One credential, **System One API**, with a Host choice: TypeSafe (default), Venice, or any host serving
  `POST /v1/systemone`. Model names are translated to each host's spelling (`jev-1.13.0` ↔ `jev-1-13-0`,
  `typesafe-jev` → `jev-latest`).
- No run-time dependencies, n8n strict mode, usable as an AI Agent tool, published from GitHub Actions with provenance.
