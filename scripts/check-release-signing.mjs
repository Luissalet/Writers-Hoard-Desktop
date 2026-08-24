const certificate = process.env.WIN_CSC_LINK || process.env.CSC_LINK;
const password = process.env.WIN_CSC_KEY_PASSWORD || process.env.CSC_KEY_PASSWORD;

const missing = [];
if (!certificate) missing.push('WIN_CSC_LINK');
if (!password) missing.push('WIN_CSC_KEY_PASSWORD');

if (missing.length > 0) {
  console.error(
    `[release-signing] Refusing to publish an unsigned Windows release. Missing: ${missing.join(', ')}.`,
  );
  process.exit(1);
}

console.log('[release-signing] Windows signing credentials are configured.');
