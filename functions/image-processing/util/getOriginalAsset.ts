import * as Sentry from '@sentry/serverless';
import { S3_ORIGINAL_IMAGE_BUCKET } from '../constants';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

let client = new S3Client({ region: process.env.AWS_REGION });

export async function getOriginalAsset(originalImagePath) {
  try {
    // Only used for the gcode files cuz theyre too large to return via the lambda itself
    let presignedUrl;
    console.log(
      '[getOriginalAsset] getting original asset ' +
        originalImagePath +
        ' from ' +
        S3_ORIGINAL_IMAGE_BUCKET
    );
    const command = new GetObjectCommand({
      Bucket: S3_ORIGINAL_IMAGE_BUCKET,
      Key: originalImagePath,
    });
    const originalImage = await client.send(command);
    // TODO: can i grab metadata somehow from head

    const contentType = originalImage.ContentType;
    console.log('[getOriginalAsset] original asset content type:' + contentType);
    if (originalImagePath.includes('.stl') || originalImagePath.includes('.gcode')) {
      // need these for the large files that are bigger than the 6MB limit that lambdas allow for returning data
      presignedUrl = await getSignedUrl(client, command, { expiresIn: 3600 });
    }
    return { originalImage, contentType, presignedUrl };
  } catch (error) {
    console.error('[getOriginalAsset] Specified Asset does not exist', originalImagePath);
    console.error(error);
    Sentry.captureException(error, {
      extra: {
        file: originalImagePath,
        bucket: S3_ORIGINAL_IMAGE_BUCKET,
      },
    });
    return null;
  }
}
