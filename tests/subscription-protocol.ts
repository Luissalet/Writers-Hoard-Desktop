import assert from 'node:assert/strict';
import { buildSubscriptionPrompt, parseSubscriptionResponse, SubscriptionProtocolError, SUBSCRIPTION_MAX_RESPONSE_CHARS } from '../src/services/aiRuntime/subscriptionProtocol';
import type { AiChatRequest } from '../src/services/aiRuntime/types';

export function runSubscriptionProtocolTests(): string[] {
  const request: AiChatRequest = {
    connectionId: 'claude', modelId: 'sonnet',
    messages: [{ role: 'system', content: 'Help the author.' }, { role: 'user', content: 'List my projects.' }],
    tools: [{ name: 'wh_list_projects', description: 'List projects', parameters: { type: 'object', properties: {} } }],
  };
  const call = { id: 'call_1', name: 'wh_list_projects', args: {} };
  assert.deepEqual(parseSubscriptionResponse(JSON.stringify({ content: '', toolCalls: [call] }), request), { content: '', toolCalls: [call] });
  assert.deepEqual(parseSubscriptionResponse('{"content":"Finished.","toolCalls":[]}', request), { content: 'Finished.', toolCalls: [] });
  const rejectionCases = [
    '', 'not JSON', '```json\n{"content":"", "toolCalls":[]}\n```',
    '{"content":"", "toolCalls":[]} trailing text',
    '{"content":""}', '{"content":null,"toolCalls":[]}',
    JSON.stringify({ content: '', toolCalls: [call], extra: true }),
    JSON.stringify({ content: '', toolCalls: [call, call] }),
    JSON.stringify({ content: '', toolCalls: [{ ...call, name: 'shell' }] }),
    JSON.stringify({ content: '', toolCalls: [{ ...call, id: '../call' }] }),
    JSON.stringify({ content: '', toolCalls: [{ ...call, args: '{}' }] }),
    JSON.stringify({ content: '', toolCalls: [{ ...call, args: null }] }),
    JSON.stringify({ content: '', toolCalls: [{ ...call, args: [] }] }),
    JSON.stringify({ content: '', toolCalls: [{ ...call, approved: true }] }),
    JSON.stringify({ content: '', toolCalls: [call, { ...call, id: 'call_2', name: 'not_offered' }] }),
    JSON.stringify({ content: '', toolCalls: Array.from({ length: 21 }, (_, i) => ({ ...call, id: `call_${i}` })) }),
    'x'.repeat(SUBSCRIPTION_MAX_RESPONSE_CHARS + 1),
  ];
  for (const text of rejectionCases) assert.throws(() => parseSubscriptionResponse(text, request), SubscriptionProtocolError);

  const roundTwo: AiChatRequest = {
    ...request,
    messages: [...request.messages,
      { role: 'assistant', content: '', toolCalls: [call] },
      { role: 'tool', toolCallId: call.id, name: call.name, content: '{"projects":[{"id":"real_id"}]}' },
    ],
  };
  assert.throws(() => parseSubscriptionResponse(JSON.stringify({ content: '', toolCalls: [call] }), roundTwo), /previously used/);
  assert.deepEqual(parseSubscriptionResponse('{"content":"Found one project.","toolCalls":[]}', roundTwo).toolCalls, []);
  const prompt = buildSubscriptionPrompt(roundTwo);
  assert.ok(prompt.includes('Do not use any native CLI tools'));
  assert.ok(prompt.includes('confirmations and audit'));
  const encodedHistory = JSON.parse(prompt.slice(prompt.indexOf('\n\n') + 2));
  assert.deepEqual(encodedHistory.messages, roundTwo.messages);
  assert.deepEqual(encodedHistory.tools, request.tools);

  const noTools = { ...request, tools: [] };
  const toolShapedText = JSON.stringify({ content: '', toolCalls: [call] });
  assert.deepEqual(parseSubscriptionResponse(toolShapedText, noTools), { content: toolShapedText, toolCalls: [] });
  assert.ok(buildSubscriptionPrompt(noTools).includes('No application tools are available'));
  return ['subscription tool proposal and final response', `${rejectionCases.length} malformed/unoffered/bounded responses rejected atomically`, 'round-trip history and tool-result IDs, no reused calls', 'native tools forbidden and no-tools mode never produces calls'];
}
