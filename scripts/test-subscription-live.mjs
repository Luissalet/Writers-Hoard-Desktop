import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const folder = await mkdtemp(path.join(os.tmpdir(), 'wh-subscription-test-'));
try {
  const out = path.join(folder, 'client.cjs');
  await build({ entryPoints: ['electron/ai/subscriptionClient.ts'], outfile: out, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], alias: { '@': path.resolve('src') }, plugins: [{name:'no-electron',setup(build){build.onResolve({filter:/^electron$/},()=>({path:'electron',namespace:'stub'}));build.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export const net = {};',loader:'js'}));}}] });
  const client = createRequire(import.meta.url)(out);
  const protocolPath = path.join(folder, 'protocol.cjs');
  await build({ entryPoints: ['src/services/aiRuntime/subscriptionProtocol.ts'], outfile: protocolPath, bundle: true, platform: 'node', format: 'cjs' });
  const { buildSubscriptionPrompt, parseSubscriptionResponse } = createRequire(import.meta.url)(protocolPath);
  for (const kind of ['claude-subscription', 'codex-subscription']) {
    try {
      await client.checkSubscription(kind);
      console.log(kind + ': authenticated subscription');
      const request = { connectionId: 'test', modelId: 'client-default', tools: [{name:'wh_get_context',description:'Read the fixture context for this test.',parameters:{type:'object',properties:{},additionalProperties:false}}], messages: [{role:'user', content:'Call wh_get_context with empty arguments. Wait for its result before answering.'}] };
      const first = parseSubscriptionResponse(await client.subscriptionAnswer(kind, 'client-default', buildSubscriptionPrompt(request), new AbortController().signal), request);
      if (first.toolCalls.length !== 1 || first.toolCalls[0].name !== 'wh_get_context') throw new Error('Expected fixture tool proposal');
      request.messages.push({role:'assistant',content:first.content,toolCalls:first.toolCalls});
      request.messages.push({role:'tool',name:'wh_get_context',toolCallId:first.toolCalls[0].id,content:'{"fixture":"OK","instruction":"Answer exactly OK, with no more tool calls."}'});
      request.messages.push({role:'user',content:'Now answer exactly OK based on the tool result. No more tool calls.'});
      const final = parseSubscriptionResponse(await client.subscriptionAnswer(kind, 'client-default', buildSubscriptionPrompt(request), new AbortController().signal), request);
      if (final.toolCalls.length || final.content.trim() !== 'OK') throw new Error('Expected fixture final response');
      console.log(kind + ': structured tool proposal + tool-result follow-up passed');
    } catch (err) { console.log(kind + ': ' + (err.code ?? 'test-failed') + ' ' + err.message); }
  }
} finally { await rm(folder, { recursive:true, force:true }); }

