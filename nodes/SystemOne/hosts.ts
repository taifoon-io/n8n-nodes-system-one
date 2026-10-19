/**
 * The System One hosts and how each spells the same model. One request shape (POST {base}/v1/systemone, Bearer key,
 * {model, state, questions}) works on every host; only the base URL and the model's spelling differ.
 *   TypeSafe: jev-latest, jev-preview, jev-1.13.0, jev-1.14.0              https://docs.typesafe.ai/models
 *   Venice:   jev-latest, jev-1-13-0, typesafe-jev (its /systemone alias)  https://docs.venice.ai/api-reference/endpoint/decisions/systemone
 */
export type HostKind = 'typesafe' | 'venice' | 'custom';

export const HOST_BASE: Record<Exclude<HostKind, 'custom'>, string> = {
	typesafe: 'https://api.typesafe.ai',
	venice: 'https://api.venice.ai/api',
};

/** every spelling, keyed by one canonical name: [TypeSafe's, Venice's] (null = that host does not list it) */
const MODELS: Record<string, [string, string | null]> = {
	'jev-latest': ['jev-latest', 'jev-latest'],
	'jev-1.13.0': ['jev-1.13.0', 'jev-1-13-0'],
	'jev-1.14.0': ['jev-1.14.0', null],
	'jev-preview': ['jev-preview', null],
};
const ALIASES: Record<string, string> = { 'jev-1-13-0': 'jev-1.13.0', 'jev-1-14-0': 'jev-1.14.0', 'typesafe-jev': 'jev-latest' };

/** The model name as this host spells it. Unknown names, and every name on another host, pass through unchanged. */
export function modelFor(kind: HostKind, model: string): string {
	const name = model.trim();
	if (kind === 'custom') return name;
	const spellings = MODELS[ALIASES[name] ?? name];
	if (!spellings) return name;
	return (kind === 'venice' ? spellings[1] : spellings[0]) ?? name;
}

/** The base URL for a credential: a named host, or the custom URL with trailing slashes removed. */
export function baseFor(kind: HostKind | undefined, custom: unknown): string {
	if (kind === 'venice' || kind === 'typesafe') return HOST_BASE[kind];
	if (kind === 'custom') return String(custom ?? '').trim().replace(/\/+$/, '');
	// a credential saved before the Host choice existed: its URL if it has one, else TypeSafe
	return String(custom ?? '').trim().replace(/\/+$/, '') || HOST_BASE.typesafe;
}
