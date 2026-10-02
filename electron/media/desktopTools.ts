import path from 'node:path';
import type { ToolOptions } from './commons';

/** Desktop packaging remains a fallback behind explicit HoardLink overrides. */
export function desktopToolOptions(context: {
  isPackaged: boolean; appPath: string; resourcesPath: string;
  ffmpegPath: string | null; env?: NodeJS.ProcessEnv;
}): ToolOptions {
  const env: NodeJS.ProcessEnv = { ...(context.env ?? process.env), ELECTRON_RUN_AS_NODE: '1' };
  const ffmpeg = context.ffmpegPath?.replace('app.asar', 'app.asar.unpacked');
  if (ffmpeg && !env.HOARD_FFMPEG) env.HOARD_FFMPEG = ffmpeg;
  return {
    env,
    extraDirs: [context.isPackaged
      ? path.join(context.resourcesPath, 'bin')
      : path.join(context.appPath, 'resources', 'bin')],
  };
}
