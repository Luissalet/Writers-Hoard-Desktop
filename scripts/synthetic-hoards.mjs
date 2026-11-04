// Synthetic stand-ins for Links Hoard and Kafka's Hoard, so tests of the frozen publishing worker
// never reach the user's running apps. Returns the environment that points the worker at them.
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function startSyntheticHoards(directory) {
  const calls = [];
  const server = createServer(async (req, res) => {
    const [, appName, ...rest] = req.url.split('/');
    const route = '/' + rest.join('/').split('?')[0];
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    if (route === '/api/health') return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ service: appName, version: 'qa' }));
    if (req.headers.authorization !== `Bearer ${appName}-qa-token`) return res.writeHead(401, { 'Content-Type': 'application/json' }).end('{"error":"unauthorized"}');
    const call = chunks.length ? JSON.parse(Buffer.concat(chunks)) : {};
    calls.push({ app: appName, tool: call.name || null });
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ synthetic: appName, tool: call.name || null, items: [] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const environment = { WRITER_HUB_URL: 'http://127.0.0.1:1' };
  for (const [variable, appName] of [['WRITER_LINKS', 'links'], ['WRITER_KAFKA', 'kafka']]) {
    const tokenFile = path.join(directory, appName + '-token');
    await writeFile(tokenFile, `${appName}-qa-token`);
    environment[variable + '_URL'] = `http://127.0.0.1:${server.address().port}/${appName}`;
    environment[variable + '_TOKEN_FILE'] = tokenFile;
  }
  return { environment, calls, close: () => new Promise(resolve => server.close(resolve)) };
}
