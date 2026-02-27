import { NextResponse } from 'next/server';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createClient } from '@supabase/supabase-js';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const fileId = searchParams.get('file_id');

    if (!fileId) {
        return NextResponse.json({ error: 'file_id is required' }, { status: 400 });
    }

    // 1. Initialize Supabase with service role to lookup document owner
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 2. Lookup the document to find the correct S3 path (which uses the uploader's userId)
    console.log(`[pdf-url] Looking up owner for file_id: ${fileId}`);
    const { data: doc, error: dbError } = await supabase
        .from('documents')
        .select('user_id, is_public')
        .eq('file_id', fileId)
        .single();

    if (dbError || !doc) {
        console.error(`[pdf-url] Document lookup failed: ${dbError?.message || 'Not found'}`);
        return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    // 3. Construct S3 Path
    const ownerId = doc.user_id;
    const bucketName = process.env.S3_BUCKET || 'ocr-pipeline-uploads-bucket';
    const objectKey = `uploads/${ownerId}/${fileId}`;

    const s3Client = new S3Client({
        region: process.env.AWS_REGION || 'us-east-1',
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
        },
    });

    try {
        const command = new GetObjectCommand({
            Bucket: bucketName,
            Key: objectKey,
        });

        // URL expires in 1 hour
        const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
        return NextResponse.json({ url });
    } catch (error: any) {
        console.error('Error generating GET presigned URL:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
