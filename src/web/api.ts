export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed: ${response.status}`);
  return payload as T;
}
