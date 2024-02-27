import { streamToBuffer } from './streamToBuffer';
import Sharp from 'sharp';
import * as Sentry from '@sentry/serverless';

export async function transformAsset({
  originalImage,
  operationsJSON,
  contentType,
  originalImagePath,
}) {
  try {
    console.log('[transformAsset] beginning transform');
    const bufferData = await streamToBuffer(originalImage.Body);
    let transformedImage = Sharp(bufferData as Buffer, {
      failOn: 'none',
      // make sure gifs and animated webp work
      animated: true,
    });
    // Get image orientation to rotate if needed
    const imageMetadata = await transformedImage.metadata();
    // check if resizing is requested
    var resizingOptions: Record<string, any> = {
      width: undefined,
      height: undefined,
    };
    if (operationsJSON['width']) resizingOptions.width = parseInt(operationsJSON['width']);
    if (operationsJSON['height']) resizingOptions.height = parseInt(operationsJSON['height']);
    if (resizingOptions) transformedImage = transformedImage.resize(resizingOptions);
    if (imageMetadata.orientation) transformedImage = transformedImage.rotate();
    // check if formatting is requested
    if (operationsJSON['format']) {
      var isLossy = false;
      switch (operationsJSON['format']) {
        case 'jpeg':
          contentType = 'image/jpeg';
          isLossy = true;
          break;
        case 'svg':
          contentType = 'image/svg+xml';
          break;
        case 'gif':
          contentType = 'image/gif';
          break;
        case 'webp':
          contentType = 'image/webp';
          isLossy = true;
          break;
        case 'png':
          contentType = 'image/png';
          break;
        case 'avif':
          contentType = 'image/avif';
          isLossy = true;
          break;
        default:
          contentType = 'image/jpeg';
          isLossy = true;
      }
      if (operationsJSON['quality'] && isLossy) {
        transformedImage = transformedImage.toFormat(operationsJSON['format'], {
          quality: parseInt(operationsJSON['quality']),
        });
      } else transformedImage = transformedImage.toFormat(operationsJSON['format']);
    }
    const bufferTransformedImage = await transformedImage.toBuffer();
    return bufferTransformedImage;
  } catch (error) {
    console.error('[transformAsset] Failed to transform image', originalImagePath);
    console.error(error);
    Sentry.captureException(error, {
      extra: {
        file: originalImagePath,
      },
    });
    return null;
  }
}
