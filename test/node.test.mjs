// Offline tests of the built node: a fake n8n context answers as a System One host would. Nothing leaves the machine.
//   npm run build && npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { SystemOne } = require('../dist/nodes/SystemOne/SystemOne.node.js');
const { SystemOneApi } = require('../dist/credentials/SystemOneApi.credentials.js');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

// the answers a host returns for three questions, in the documented shape
const HOST_ANSWERS = {
	is_refund: { type: 'noul', noul: 0.92 },
	team: { type: 'choice', choice: 'billing', confidence: 0.81, probabilities: { billing: 0.81, technical: 0.15, sales: 0.04 } },
	urgency: { type: 'score', score: 2.4, confidence: 0.55, probabilities: [0.05, 0.2, 0.55, 0.2], legend: ['None', 'Low', 'Medium', 'High'] },
};

function ctx(params, { calls = [], items = [{ json: { subject: 'Refund please', body: 'I was charged twice' } }], answer, credentials, continueOnFail = false } = {}) {
	return {
		getInputData: () => items,
		getNodeParameter: (name, _i, fallback) => (name in params ? params[name] : fallback),
		getNode: () => ({ name: 'System One', type: 'systemOne', typeVersion: 1, position: [0, 0], parameters: {} }),
		continueOnFail: () => continueOnFail,
		getCredentials: async () => credentials ?? { apiKey: 'test-key', hostKind: 'typesafe' },
		helpers: {
			httpRequestWithAuthentication: async (type, req) => {
				calls.push({ type, req });
				if (answer) return answer(req, calls.length);
				return { model: 'jev-1.13.0', answers: Object.fromEntries(Object.keys(req.body.questions).map((id) => [id, HOST_ANSWERS[id]])), usage: { input_tokens: 312, output_tokens: 48 } };
			},
		},
	};
}
const QUESTIONS = { question: [
	{ id: 'is_refund', kind: 'noul', text: 'Is the customer asking for money back?', yesMeans: 'they want a refund', noMeans: '' },
	{ id: 'team', kind: 'choice', text: 'Which team should handle this?', options: 'billing = payments and refunds; technical = bugs; sales' },
	{ id: 'urgency', kind: 'score', text: 'How urgent is this?', levels: 'None | Low | Medium | High' },
] };
const base = { model: 'jev-latest', state: '={{ JSON.stringify($json) }}', questions: QUESTIONS, questionsJson: '[]', rawOutput: false, failClosed: true };
const node = new SystemOne();

test('the request is the System One API: POST {host}/v1/systemone with state, model and typed questions', async () => {
	const calls = [];
	await node.execute.call(ctx({ ...base, state: '{"subject":"Refund please"}' }, { calls }));
	assert.equal(calls.length, 1);
	const { type, req } = calls[0];
	assert.equal(type, 'systemOneApi');
	assert.equal(req.method, 'POST');
	assert.equal(req.url, 'https://api.typesafe.ai/v1/systemone');
	assert.equal(req.body.model, 'jev-latest');
	assert.deepEqual(req.body.state, { subject: 'Refund please' }, 'JSON state is sent as JSON');
	assert.deepEqual(req.body.questions, {
		is_refund: { type: 'noul', instructions: 'Is the customer asking for money back?', criteria: { true: 'they want a refund' } },
		team: { type: 'choice', instructions: 'Which team should handle this?', criteria: { billing: 'payments and refunds', technical: 'bugs', sales: 'sales' } },
		urgency: { type: 'score', instructions: 'How urgent is this?', criteria: ['None', 'Low', 'Medium', 'High'] },
	});
});

test('text that is not JSON is sent as text', async () => {
	const calls = [];
	await node.execute.call(ctx({ ...base, state: 'the sky is blue' }, { calls }));
	assert.equal(calls[0].req.body.state, 'the sky is blue');
});

