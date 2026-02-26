import { NextResponse } from 'next/server';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const fileId = searchParams.get('file_id');
    const userId = searchParams.get('user_id');

    if (!fileId) {
        return NextResponse.json({ error: 'file_id is required' }, { status: 400 });
    }

    const s3Client = new S3Client({
        region: process.env.AWS_REGION || 'us-east-1',
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
        },
    });

    const bucketName = process.env.S3_BUCKET || 'ocr-uploads-bucket';
    let objectKey = `uploads/${fileId}`;
    if (userId) {
        objectKey = `uploads/${userId}/${fileId}`;
    }

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
