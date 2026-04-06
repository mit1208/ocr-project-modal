import { supabase } from '@/lib/supabase';

type JsonBody = Record<string, unknown> | Array<unknown> | null | undefined;

export async function authedFetch(input: string, init: RequestInit = {}) {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  const headers = new Headers(init.headers || {});

  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  return fetch(input, {
    ...init,
    headers,
  });
}

export async function authedFetchJson<T = unknown>(input: string, init: RequestInit = {}): Promise<T> {
  const response = await authedFetch(input, init);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const errorMessage = payload?.error || payload?.message || `Request failed with status ${response.status}`;
    throw new Error(errorMessage);
  }

  return payload as T;
}

export function jsonRequest(body?: JsonBody): RequestInit {
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body || {}),
  };
}
