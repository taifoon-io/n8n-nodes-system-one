import type { IDataObject, IExecuteFunctions, IHttpRequestOptions, INode, INodeExecutionData, INodeType, INodeTypeDescription, JsonObject } from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError, sleep } from 'n8n-workflow';

import { baseFor, modelFor, type HostKind } from './hosts';

/**
 * System One for n8n.
 *
 * One service, the System One API, reached one way: POST {host}/v1/systemone with your own key. TypeSafe hosts it by
 * default; Venice serves the same API, and so can any other host. The model name is translated to the host's spelling. The node asks and returns what the model answered, every answer
 * with its probabilities, on one output. It never routes: branch on the numbers with n8n's own IF or Switch node.
 */

interface UiQuestion { id: string; kind: 'noul' | 'choice' | 'score'; text: string; options?: string | string[] | Record<string, string | null>; levels?: string | string[]; yesMeans?: string; noMeans?: string }

const REDACT = /(Bearer\s+|apikey_|sk-)[A-Za-z0-9_.-]+/g;
const redact = (s: unknown) => String(s ?? '').replace(REDACT, '$1[redacted]');

/** Options and levels arrive as the form's delimited text, or as a list when someone passes JSON. */
const split = (s: string | string[] | undefined, sep: RegExp) => (Array.isArray(s) ? s.map(String) : String(s ?? '').split(sep)).map((x) => x.trim()).filter(Boolean);

/**
 * A pick-one's options, each with an optional description (the host sends both to the model, and a description is what
 * separates two options that sound alike): "billing, technical" or "billing = payments and refunds; technical = bugs".
 * Entries are separated by new lines or semicolons when there are any (so a description may contain a comma), else by commas.
 */
function parseOptions(raw: UiQuestion['options']): Array<[string, string]> {
	if (raw && typeof raw === 'object' && !Array.isArray(raw)) return Object.entries(raw).map(([k, v]) => [k.trim(), String(v ?? '').trim() || k.trim()] as [string, string]).filter(([k]) => k);
	const text = Array.isArray(raw) ? raw.map(String) : String(raw ?? '').split(/[\n;]/.test(String(raw ?? '')) ? /\s*[\n;]\s*/ : /\s*,\s*/);
	return text.map((e) => { const at = e.indexOf('='); const k = (at < 0 ? e : e.slice(0, at)).trim(); return [k, (at < 0 ? '' : e.slice(at + 1).trim()) || k] as [string, string]; }).filter(([k]) => k);
}

/** One question in the System One API's own shape. */
function toApi(q: UiQuestion): IDataObject {
	if (q.kind === 'choice') return { type: 'choice', instructions: q.text, criteria: Object.fromEntries(parseOptions(q.options)) };
	if (q.kind === 'score') return { type: 'score', instructions: q.text, criteria: split(q.levels, /\s*\|\s*/) };
	const means = { ...(q.yesMeans?.trim() ? { true: q.yesMeans.trim() } : {}), ...(q.noMeans?.trim() ? { false: q.noMeans.trim() } : {}) };
	return { type: 'noul', instructions: q.text, ...(Object.keys(means).length ? { criteria: means } : {}) };
}

const round = (x: number) => Math.round(x * 1e6) / 1e6;

/** One answer as the workflow reads it: the value, and every probability the host returned. null when it is missing. */
function shape(q: UiQuestion, a: IDataObject | undefined): { ok: boolean; answer: IDataObject } {
	if (q.kind === 'noul') {
		if (typeof a?.noul !== 'number') return { ok: false, answer: { kind: 'noul', value: null } };
		const p = a.noul;
		return { ok: true, answer: { kind: 'noul', p, value: p >= 0.5, probabilities: { yes: p, no: round(1 - p) } } };
	}
	const value = q.kind === 'choice' ? a?.choice : a?.score;
	if ((q.kind === 'choice' && typeof value !== 'string') || (q.kind === 'score' && typeof value !== 'number')) return { ok: false, answer: { kind: q.kind, value: null } };
	return { ok: true, answer: { kind: q.kind, value: value as string | number, confidence: (a!.confidence as number) ?? null, probabilities: a!.probabilities as IDataObject, ...(q.kind === 'score' ? { legend: a!.legend as string[] } : {}) } };
}

function statusOf(error: unknown): number {
	const e = error as { httpCode?: string | number; response?: { status?: number }; cause?: { response?: { status?: number } } };
	return Number(e.httpCode ?? e.response?.status ?? e.cause?.response?.status);
}

