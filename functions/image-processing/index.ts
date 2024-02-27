import * as Sentry from '@sentry/serverless';
import { SECRET_KEY, TRANSFORMED_IMAGE_CACHE_TTL } from './constants';
import { getOriginalAsset } from './util/getOriginalAsset';
import { streamToBuffer } from './util/streamToBuffer';
import { transformAsset } from './util/transformAsset';
import { uploadTransformedAsset } from './util/uploadTransformAsset';

const shouldValidate = process.env.NODE_ENV === 'production';

Sentry.AWSLambda.init({
  dsn: 'https://dc3fa9fd27fdf0cb59e7ef827efaba34@o4505573403459584.ingest.sentry.io/4505848318590976',
  integrations: [],
  // Performance Monitoring
  tracesSampleRate: 0.1, // Capture 100% of the transactions, reduce in production!
  // Set sampling rate for profiling - this is relative to tracesSampleRate
  profilesSampleRate: 0.1, // Capture 100% of the transactions, reduce in production!
  environment: process.env.ENV_NAME,
  serverName: 'imageOptimization',
});

const lambdaCallback = async (event) => {
  if (shouldValidate) {
    // First validate if the request is coming from CloudFront
    if (
      !event.headers['x-origin-secret-header'] ||
      !(event.headers['x-origin-secret-header'] === SECRET_KEY)
    ) {
      console.error('Incoming request is NOT from Cloudfront');
      return { message: 'Request unauthorized', statusCode: 401 };
    }
    // Validate if this is a GET request
    if (!event.requestContext?.http || !(event.requestContext.http.method === 'GET')) {
      return { message: 'Only GET method is supported', statusCode: 400 };
    }
  }

  // An example of expected path is /images/rio/1.jpeg/format=auto,width=100 or /images/rio/1.jpeg/original where /images/rio/1.jpeg is the path of the original image
  var imagePathArray = event.requestContext.http.path.split('/');
  // get the requested image operations
  var operationsPrefix = imagePathArray.pop();
  // get the original image path images/rio/1.jpg
  imagePathArray.shift();
  var originalImagePath = imagePathArray.join('/');

  console.log(`[Entry] New request for: ${originalImagePath}`, {
    operationsPrefix,
  });

  const originalImageResponse = await getOriginalAsset(originalImagePath);
  if (!originalImageResponse) {
    return { statusCode: 404 };
  }
  const { originalImage, contentType, presignedUrl } = originalImageResponse;

  console.log('[Entry] Content type: ' + contentType);

  //  execute the requested operations
  const operationsJSON = Object.fromEntries(
    operationsPrefix.split(',').map((operation) => operation.split('='))
  );

  // To handle the .gcode and .stls
  let shouldTransform =
    !originalImagePath.includes('.stl') && !originalImagePath.includes('.gcode');

  if (['text/plain'].includes(contentType as string)) {
    return {
      statusCode: 200,
      body: ((await streamToBuffer(originalImage.Body)) as Buffer).toString(),
      headers: {
        'Content-Type': contentType,
      },
    };
  } else if (shouldTransform) {
    const transformedImage = await transformAsset({
      originalImage,
      operationsJSON,
      contentType,
      originalImagePath,
    });
    if (!transformedImage) {
      return {
        statusCode: 500,
      };
    }
    // upload transformed image back to S3 if required in the architecture
    await uploadTransformedAsset({
      transformedImage,
      originalImagePath,
      operationsPrefix,
      contentType,
    });
    const body = transformedImage.toString('base64');
    // return transformed image
    return {
      statusCode: 200,
      body,
      isBase64Encoded: true,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': TRANSFORMED_IMAGE_CACHE_TTL,
      },
    };
  } else {
    console.log('[Entry] presigned url ' + presignedUrl);
    if (presignedUrl) {
      return {
        statusCode: 301,
        headers: {
          location: presignedUrl,
        },
      };
    }
    return {
      statusCode: 500,
      error: 'Missing presigned',
    };
  }
};

exports.handler = Sentry.AWSLambda.wrapHandler(lambdaCallback);
