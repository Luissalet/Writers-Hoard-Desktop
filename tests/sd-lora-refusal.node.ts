// Unit test of the missing-LoRA predicate; loads no models and starts no server.
import { isMissingLoraRefusal } from './sd-lora-refusal';

function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

// Receipt saved from the real run (sd-server 92a3b73, sd15-q8, vulkan).
const realBody = { error: 'invalid generation parameters' };
const realLog = '[INFO ] stable-diffusion.cpp:3456 - sampling using Euler method\n[ERROR] common.cpp:1868 - invalid lora';

export function testSdLoraRefusal(): string[] {
  check(isMissingLoraRefusal({ httpStatus: 400, error: realBody }, realLog), 'the real 400 receipt was not recognised');
  // Controls: none of these is evidence that lora[] was read.
  check(!isMissingLoraRefusal({ httpStatus: 503, error: realBody }, realLog), '503 was accepted as a LoRA refusal');
  check(!isMissingLoraRefusal({ httpStatus: 500, error: { error: 'internal error' } }, realLog), 'another 5xx was accepted');
  check(!isMissingLoraRefusal({ httpStatus: 400, error: realBody }, '[INFO ] sampling completed'), '400 without the invalid-lora log line was accepted');
  check(!isMissingLoraRefusal({ httpStatus: 400, error: { error: 'prompt is required' } }, realLog), 'a different 400 body was accepted');
  check(!isMissingLoraRefusal({ httpStatus: 400, error: undefined }, realLog), 'a 400 without a body was accepted');
  check(isMissingLoraRefusal({ httpStatus: 400, error: 'invalid generation parameters' }, realLog), 'the unwrapped live shape was not recognised');
  check(!isMissingLoraRefusal({ httpStatus: 503, error: 'invalid generation parameters' }, realLog), '503 with the same text was accepted');
  check(!isMissingLoraRefusal({ httpStatus: 400, error: 'prompt is required' }, realLog), 'another unwrapped 400 text was accepted');
  check(!isMissingLoraRefusal({ status: 'failed', error: 'out of memory' }, realLog), 'a job that failed for another reason was accepted');
  check(!isMissingLoraRefusal({ status: 'failed', error: realBody }, realLog), 'an accepted job (id present) was credited as a synchronous refusal');
  check(!isMissingLoraRefusal({ status: 'completed' }, realLog), 'a completed job was accepted');
  check(!isMissingLoraRefusal({ httpStatus: 200 }, realLog), 'a 200 without id was accepted');
  return ['Missing-LoRA predicate accepts only the real 400 + invalid-lora log, and rejects 503, other 5xx, other 400 bodies, missing log line, failed/completed jobs'];
}