test('every answer comes back with its probabilities, on ONE output', async () => {
	const outs = await node.execute.call(ctx(base));
	assert.equal(outs.length, 1, 'one output');
	const [item] = outs[0];
	assert.deepEqual(item.pairedItem, { item: 0 });
	const a = item.json.answers;
	assert.deepEqual(a.is_refund, { kind: 'noul', p: 0.92, value: true, probabilities: { yes: 0.92, no: 0.08 } });
	assert.deepEqual(a.team, { kind: 'choice', value: 'billing', confidence: 0.81, probabilities: { billing: 0.81, technical: 0.15, sales: 0.04 } });
	assert.deepEqual(a.urgency, { kind: 'score', value: 2.4, confidence: 0.55, probabilities: [0.05, 0.2, 0.55, 0.2], legend: ['None', 'Low', 'Medium', 'High'] });
	assert.equal(item.json.model, 'jev-1.13.0');
	assert.equal(item.json.host, 'https://api.typesafe.ai');
	assert.deepEqual(item.json.usage, { input_tokens: 312, output_tokens: 48 });
	assert.equal(item.json.outcome, undefined, 'no labels, no routing: the workflow decides');
});

test('questions can also come as JSON (from an expression or an earlier node)', async () => {
	const calls = [];
	await node.execute.call(ctx({ ...base, questions: {}, questionsJson: JSON.stringify([{ id: 'is_refund', kind: 'noul', text: 'Refund?' }]) }, { calls }));
	assert.deepEqual(Object.keys(calls[0].req.body.questions), ['is_refund']);
});

test('one request, every host: the base URL and the model spelling follow the Host choice', async () => {
	const cases = [
		[{ hostKind: 'typesafe' }, 'jev-1.13.0', 'https://api.typesafe.ai/v1/systemone', 'jev-1.13.0'],
		[{ hostKind: 'typesafe' }, 'jev-1-13-0', 'https://api.typesafe.ai/v1/systemone', 'jev-1.13.0'],
		[{ hostKind: 'typesafe' }, 'typesafe-jev', 'https://api.typesafe.ai/v1/systemone', 'jev-latest'],
		[{ hostKind: 'venice' }, 'jev-1.13.0', 'https://api.venice.ai/api/v1/systemone', 'jev-1-13-0'],
		[{ hostKind: 'venice' }, 'jev-latest', 'https://api.venice.ai/api/v1/systemone', 'jev-latest'],
		[{ hostKind: 'venice' }, 'typesafe-jev', 'https://api.venice.ai/api/v1/systemone', 'jev-latest'],
		[{ hostKind: 'custom', host: 'https://s1.example.com//' }, 'jev-1.13.0', 'https://s1.example.com/v1/systemone', 'jev-1.13.0'],
		[{ host: 'https://legacy.example.com/' }, 'jev-latest', 'https://legacy.example.com/v1/systemone', 'jev-latest'],
		[{}, 'jev-latest', 'https://api.typesafe.ai/v1/systemone', 'jev-latest'],
	];
	for (const [cred, model, url, sent] of cases) {
		const calls = [];
		const [[item]] = await node.execute.call(ctx({ ...base, model }, { calls, credentials: { apiKey: 'k', ...cred } }));
		assert.equal(calls[0].req.url, url, JSON.stringify(cred));
		assert.equal(calls[0].req.body.model, sent, `${JSON.stringify(cred)} ${model}`);
		assert.equal(item.json.host, url.replace('/v1/systemone', ''));
	}
});

