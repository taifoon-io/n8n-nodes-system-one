# System One for n8n

**Ask a model that only judges. Every answer comes back with its probabilities.**

System One answers three kinds of closed question about any item: yes/no (Noul), pick one (Choice) and a level on
a rubric (Score). This node sends your item and your questions to a System One host and returns every answer with
its probabilities on one output. Your workflow decides what to do with the numbers, using n8n's own IF or Switch node.

```
item ──► System One ──► the item's answers: p, probabilities, confidence, legend
                                 │
                 IF answers.is_refund.p >= 0.8 ──► billing
```

Use it to classify tickets and rows, pick a category, score a deliverable against a rubric, or check a claim
against a source. It is not for writing text, summarising, or reasoning about code.

## Install

In n8n: **Settings → Community Nodes → Install**, then enter `@taifoon/n8n-nodes-system-one`.
The package has no run-time dependencies.

## Credential: one key, any host

Create a **System One API** credential and pick the **Host**:

| Host | Base URL | Key from |
|---|---|---|
| TypeSafe (default) | `https://api.typesafe.ai` | [console.typesafe.ai](https://console.typesafe.ai) |
| Venice | `https://api.venice.ai/api` | [venice.ai/settings/api](https://venice.ai/settings/api) |
| Other Host | your URL | your host |

Every host takes the same request, `POST {base}/v1/systemone` with `{model, state, questions}` and a Bearer key, so a
workflow moves between hosts by changing the credential, nothing else. The **Test** button makes one tiny real call.
A key is only ever sent over https.

## Models: one name, every host

Hosts spell the same model differently. Write either spelling; the node sends the one the host lists.

| You write | TypeSafe receives | Venice receives |
|---|---|---|
| `jev-latest` (default) or `typesafe-jev` | `jev-latest` | `jev-latest` |
| `jev-1.13.0` or `jev-1-13-0` | `jev-1.13.0` | `jev-1-13-0` |
| `jev-1.14.0`, `jev-preview` | as written | as written (not listed by Venice today) |

`jev-latest` follows the host's newest model. Pin a version when the same item must get the same answer over time.

## Try it in two minutes

1. Import [`examples/support-triage.workflow.json`](examples/support-triage.workflow.json) (**Workflows → Import from File**).
2. Pick your **System One API** credential in the System One node and press **Test workflow**.
3. The output carries `answers.is_refund.p`, `answers.team.value` with a probability for every team, and
   `answers.urgency.value` (a zero-based level, with its `legend`). The IF node sends a sure refund to billing.

## What comes back

| Question | Output |
|---|---|
| Yes / no (Noul) | `{ kind: "noul", p, value: p >= 0.5, probabilities: { yes, no } }` |
| Pick one (Choice) | `{ kind: "choice", value, confidence, probabilities: { option: p, … } }` |
| Score | `{ kind: "score", value, confidence, probabilities: [ … ], legend: [ … ] }` |

Plus `model` (as the host answered), `host`, `usage` and `schema_ok`. **Raw Output** returns the host's
`{answers, model, usage}` untouched. **Fail Closed** (on by default) stops an item whose answer did not validate
instead of passing a null on. With **Continue On Fail**, the error rides on the item, with any key redacted.

## Good to know

- **Ask everything in one node.** Questions are answered in parallel and in isolation; ten cost about what one does.
- **Calculate first, then ask.** Do arithmetic in a Code node. Ask the model for judgment, never a sum.
- **Fit your thresholds on your own items.** Label a few dozen before you trust a cut-off.
- **Rate limits are handled.** 429 and 529 are retried with backoff, honouring `Retry-After` up to 30 s.
- **The node can be used as a tool** by n8n's AI Agent.

## Development

```
npm ci && npm run lint && npm run build && npm test && npm run scan
```

`npm run scan` runs n8n's community-package scanner on the source and on the packed tarball. Releases are published
from GitHub Actions with an npm provenance statement (`.github/workflows/publish.yml`).

## Licence

MIT. An independent community node by [Taifoon](https://github.com/taifoon-io). TypeSafe, Jev and Venice are
trademarks of their owners; this project is not affiliated with or endorsed by them.
