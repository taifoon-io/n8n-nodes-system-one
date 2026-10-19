import type { IAuthenticateGeneric, ICredentialTestRequest, ICredentialType, INodeProperties } from 'n8n-workflow';

/**
 * Your own key for a System One host: TypeSafe (the default), Venice, or any host that serves the same System One API at
 * /v1/systemone. The key is stored in n8n's encrypted credential store and sent as a bearer token over TLS.
 */
export class SystemOneApi implements ICredentialType {
	name = 'systemOneApi';

	displayName = 'System One API';

	icon = { light: 'file:systemOne.svg', dark: 'file:systemOne.dark.svg' } as const;

	documentationUrl = 'https://docs.typesafe.ai/introduction/quickstart';

	properties: INodeProperties[] = [
		{ displayName: 'Host', name: 'hostKind', type: 'options', default: 'typesafe', description: 'Where the System One API is served. The same request works on every host; the node translates model names to the host\'s spelling.',
			options: [
				{ name: 'TypeSafe (api.typesafe.ai)', value: 'typesafe' },
				{ name: 'Venice (api.venice.ai)', value: 'venice' },
				{ name: 'Other Host', value: 'custom' },
			] },
		{ displayName: 'Host URL', name: 'host', type: 'string', default: '', placeholder: 'https://systemone.example.com', displayOptions: { show: { hostKind: ['custom'] } },
			description: 'The base URL of a host that serves POST {Host URL}/v1/systemone. Must be https: the node refuses to send your key anywhere else.' },
		{ displayName: 'API Key', name: 'apiKey', type: 'string', typeOptions: { password: true }, default: '', required: true, description: 'Your key from the host: console.typesafe.ai for TypeSafe, venice.ai/settings/api for Venice' },
	];

	authenticate: IAuthenticateGeneric = { type: 'generic', properties: { headers: { Authorization: '=Bearer {{$credentials.apiKey}}' } } };

	// the cheapest real call: one yes/no question about a four-word state
	test: ICredentialTestRequest = {
		request: { baseURL: '={{ $credentials.hostKind === "venice" ? "https://api.venice.ai/api" : $credentials.hostKind === "custom" ? String($credentials.host).replace(/\\/+$/, "") : "https://api.typesafe.ai" }}', url: '/v1/systemone', method: 'POST',
			body: { model: 'jev-latest', state: 'the sky is blue', questions: { ok: { type: 'noul', instructions: 'Does the state mention a colour?' } } } },
	};
}
