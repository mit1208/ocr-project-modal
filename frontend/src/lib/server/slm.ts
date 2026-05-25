import { createClient, type User } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';

type JsonRecord = Record<string, unknown>;

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function createSupabaseAuthClient() {
  return createClient(
    getRequiredEnv('NEXT_PUBLIC_SUPABASE_URL'),
    getRequiredEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  );
}

export function createSupabaseServiceClient() {
  return createClient(
    getRequiredEnv('NEXT_PUBLIC_SUPABASE_URL'),
    getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
  );
}

function getBearerToken(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
  if (!authHeader) return null;

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
}

export async function requireAuthenticatedUser(request: NextRequest): Promise<User> {
  const token = getBearerToken(request);
  if (!token) {
    throw new Error('Missing bearer token');
  }

  const supabase = createSupabaseAuthClient();
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    throw new Error('Invalid or expired session');
  }

  return data.user;
}

export function jsonError(message: string, status = 400, extra?: JsonRecord) {
  return NextResponse.json({ error: message, ...(extra || {}) }, { status });
}
