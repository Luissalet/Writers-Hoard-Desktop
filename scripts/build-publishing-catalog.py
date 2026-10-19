"""Freeze native schemas without starting applications, engines or data stores."""
import json
import os
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'publishing'), str(ROOT / 'publishing/borges'), str(ROOT / 'publishing/editorial')]
os.environ['HOARD_EVENTS'] = '0'
from hoard_link import agentkit
from gutenberg_hoard.agent_tools import TOOLS
from fusion.search import SEARCH_TOOL
from fusion.project_links import PROJECT_TOOLS

catalog_path = ROOT / 'publishing/fusion/catalog.json'
catalog = [tool for tool in json.loads(catalog_path.read_text(encoding='utf-8')) if tool.get('module') != 'publishing']
catalog += [{**tool, 'module': 'publishing'} for tool in agentkit.tool_catalog(TOOLS)]
catalog_path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
controls = [
    {'name': 'wh_publishing_modules', 'description': 'List Writer library, reading, paperwork and publishing switches and data locations without starting engines.', 'inputSchema': {'type': 'object', 'properties': {}}, 'annotations': {'readOnlyHint': True}},
    {'name': 'wh_publishing_module_set', 'description': 'Explicitly enable/disable one incorporated Writer module. All default OFF. Disabling closes its engine.', 'inputSchema': {'type': 'object', 'properties': {'module': {'type': 'string', 'enum': ['library', 'links', 'paperwork', 'publishing']}, 'enabled': {'type': 'boolean'}, 'automatic': {'type': 'boolean', 'description': 'Explicitly enable background collectors, watches and recovery. OFF by default.'}}, 'required': ['module', 'enabled']}},
]
controls += [{**controls[0], 'name': 'borges_modules'}, {**controls[1], 'name': 'borges_set_module'}]
tools = catalog + [SEARCH_TOOL] + controls + PROJECT_TOOLS
bridge = [{'name': tool['name'], 'description': tool['description'], 'schema': tool['inputSchema'], 'writes': not tool.get('annotations', {}).get('readOnlyHint', False), 'group': 'research', 'timeoutMs': 600000} for tool in tools]
target = ROOT / 'src/services/aiBridge/manifestPublishing.ts'
target.write_text("import type { BridgeTool } from './schema';\n// Native schemas frozen without engine imports at discovery time.\nexport const PUBLISHING_TOOLS: BridgeTool[] = " + json.dumps(bridge, ensure_ascii=False, indent=2) + ';\n', encoding='utf-8')
with target.open('a', encoding='utf-8') as stream:
    stream.write('export const PUBLISHING_ANNOTATIONS: Record<string, { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; [key: string]: unknown }> = ' + json.dumps({tool['name']: {**{key: bool(tool.get('annotations', {}).get(key)) for key in ('readOnlyHint', 'destructiveHint', 'idempotentHint')}, **tool.get('annotations', {})} for tool in tools}, indent=2) + ';\n')
(ROOT / 'publishing/catalog.json').write_text(json.dumps(tools, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(f'{len(catalog)} native tools; {len(bridge)} total publishing tools')