test('a key is only ever sent over https', async () => {
	const calls = [];
	await assert.rejects(node.execute.call(ctx(base, { calls, credentials: { apiKey: 'k', hostKind: 'custom', host: 'http://api.typesafe.ai' } })), /must start with https:\/\//);
	assert.equal(calls.length, 0);
});

test('Raw Output returns the host\'s answer untouched', async () => {
	const [[item]] = await node.execute.call(ctx({ ...base, rawOutput: true }));
	assert.deepEqual(item.json.raw.answers, HOST_ANSWERS);
	assert.equal(item.json.answers, undefined);
});

test('Fail Closed: an answer that is missing stops the item; off, it flows on as null', async () => {
	const answer = () => ({ model: 'jev-1.13.0', answers: { is_refund: HOST_ANSWERS.is_refund } });
	await assert.rejects(node.execute.call(ctx(base, { answer })), /did not validate.*team.*urgency/s);
	const [[item]] = await node.execute.call(ctx({ ...base, failClosed: false }, { answer }));
	assert.equal(item.json.schema_ok, false);
	assert.deepEqual(item.json.answers.team, { kind: 'choice', value: null });
});

test('429 and 529 are retried with backoff; then the answer is used', async () => {
	const calls = [];
	const answer = (req, n) => { if (n < 3) { const e = new Error('busy'); e.httpCode = n === 1 ? '429' : '529'; e.response = { headers: { 'retry-after': '0' } }; throw e; } return { model: 'jev-1.13.0', answers: { is_refund: HOST_ANSWERS.is_refund } }; };
	const [[item]] = await node.execute.call(ctx({ ...base, questions: { question: [QUESTIONS.question[0]] } }, { calls, answer }));
	assert.equal(calls.length, 3);
	assert.equal(item.json.answers.is_refund.p, 0.92);
});

test('a rejected key says what to do, and never echoes the key', async () => {
	const answer = () => { const e = new Error('Unauthorized Bearer sk-secret-123'); e.httpCode = '401'; throw e; };
	await assert.rejects(node.execute.call(ctx(base, { answer })), (e) => /rejected the key/.test(e.message) && !JSON.stringify(e).includes('sk-secret-123'));
});

test('Continue On Fail: the error rides on the item, redacted', async () => {
	const answer = () => { const e = new Error('boom Bearer sk-secret-123'); e.httpCode = '500'; throw e; };
	const [[item]] = await node.execute.call(ctx(base, { answer, continueOnFail: true }));
	assert.match(item.json.error, /Request failed \(500\)/);
	assert.ok(!JSON.stringify(item.json).includes('sk-secret-123'));
});

test('no question: a clear error, no call', async () => {
	const calls = [];
	await assert.rejects(node.execute.call(ctx({ ...base, questions: {} }, { calls })), /Add at least one question/);
	assert.equal(calls.length, 0);
});

test('n8n verification: one output, usable as an AI tool, one credential, no dependencies, strict', () => {
	const d = node.description;
	assert.equal(d.displayName, 'System One');
	assert.equal(d.outputs.length, 1); assert.equal(d.outputNames, undefined);
	assert.equal(d.usableAsTool, true);
	assert.deepEqual(d.credentials.map((c) => c.name), ['systemOneApi']);
	assert.equal(pkg.dependencies, undefined);
	assert.equal(pkg.n8n.strict, true);
	assert.deepEqual(pkg.n8n.nodes, ['dist/nodes/SystemOne/SystemOne.node.js']);
	assert.deepEqual(pkg.n8n.credentials, ['dist/credentials/SystemOneApi.credentials.js']);
});

test('the credential: Bearer auth, TypeSafe the default host, a real test call', () => {
	const c = new SystemOneApi();
	assert.equal(c.name, 'systemOneApi');
	assert.equal(c.authenticate.properties.headers.Authorization, '=Bearer {{$credentials.apiKey}}');
	assert.equal(c.properties.find((p) => p.name === 'hostKind').default, 'typesafe');
	assert.deepEqual(c.properties.find((p) => p.name === 'hostKind').options.map((o) => o.value), ['typesafe', 'venice', 'custom']);
	assert.equal(c.test.request.url, '/v1/systemone');
	assert.equal(c.test.request.body.model, 'jev-latest');
});

test('the example workflow: this node, your own credential (no id baked in), every wire to an existing node', () => {
	const w = JSON.parse(readFileSync(new URL('../examples/support-triage.workflow.json', import.meta.url), 'utf8'));
	const s1 = w.nodes.find((n) => n.type === '@taifoon/n8n-nodes-system-one.systemOne');
	assert.ok(s1, 'uses this node');
	assert.deepEqual(Object.keys(s1.credentials), ['systemOneApi']); assert.equal(s1.credentials.systemOneApi.id, '');
	assert.equal(w.connections[s1.name].main.length, 1, 'one output');
	for (const [from, c] of Object.entries(w.connections)) for (const outs of c.main) for (const t of outs) assert.ok(w.nodes.some((n) => n.name === t.node), `${from} → ${t.node}`);
	assert.doesNotMatch(JSON.stringify(w), /apikey_|sk-[A-Za-z0-9]{8}|Bearer /, 'no keys');
});
