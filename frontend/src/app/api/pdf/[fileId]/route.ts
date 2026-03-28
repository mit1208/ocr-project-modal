import { NextResponse } from 'next/server';
import {
    GetObjectCommand,
    HeadObjectCommand,
    S3Client,
} from '@aws-sdk/client-s3';
import type { S3ServiceException } from '@aws-sdk/client-s3';
import { createClient } from '@supabase/supabase-js';

const s3Client = new S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    },
});

function getSupabaseAdmin() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    );
}

async function resolveObjectLocation(fileId: string) {
    const supabase = getSupabaseAdmin();
    const { data: doc, error } = await supabase
        .from('documents')
        .select('user_id')
        .eq('file_id', fileId)
        .single();

    if (error || !doc?.user_id) {
        return null;
    }

    return {
        bucket: process.env.S3_BUCKET || 'ocr-pipeline-uploads-bucket',
        key: `uploads/${doc.user_id}/${fileId}`,
    };
}

function buildPdfHeaders(init?: HeadersInit) {
    const headers = new Headers(init);
    if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/pdf');
    }
    headers.set('Cache-Control', 'private, max-age=300');
    headers.set('Access-Control-Allow-Origin', '*');
    return headers;
}

export async function HEAD(
    _request: Request,
    { params }: { params: Promise<{ fileId: string }> }
) {
    const { fileId } = await params;
    const objectLocation = await resolveObjectLocation(fileId);

    if (!objectLocation) {
        return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    try {
        const metadata = await s3Client.send(new HeadObjectCommand({
            Bucket: objectLocation.bucket,
            Key: objectLocation.key,
        }));

        const headers = buildPdfHeaders();
        if (metadata.ContentLength !== undefined) {
            headers.set('Content-Length', metadata.ContentLength.toString());
        }
        if (metadata.ETag) {
            headers.set('ETag', metadata.ETag);
        }
        if (metadata.AcceptRanges) {
            headers.set('Accept-Ranges', metadata.AcceptRanges);
        }

        return new NextResponse(null, { status: 200, headers });
    } catch (error: unknown) {
        console.error('[api/pdf] HEAD failed:', error);
        const status = (error as Partial<S3ServiceException>)?.$metadata?.httpStatusCode === 404 ? 404 : 500;
        return NextResponse.json({ error: 'Failed to load PDF metadata' }, { status });
    }
}

export async function GET(
    request: Request,
    { params }: { params: Promise<{ fileId: string }> }
) {
    const { fileId } = await params;
    const objectLocation = await resolveObjectLocation(fileId);

    if (!objectLocation) {
        return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    const range = request.headers.get('range') || undefined;

    try {
        const response = await s3Client.send(new GetObjectCommand({
            Bucket: objectLocation.bucket,
            Key: objectLocation.key,
            Range: range,
        }));

        if (!response.Body) {
            return NextResponse.json({ error: 'PDF body missing' }, { status: 500 });
        }

        const headers = buildPdfHeaders();
        if (response.ContentLength !== undefined) {
            headers.set('Content-Length', response.ContentLength.toString());
        }
        if (response.ContentRange) {
            headers.set('Content-Range', response.ContentRange);
        }
        if (response.AcceptRanges) {
            headers.set('Accept-Ranges', response.AcceptRanges);
        }
        if (response.ETag) {
            headers.set('ETag', response.ETag);
        }

        return new NextResponse(response.Body.transformToWebStream(), {
            status: range ? 206 : 200,
            headers,
        });
    } catch (error: unknown) {
        console.error('[api/pdf] GET failed:', error);
        const status = (error as Partial<S3ServiceException>)?.$metadata?.httpStatusCode === 404 ? 404 : 500;
        return NextResponse.json({ error: 'Failed to stream PDF' }, { status });
    }
}
