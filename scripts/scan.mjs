// Runs n8n's own submission scanner against THIS checkout, before anything is published.
//
// `npx @n8n/scan-community-package <name>` only works on a package already on npm, which is too late
// to learn that it fails. The scanner exports the function it uses, so this calls it directly on the
// source (what n8n lints from the provenance-attested repo) and on the packed tarball (what ships).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The scanner is installed into its OWN directory, not this project's node_modules. As a
// devDependency its bundled @typescript-eslint resolved this project's TypeScript instead of its own
// and crashed on load ("Cannot read properties of undefined (reading 'Intrinsic')").
const SCANNER_VERSION = '0.39.0';
const scannerHome = path.join(tmpdir(), `n8n-scanner-${SCANNER_VERSION}`);
const scannerEntry = path.join(scannerHome, 'node_modules/@n8n/scan-community-package/scanner/scanner.mjs');
if (!existsSync(scannerEntry)) {
	console.log(`installing @n8n/scan-community-package@${SCANNER_VERSION} into ${scannerHome} …`);
	mkdirSync(scannerHome, { recursive: true });
	execFileSync('npm', ['install', '--prefix', scannerHome, '--no-audit', '--no-fund', '--silent', `@n8n/scan-community-package@${SCANNER_VERSION}`], { stdio: 'inherit' });
}
const { analyzePackage, SOURCE_FILE_PATTERNS } = await import(scannerEntry);
let failed = false;
const report = (label, r) => {
	console.log(`${r.passed ? 'PASS' : 'FAIL'}  ${label}${r.message ? ` — ${r.message}` : ''}`);
	if (r.details) console.log(String(r.details));
	if (!r.passed) failed = true;
};

report('source ', await analyzePackage(root, SOURCE_FILE_PATTERNS));

const tmp = mkdtempSync(path.join(tmpdir(), 'n8n-scan-'));
try {
	const tgz = execFileSync('npm', ['pack', '--silent', '--pack-destination', tmp], { cwd: root, encoding: 'utf8' }).trim().split('\n').pop();
	execFileSync('tar', ['-xzf', path.join(tmp, tgz), '-C', tmp]);
	// an unbuilt checkout packs no dist/, and the scanner passes an empty package: every file package.json names must ship
	const pkg = JSON.parse(readFileSync(path.join(tmp, 'package', 'package.json'), 'utf8'));
	const missing = [...pkg.n8n.nodes, ...pkg.n8n.credentials].filter((f) => !existsSync(path.join(tmp, 'package', f)));
	report('tarball has every node and credential', { passed: missing.length === 0, message: missing.length ? `missing (run npm run build first): ${missing.join(', ')}` : '' });
	report('tarball', await analyzePackage(path.join(tmp, 'package'), ['**/*.js', 'package.json']));
} finally {
	rmSync(tmp, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
