export async function publishingFetch(input: string | URL, init: RequestInit = {}, module?: string): Promise<Response> {
  const bridge = window.electronAPI?.publishing;
  if (!bridge) throw new Error('This function needs Writer Desktop.');
  const url = new URL(String(input), window.location.origin);
  let path = url.pathname + url.search;
  if (module && !path.startsWith(`/${module}/`)) path = `/${module}${path}`;
  const request = new Request(window.location.origin + path, init);
  const headers = Object.fromEntries(request.headers);
  const bytes = new Uint8Array(await request.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  const reply = await bridge.request(request.method, path, btoa(binary), headers, true);
  const result = Uint8Array.from(atob(reply.base64), char => char.charCodeAt(0));
  return new Response([204, 205, 304].includes(reply.status) || request.method === 'HEAD' ? null : result, { status: reply.status, headers: { ...reply.headers, 'Content-Type': reply.type } });
}

export function publishingUrl(path: string, module?: string): string {
  if (!path.startsWith('/')) return path;
  const parts = path.split('/');
  if (module && !['library', 'links', 'paperwork', 'publishing'].includes(parts[1])) return `wh-publishing://${module}${path}`;
  return `wh-publishing://${parts[1]}/${parts.slice(2).join('/')}`;
}
