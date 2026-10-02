// Typed desktop boundary for the unmodified upstream JavaScript modules.
// @ts-expect-error Upstream ships pure JavaScript without TypeScript declarations.
import * as media from '../vendor/hoard-commons/media.js';
// @ts-expect-error Upstream ships pure JavaScript without TypeScript declarations.
import * as web from '../vendor/hoard-commons/web.js';

export interface ToolCommand { cmd: string; args: string[] }
export interface ToolResult {
  found: boolean;
  how: string | null;
  path: string | null;
  version: string | null;
  command: ToolCommand | null;
  error: string | null;
}
export interface ToolOptions {
  env?: NodeJS.ProcessEnv;
  extraDirs?: string[];
  refresh?: boolean;
}
export const resolveTool = media.resolveTool as (tool: string, options?: ToolOptions) => Promise<ToolResult>;
export const runProcess = media.runProcess as (
  command: ToolCommand, args: string[], options?: {
    signal?: AbortSignal; env?: NodeJS.ProcessEnv; timeoutMs?: number;
    onSpawn?: (child: import('node:child_process').ChildProcess) => void;
  },
) => Promise<{ code: number | null; stdout: string; stderr: string }>;
export const buildYtdlpArgs = media.buildYtdlpArgs as (options: {
  url: string; format: 'video' | 'audio'; dir: string; hasFfmpeg: boolean;
  ffmpegPath?: string | null; cookie?: { type: 'file'; path: string } | null;
  extra?: string[]; nodePath?: string | null; ytdlpVersion?: string | null;
}) => string[];
export const detectMediaPlatform = media.detectPlatform as (url: string, options?: { other: string }) => string;
export const killTree = media.killTree as (pid: number) => Promise<boolean>;
export const fileKind = media.fileKind as (name: string) => 'video' | 'audio' | 'image' | 'other';
export const isPartialMedia = (name: string): boolean => (media.PARTIAL as RegExp).test(name);
export interface PublicPolicyOptions {
  lookup?: (host: string, port: number) => string[] | Promise<string[]>;
}
export const checkPublicUrl = (url: string, options?: PublicPolicyOptions): Promise<string | null> =>
  (web.checkUrl as (url: string, options: unknown) => Promise<string | null>)(url, {
    ...options, profile: 'public', maxLen: 8192,
  });
