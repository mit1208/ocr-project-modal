import { NextResponse } from 'next/server';

export async function GET() {
  return new NextResponse(
    JSON.stringify({
      error: 'This endpoint is reserved for a future WebSocket consultation stream implementation.',
      status: 426,
      transport: 'websocket',
    }),
    {
      status: 426,
      headers: {
        'Content-Type': 'application/json',
        Upgrade: 'websocket',
      },
    },
  );
}

export async function POST() {
  return NextResponse.json({
    error: 'The consultation stream WebSocket proxy is not enabled in this deployment yet. Use the consultation session endpoint for the current first-pass implementation.',
  }, { status: 501 });
}