function safeError(error: unknown): JsonObject {
	const e = error as { message?: string; description?: string; response?: { data?: unknown } };
	const status = statusOf(error);
	const said = typeof e.response?.data === 'object' && e.response?.data !== null ? JSON.stringify(e.response.data) : String(e.description ?? e.message ?? '');
	return { message: `Request failed (${Number.isFinite(status) ? status : 'unknown'})`, description: redact(said.slice(0, 300)), httpCode: String(Number.isFinite(status) ? status : 'unknown') };
}

/** For the statuses a person can act on, say what to do next. */
function nextStep(status: number): string | undefined {
	if (status === 401 || status === 403) return 'The System One host rejected the key. Check the System One API credential: the key may have been rotated or revoked.';
	if (status === 402) return 'The System One host reports the account has no credit. Top it up with your host.';
	return undefined;
}

/** A server that says when to come back is believed, up to 30 s: `Retry-After` in seconds or as an HTTP date. */
function retryAfterMs(error: unknown): number | undefined {
	const headers = (error as { response?: { headers?: Record<string, unknown> } }).response?.headers;
	const raw = headers?.['retry-after'] ?? headers?.['Retry-After'];
	if (raw === undefined || raw === null || raw === '') return undefined;
	const secs = Number(raw);
	const ms = Number.isFinite(secs) ? secs * 1000 : Date.parse(String(raw)) - Date.now();
	return Number.isFinite(ms) && ms >= 0 ? Math.min(ms, 30000) : undefined;
}

function failure(node: INode, error: unknown, itemIndex: number): NodeOperationError | NodeApiError {
	if (error instanceof NodeOperationError) return error;
	const safe = safeError(error);
	const step = nextStep(Number(safe.httpCode));
	if (step) return new NodeOperationError(node, step, { itemIndex, description: String(safe.description ?? '') });
	// never the raw HTTP error: it carries request headers, and n8n stores failed executions
	return new NodeApiError(node, safe, { itemIndex });
}

/** System One hosts ask for exponential backoff on 429 (rate limited) and 529 (overloaded). */
async function withBackoff<T>(node: INode, itemIndex: number, call: () => Promise<T>): Promise<T> {
	for (let attempt = 0; ; attempt++) {
		try {
			return await call();
		} catch (error) {
			const status = statusOf(error);
			if ((status === 429 || status === 529) && attempt < 3) { await sleep(retryAfterMs(error) ?? 500 * 2 ** attempt); continue; }
			throw failure(node, error, itemIndex);
		}
	}
}

