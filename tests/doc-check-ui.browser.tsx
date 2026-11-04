// Document check: the editor panel and the MCP tool give the same diagnostics.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { db } from '@/db';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import DocCheckControls from '@/components/editor/docCheck/DocCheckControls';
import type { Editor } from '@tiptap/core';
import type { Writing } from '@/types';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));
const HTML = '<h2>Instalar</h2><p>As requested, here is the updated page; see the code for the rest.</p><p>Actualmente hay 12 tests en el módulo.</p>';

export async function testDocCheckUi(): Promise<string[]> {
  const passed: string[] = [];
  const host = document.getElementById('root'); assert(host, 'root');
  let root: Root | null = null;
  const projectId = 'doc-check-' + crypto.randomUUID(); const id = projectId + '-w'; const now = Date.now();
  try {
    await act(async () => { root = createRoot(host); root.render(<DocCheckControls editor={{ getHTML: () => HTML } as unknown as Editor} locale="es" />); await pause(100); });
    const toggle = host.querySelector<HTMLButtonElement>('button[aria-expanded]')!; assert(toggle, 'Panel button');
    await act(async () => { toggle.click(); await pause(100); });
    await act(async () => { host.querySelector<HTMLButtonElement>('[data-doc-check-run]')!.click(); await pause(100); });
    const rules = [...host.querySelectorAll('[data-doc-check-diagnostic]')].map(node => node.getAttribute('data-doc-check-diagnostic'));
    assert(rules.includes('FIN001') && rules.includes('PTR001') && rules.includes('VOL001'), `Panel rules: ${rules.join()}`);
    assert(/línea \d+/.test(host.textContent ?? '') && /Cómo arreglarlo/.test(host.textContent ?? ''), 'Panel shows line and fix');
    passed.push(`Editor panel "Comprobar documento" lists ${rules.join(', ')} with line and fix`);
    await db.projects.add({ id: projectId, title: 'QA doc check', mode: 'reporter', type: 'standalone', color: '#445566', description: '', status: 'draft', enabledEngines: ['writings'], engineOrder: ['writings'], createdAt: now, updatedAt: now });
    await db.writings.add({ id, projectId, title: 'Instalar', content: HTML, wordCount: 20, tags: [], status: 'draft', createdAt: now, updatedAt: now } as Writing);
    const reply = await runBridgeTool('wh_check_markdown_document', { id, kind: 'explanation' }); assert(reply.ok, `tool: ${reply.error}`);
    const result = reply.result as { diagnostics: { rule: string; line: number; fix: string }[]; passed: boolean };
    const toolRules = result.diagnostics.map(item => item.rule);
    for (const rule of ['FIN001', 'PTR001', 'VOL001']) assert(toolRules.includes(rule), `Tool missed ${rule}: ${toolRules.join()}`);
    assert(result.passed === false, 'Errors mean passed=false');
    assert(result.diagnostics.every(item => item.line > 0 && item.fix), 'Tool diagnostics carry line and fix');
    const raw = await runBridgeTool('wh_check_markdown_document', { markdown: '# Plan\n\nNada.' }); assert(raw.ok && (raw.result as { diagnostics: { rule: string }[] }).diagnostics[0].rule === 'KND001', 'Raw markdown without kind gives KND001');
    passed.push('MCP tool wh_check_markdown_document gives the same rules for a chapter id and for raw markdown');
    return passed;
  } finally {
    await act(async () => { root?.unmount(); await pause(); });
    await db.writings.delete(id); await db.projects.delete(projectId);
  }
}
