let runtime: string | undefined;

/** Lazy local code, compiled from the same viewport used by the editor. */
export async function prepareModelReaderRuntime(): Promise<void> {
  runtime ??= (await import('./runtime.generated.txt')).default;
}

export function modelReaderExportScript(html: string, nonce: string): string {
  if (!html.includes('data-wh-model-reader="true"')) return '';
  if (!runtime) throw new Error('model_runtime_not_prepared');
  return `<script nonce="${nonce}">${runtime.replace(/<\/script/gi,'<\\/script')}</script>`;
}