export class SystemOne implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'System One',
		name: 'systemOne',
		icon: { light: 'file:systemOne.svg', dark: 'file:systemOne.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["model"]}}',
		description: 'Ask System One yes/no, pick-one and score questions about any item and get every answer with its probabilities',
		defaults: { name: 'System One' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [{ name: 'systemOneApi', required: true }],
		properties: [
			{ displayName: 'Model', name: 'model', type: 'string', default: 'jev-latest',
				description: 'The System One model to ask. jev-latest follows the host\'s newest model; jev-1.13.0 pins a version. Either spelling works on every host (jev-1.13.0 and jev-1-13-0, typesafe-jev and jev-latest): the node sends the one the host lists.' },
			{ displayName: 'Item to Judge', name: 'state', type: 'json', default: '={{ JSON.stringify($json) }}', required: true,
				description: 'Any JSON or text. The default sends the whole incoming item. Do the arithmetic upstream: the model judges, it does not calculate.' },
			{ displayName: 'Questions', name: 'questions', type: 'fixedCollection', typeOptions: { multipleValues: true }, default: {}, placeholder: 'Add Question',
				description: 'Ask every question that might matter in one call: they are answered in parallel and in isolation',
				options: [{ name: 'question', displayName: 'Question', values: [
					{ displayName: 'ID', name: 'id', type: 'string', default: '', placeholder: 'is_refund', description: 'Lower-case name the answer is returned under' },
					{ displayName: 'Levels', name: 'levels', type: 'string', default: '', placeholder: 'None | Low | Medium | High', displayOptions: { show: { kind: ['score'] } }, description: 'Pipe-separated rubric, lowest first, 2 to 10 levels. The answer is a zero-based position on this list and can land between levels.' },
					{ displayName: 'No Means', name: 'noMeans', type: 'string', default: '', placeholder: 'No urgency expressed', displayOptions: { show: { kind: ['noul'] } }, description: 'Optional. What a "no" means, in your words.' },
					{ displayName: 'Options', name: 'options', type: 'string', default: '', placeholder: 'billing = payments and refunds; technical = bugs and outages; sales', displayOptions: { show: { kind: ['choice'] } }, description: 'The options, separated by commas. To describe an option write "name = description"; separate entries with semicolons or new lines if a description contains a comma.' },
					{ displayName: 'Question Text', name: 'text', type: 'string', default: '', description: 'One atomic question. Anything that weighs several factors should be several questions.' },
					{ displayName: 'Type', name: 'kind', type: 'options', default: 'noul', options: [
						{ name: 'Choice (Pick One of a Set)', value: 'choice' }, { name: 'Noul (Yes/No as a Probability)', value: 'noul' }, { name: 'Score (Level on a Rubric)', value: 'score' }] },
					{ displayName: 'Yes Means', name: 'yesMeans', type: 'string', default: '', placeholder: 'Explicitly time-sensitive', displayOptions: { show: { kind: ['noul'] } }, description: 'Optional. What a "yes" means, in your words.' },
				] }] },
			{ displayName: 'Questions (JSON)', name: 'questionsJson', type: 'json', default: '[]',
				description: 'Optional. More questions as a JSON array of {ID, kind, text, options, levels}, for example from an expression or an earlier node. Added to the questions above.' },
			{ displayName: 'Fail Closed', name: 'failClosed', type: 'boolean', default: true,
				description: 'Whether an answer that did not validate stops the item with an error instead of flowing on as a null' },
			{ displayName: 'Raw Output', name: 'rawOutput', type: 'boolean', default: false,
				description: 'Whether to return the host\'s answer exactly as it was sent ({answers, model, usage}), without this node\'s shaping' },
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const out: INodeExecutionData[] = [];
		for (let i = 0; i < items.length; i++) {
			try {
				const stateRaw = this.getNodeParameter('state', i) as string | IDataObject;
				let state: unknown = stateRaw;
				if (typeof stateRaw === 'string') { try { state = JSON.parse(stateRaw); } catch { state = stateRaw; } }
				const ui = ((this.getNodeParameter('questions', i, {}) as IDataObject).question as unknown as UiQuestion[] | undefined) ?? [];
				const extraRaw = this.getNodeParameter('questionsJson', i, '[]') as string | UiQuestion[];
				const extra = (typeof extraRaw === 'string' ? JSON.parse(extraRaw || '[]') : extraRaw) as UiQuestion[];
				const qs = [...ui, ...(Array.isArray(extra) ? extra : [])].filter((q) => q?.id && q?.text);
				if (!qs.length) throw new NodeOperationError(this.getNode(), 'Add at least one question', { itemIndex: i });

				const cred = await this.getCredentials('systemOneApi');
				const kind = cred.hostKind as HostKind | undefined;
				const host = baseFor(kind, cred.host);
				// a key is only ever sent over TLS: a typo or a pasted http:// address must not leak it
				if (!/^https:\/\/[^\s/]+/i.test(host)) throw new NodeOperationError(this.getNode(), 'The Host in the System One API credential must start with https://', { itemIndex: i });
				const model = modelFor(kind ?? 'custom', String(this.getNodeParameter('model', i, 'jev-latest') || 'jev-latest'));
				const req: IHttpRequestOptions = { method: 'POST', url: `${host}/v1/systemone`, body: { model, state, questions: Object.fromEntries(qs.map((q) => [q.id, toApi(q)])) }, json: true, timeout: 60000 };
				const res = (await withBackoff(this.getNode(), i, () => this.helpers.httpRequestWithAuthentication.call(this, 'systemOneApi', req))) as { model?: string; answers?: Record<string, IDataObject>; usage?: IDataObject };

				const shaped = qs.map((q) => ({ id: q.id, ...shape(q, res.answers?.[q.id]) }));
				const bad = shaped.filter((s) => !s.ok).map((s) => s.id);
				if (bad.length && this.getNodeParameter('failClosed', i, true)) throw new NodeOperationError(this.getNode(), `An answer did not validate (${bad.join(', ')}); failing closed`, { itemIndex: i });
				const meta = { model: res.model ?? model, host, usage: res.usage ?? {} };
				if (this.getNodeParameter('rawOutput', i, false)) { out.push({ pairedItem: { item: i }, json: { ...meta, raw: res as unknown as IDataObject } }); continue; }
				out.push({ pairedItem: { item: i }, json: { ...meta, schema_ok: bad.length === 0, answers: Object.fromEntries(shaped.map((s) => [s.id, s.answer])) } });
			} catch (error) {
				if (this.continueOnFail()) {
					// our own redacted summary: NodeApiError rewords some statuses into a generic sentence
					const said = error instanceof NodeOperationError ? { message: error.message, description: error.description } : (error as NodeApiError).httpCode ? { message: `Request failed (${(error as NodeApiError).httpCode})`, description: (error as NodeApiError).description } : safeError(error);
					out.push({ pairedItem: { item: i }, json: { error: redact(said.message), description: redact(said.description) } });
					continue;
				}
				throw failure(this.getNode(), error, i);
			}
		}
		return [out];
	}
}
