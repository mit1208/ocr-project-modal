import { NextRequest, NextResponse } from 'next/server';
import { getUserSlmModels, jsonError, requireAuthenticatedUser } from '@/lib/server/slm';

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuthenticatedUser(request);
    const models = await getUserSlmModels(user.id);
    return NextResponse.json({ models });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error';
    const status = message === 'Missing bearer token' || message === 'Invalid or expired session' ? 401 : 500;
    return jsonError(message, status);
  }
}
