import { NextRequest, NextResponse } from 'next/server';
import { getUserSlmStatus, jsonError, requireAuthenticatedUser } from '@/lib/server/slm';

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuthenticatedUser(request);
    const status = await getUserSlmStatus(user.id);
    return NextResponse.json(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error';
    const status = message === 'Missing bearer token' || message === 'Invalid or expired session' ? 401 : 500;
    return jsonError(message, status);
  }
}
