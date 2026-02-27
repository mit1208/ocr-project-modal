import { NextResponse } from 'next/server';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: Request) {
    try {
        const { filename, contentType, userId, isPublic } = await request.json();

        if (!filename || !contentType) {
            return NextResponse.json(
                { error: 'Filename and contentType are required' },
                { status: 400 }
            );
        }

        if (!userId) {
            return NextResponse.json(
                { error: 'User must be authenticated to upload documents' },
                { status: 401 }
            );
        }

        const s3Client = new S3Client({
            region: process.env.AWS_REGION || 'us-east-1',
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
            },
        });

        const bucketName = process.env.S3_BUCKET || 'ocr-uploads-bucket';
        const uniqueId = Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
        const cleanFileName = filename.replace(/\s+/g, '-');

        let objectKey = `uploads/${uniqueId}-${cleanFileName}`;
        if (userId) {
            objectKey = `uploads/${userId}/${uniqueId}-${cleanFileName}`;
        }

        const fileId = `${uniqueId}-${cleanFileName}`;
        const caseId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 10);

        // Pre-create the document record in Supabase using the service role key.
        // This way the Lambda can look up metadata from Supabase instead of
        // relying on S3 object metadata (which requires signed presigned headers
        // and causes "Access Denied" errors from browser CORS/header mismatches).
        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL || '',
            process.env.SUPABASE_SERVICE_ROLE_KEY || ''
        );

        const { error: dbError } = await supabase.from('documents').upsert({
            file_id: fileId,
            filename: cleanFileName,
            is_public: isPublic || false,
            case_id: caseId,
            user_id: userId,
        }, { onConflict: 'file_id' });

        if (dbError) {
            console.error('Failed to pre-create document record:', dbError);
            return NextResponse.json(
                { error: 'Failed to initialize document record' },
                { status: 500 }
            );
        }

        // Generate a clean presigned URL — no metadata headers required.
        // The pdf_split Lambda will read metadata from the Supabase documents table.
        const command = new PutObjectCommand({
            Bucket: bucketName,
            Key: objectKey,
            ContentType: contentType,
        });

        const uploadUrl = await getSignedUrl(s3Client, command, {
            expiresIn: 900,
        });

        return NextResponse.json({
            uploadUrl,
            objectKey,
            bucket: bucketName,
            fileId,
            caseId,
        });
    } catch (error: any) {
        console.error('Error generating presigned URL:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
