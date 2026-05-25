import { supabase } from '@/lib/supabase';

type JsonBody = Record<string, unknown> | Array<unknown> | null | undefined;

export async function authedFetch(input: string, init: RequestInit = {}) {
  let { data } = await supabase.auth.getSession();

  // If session is missing or expired, attempt a single refresh before giving up
  if (!data.session?.access_token) {
    const refreshResult = await supabase.auth.refreshSession();
    data = refreshResult.data;
  }

  const accessToken = data.session?.access_token;
  if (!accessToken) {
    throw new Error('Not authenticated — please sign in again.');
  }

  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${accessToken}`);

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
