import { NextResponse } from 'next/server';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export async function POST(request: Request) {
    try {
        const { filename, contentType, userId } = await request.json();

        if (!filename || !contentType) {
            return NextResponse.json(
                { error: 'Filename and contentType are required' },
                { status: 400 }
            );
        }

        const s3Client = new S3Client({
            region: process.env.AWS_REGION || 'us-east-1',
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
            },
        });

        const bucketName = process.env.S3_BUCKET || 'my-databricks-ocr-uploads';
        // Use timestamp to prevent overwrites, or just a random string
        const uniqueId = Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
        // Remove spaces from filename
        const cleanFileName = filename.replace(/\s+/g, '-');

        let objectKey = `uploads/${uniqueId}-${cleanFileName}`;
        if (userId) {
            objectKey = `uploads/${userId}/${uniqueId}-${cleanFileName}`;
        }

        const command = new PutObjectCommand({
            Bucket: bucketName,
            Key: objectKey,
            ContentType: contentType,
        });

        // URL expires in 15 minutes
        const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 900 });

        // Generate a case ID for this specific upload
        const caseId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 10);

        return NextResponse.json({
            uploadUrl,
            objectKey,
            bucket: bucketName,
            fileId: `${uniqueId}-${cleanFileName}`,
            caseId: caseId
        });
    } catch (error: any) {
        console.error('Error generating presigned URL:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
