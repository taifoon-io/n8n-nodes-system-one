<p align="center">
  <img src="https://raw.githubusercontent.com/taifoon-io/n8n-nodes-system-one/main/assets/banner.svg" alt="System One for n8n" width="100%">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@taifoon/n8n-nodes-system-one"><img src="https://img.shields.io/npm/v/@taifoon/n8n-nodes-system-one?style=flat-square&labelColor=000000&color=3DA5FF&label=npm" alt="npm"></a>
  <img src="https://img.shields.io/badge/provenance-signed-00B5B8?style=flat-square&labelColor=000000" alt="provenance">
  <img src="https://img.shields.io/badge/dependencies-0-E6F0F7?style=flat-square&labelColor=000000" alt="no dependencies">
  <img src="https://img.shields.io/badge/n8n-community%20node-3DA5FF?style=flat-square&labelColor=000000" alt="n8n community node">
</p>

## Why

Most automations stop at a judgement call. Is this a refund? Which team? How urgent? A chat model answers in prose
and sounds just as sure when it is guessing. System One answers closed questions and returns a **probability** for
every answer, so your workflow can tell a sure answer from a guess.

## What it solves

| Without it | With System One |
|---|---|
| A wall of IF nodes and keyword rules that break on the next phrasing | Ask the question in plain words; get `p = 0.93` back |
| An LLM step whose prose you parse, then hope | A typed answer: yes/no, one option of a set, or a level on your rubric |
| Every uncertain item handled like a sure one | Branch on the number: below your bar goes to a person or a second look |
| One vendor's endpoint baked into the workflow | One request shape on TypeSafe, Venice or any System One host |

## How

1. **Install.** n8n → **Settings → Community Nodes → Install** → `@taifoon/n8n-nodes-system-one`.
2. **Add a key.** Create a **System One API** credential, pick the **Host** (TypeSafe by default), paste your key,
   press **Test**.
3. **Ask.** Add **System One** after any node, write your questions, then branch with **IF** or **Switch** on
   `{{ $json.answers.<id>.p }}`.

<p align="center"><img src="https://raw.githubusercontent.com/taifoon-io/n8n-nodes-system-one/main/assets/workflow.svg" alt="New ticket → System One → IF → Billing or everyone else" width="100%"></p>

<p align="center"><img src="https://raw.githubusercontent.com/taifoon-io/n8n-nodes-system-one/main/assets/demo.gif" alt="Running the support triage workflow in n8n: the ticket goes to billing, the System One node shows every answer with its probabilities" width="100%"></p>
<p align="center"><sub>The support-triage example in n8n 2.43, with the sample answers pinned so it runs without a key.</sub></p>

## What comes back

One output. Every item keeps its own data and gains `answers`:

<p align="center"><img src="https://raw.githubusercontent.com/taifoon-io/n8n-nodes-system-one/main/assets/answers.svg" alt="the probabilities returned for one ticket" width="100%"></p>

```json
{ "answers": {
    "is_refund": { "kind": "noul",   "p": 0.93, "value": true, "probabilities": { "yes": 0.93, "no": 0.07 } },
    "team":      { "kind": "choice", "value": "billing", "confidence": 0.81, "probabilities": { "billing": 0.81, "technical": 0.15, "sales": 0.04 } },
    "urgency":   { "kind": "score",  "value": 2.4, "confidence": 0.55, "legend": ["None", "Low", "Medium", "High"] } },
  "model": "jev-1.13.0", "host": "https://api.typesafe.ai", "usage": { "input_tokens": 312, "output_tokens": 48 } }
```

| Question type | You write | You branch on |
|---|---|---|
| **Yes / no** (Noul) | "Is the customer asking for money back?" | `answers.is_refund.p >= 0.8` |
| **Pick one** (Choice) | "Which team?" + `billing = payments; technical = bugs; sales` | `answers.team.value` and its `confidence` |
| **Score** | "How urgent?" + `None \| Low \| Medium \| High` | `answers.urgency.value` (0 = first level) |

## Workflows to import

| Workflow | What it shows | File |
|---|---|---|
| Support triage | one call, three answers, an IF on the probability | [`support-triage.workflow.json`](examples/support-triage.workflow.json) |

**Workflows → Import from File**, pick your credential in the System One node, press **Test workflow**.

## Use it inside the flows you already have

- **Gmail or Slack triage.** Gmail Trigger → System One (`is_refund`, `team`) → Switch on `{{ $json.answers.team.value }}`
  → one Slack channel per team. Add `{{ $json.answers.team.confidence < 0.6 }}` as a rule to a human inbox.
- **Classify a sheet.** Google Sheets (read rows) → System One with *Item to Judge* `={{ JSON.stringify($json) }}` →
  Google Sheets (update) writing `answers.<id>.value` and `.p` into two columns. One request per row.
- **Guard an LLM step.** Basic LLM Chain → System One ("Does the answer claim anything the source does not say?") →
  IF `p < 0.2` sends the answer, else holds it.
- **A tool for your AI Agent.** The node is usable as a tool: add **System One** under the AI Agent's tools so the
  agent asks a closed question before it acts.
- **Gate a webhook.** Webhook → System One ("Is this request safe to run?") → IF → Respond to Webhook. Keep
  **Fail Closed** on so a malformed answer stops the item.

## Hosts and models

| Host | Base URL | Key from |
|---|---|---|
| TypeSafe (default) | `https://api.typesafe.ai` | [console.typesafe.ai](https://console.typesafe.ai) |
| Venice | `https://api.venice.ai/api` | [venice.ai/settings/api](https://venice.ai/settings/api) |
| Other host | your https URL serving `POST /v1/systemone` | your host |

Write the model as any host spells it: `jev-1.13.0` and `jev-1-13-0` are the same model, `typesafe-jev` is
`jev-latest`. The node sends the spelling your host lists. Pin a version when the same item must get the same answer
next month.

## Good to know

- **Ask everything in one node.** Questions are answered in parallel and in isolation; ten cost about what one does.
- **Calculate first, then ask.** Do arithmetic in a Code node. Ask the model for judgement, never a sum.
- **Fit your thresholds on your own items.** Label a few dozen before you trust a cut-off.
- **Rate limits are handled.** 429 and 529 are retried with backoff, honouring `Retry-After` up to 30 s.
- **Your key goes only to your host, over https.** It never appears in an error or an output.

`n8n` · `n8n-community-node-package` · `system-one` · `typesafe` · `venice` · `jev` · `classification` ·
`structured-output` · `probability` · `grading` · `ai-agent-tool`

## Development

```
npm ci && npm run lint && npm run build && npm test && npm run scan
```

`npm run scan` runs n8n's community-package scanner on the source and the packed tarball. Releases are published from
GitHub Actions with an npm provenance statement.

---

<p align="center"><a href="https://taifoon.io"><img src="https://raw.githubusercontent.com/taifoon-io/n8n-nodes-system-one/main/assets/taifoon.svg" alt="Taifoon" height="22"></a></p>
<p align="center"><sub>MIT · an independent community node by Taifoon · TypeSafe, Jev and Venice are trademarks of their owners;
this project is not affiliated with or endorsed by them.</sub></p>
