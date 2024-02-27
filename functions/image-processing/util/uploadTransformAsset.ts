import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { S3_TRANSFORMED_IMAGE_BUCKET, TRANSFORMED_IMAGE_CACHE_TTL } from '../constants';
import * as Sentry from '@sentry/serverless';

let client = new S3Client({ region: process.env.AWS_REGION });

export async function uploadTransformedAsset({
  transformedImage,
  originalImagePath,
  operationsPrefix,
  contentType,
}) {
  console.log('[uploadTransformedAsset] Uploading transformed asset');
  if (S3_TRANSFORMED_IMAGE_BUCKET) {
    try {
      const command = new PutObjectCommand({
        Body: transformedImage,
        Bucket: S3_TRANSFORMED_IMAGE_BUCKET,
        Key: originalImagePath + '/' + operationsPrefix,
        ContentType: contentType,

        Metadata: {
          'cache-control': TRANSFORMED_IMAGE_CACHE_TTL,
        },
      });
      await client.send(command);
    } catch (error) {
      console.error(error);
      console.error(
        '[uploadTransformedAsset] Failed to upload transformed image',
        originalImagePath
      );
      Sentry.captureException(error, {
        extra: {
          file: originalImagePath,
        },
      });
      return null;
    }
  }
  return true;
}
