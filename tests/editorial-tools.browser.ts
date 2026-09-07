import { testEditorialProfile } from './editorial-profile.browser';
import { testEditorialBridge } from './editorial-bridge.browser';
import { testResearchEvidence } from './research-evidence.browser';
import { testWritingWorkflows } from './writing-workflows.browser';

export async function testEditorialTools(): Promise<string[]> {
  return [...await testEditorialProfile(), ...await testResearchEvidence(), ...await testWritingWorkflows(), ...await testEditorialBridge()];
}
