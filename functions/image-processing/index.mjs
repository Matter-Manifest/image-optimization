import Sharp from "sharp";

import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";

import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import * as Sentry from "@sentry/serverless";

const S3_ORIGINAL_IMAGE_BUCKET = process.env.originalImageBucketName;
const S3_TRANSFORMED_IMAGE_BUCKET = process.env.transformedImageBucketName;
const TRANSFORMED_IMAGE_CACHE_TTL = process.env.transformedImageCacheTTL || "0";
const SECRET_KEY = process.env.secretKey;
const shouldValidate = false;

Sentry.AWSLambda.init({
  dsn: "https://dc3fa9fd27fdf0cb59e7ef827efaba34@o4505573403459584.ingest.sentry.io/4505848318590976",
  integrations: [],
  // Performance Monitoring
  tracesSampleRate: 0.1, // Capture 100% of the transactions, reduce in production!
  // Set sampling rate for profiling - this is relative to tracesSampleRate
  profilesSampleRate: 0.1, // Capture 100% of the transactions, reduce in production!
});

let client = new S3Client({ region: process.env.AWS_REGION });

async function getOriginalImage(originalImagePath) {
  try {
    // Only used for the gcode files cuz theyre too large to return via the lambda itself
    let presignedUrl;
    console.log(
      "[getOriginalImage] getting original image " +
        originalImagePath +
        " from " +
        S3_ORIGINAL_IMAGE_BUCKET
    );
    const command = new GetObjectCommand({
      Bucket: S3_ORIGINAL_IMAGE_BUCKET,
      Key: originalImagePath,
    });
    const originalImage = await client.send(command);
    // TODO: can i grab metadata somehow from head
    
    const contentType = originalImage.ContentType;
    console.log(
      "[getOriginalImage] original image content type:" + contentType
    );
    if (originalImagePath.includes('.stl')  || originalImagePath.includes('.gcode')) {
      // need these for the large files that are bigger than the 6MB limit that lambdas allow for returning data
      presignedUrl = await getSignedUrl(client, command, { expiresIn: 3600 });
    }
    return { originalImage, contentType, presignedUrl };
  } catch (error) {
    console.error(
      "[getOriginalImage] Specified Image does not exist",
      originalImagePath
    );
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

const streamToBuffer = (stream) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });

async function transformImage({
  originalImage,
  operationsJSON,
  contentType,
  originalImagePath,
}) {
  try {
    console.log("[transformImage] beginning transform");
    const bufferData = await streamToBuffer(originalImage.Body);
    let transformedImage = Sharp(bufferData, {
      failOn: "none",
      // make sure gifs and animated webp work
      animated: true,
    });
    // Get image orientation to rotate if needed
    const imageMetadata = await transformedImage.metadata();

    // check if resizing is requested
    var resizingOptions = {
      width: undefined,
      height: undefined,
    };
    if (operationsJSON["width"])
      resizingOptions.width = parseInt(operationsJSON["width"]);
    if (operationsJSON["height"])
      resizingOptions.height = parseInt(operationsJSON["height"]);
    if (resizingOptions)
      transformedImage = transformedImage.resize(resizingOptions);
    if (imageMetadata.orientation) transformedImage = transformedImage.rotate();
    // check if formatting is requested
    if (operationsJSON["format"]) {
      var isLossy = false;
      switch (operationsJSON["format"]) {
        case "jpeg":
          contentType = "image/jpeg";
          isLossy = true;
          break;
        case "svg":
          contentType = "image/svg+xml";
          break;
        case "gif":
          contentType = "image/gif";
          break;
        case "webp":
          contentType = "image/webp";
          isLossy = true;
          break;
        case "png":
          contentType = "image/png";
          break;
        case "avif":
          contentType = "image/avif";
          isLossy = true;
          break;
        default:
          contentType = "image/jpeg";
          isLossy = true;
      }

      if (operationsJSON["quality"] && isLossy) {
        transformedImage = transformedImage.toFormat(operationsJSON["format"], {
          quality: parseInt(operationsJSON["quality"]),
        });
      } else
        transformedImage = transformedImage.toFormat(operationsJSON["format"]);
    }
    const bufferTransformedImage = await transformedImage.toBuffer();
    return bufferTransformedImage;
  } catch (error) {
    console.error(
      "[transformImage] Failed to transform image",
      originalImagePath
    );
    console.error(error);
    Sentry.captureException(error, {
      extra: {
        file: originalImagePath,
      },
    });
    return null;
  }
}

async function uploadTransformedImage({
  transformedImage,
  originalImagePath,
  operationsPrefix,
  contentType,
}) {
  console.log("[uploadTransformedImage] Uploading transformed image");
  if (S3_TRANSFORMED_IMAGE_BUCKET) {
    try {
      const command = new PutObjectCommand({
        Body: transformedImage,
        Bucket: S3_TRANSFORMED_IMAGE_BUCKET,
        Key: originalImagePath + "/" + operationsPrefix,
        ContentType: contentType,

        Metadata: {
          "cache-control": TRANSFORMED_IMAGE_CACHE_TTL,
        },
      });
      await client.send(command);
    } catch (error) {
      console.error(error);
      console.error(
        "[uploadTransformedImage] Failed to upload transformed image",
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

const lambdaCallback = async (event) => {
  if (shouldValidate) {
    // First validate if the request is coming from CloudFront
    if (
      !event.headers["x-origin-secret-header"] ||
      !(event.headers["x-origin-secret-header"] === SECRET_KEY)
    ) {
      console.error("Incoming request is NOT from Cloudfront");
      return { message: "Request unauthorized", statusCode: 401 };
    }
    // Validate if this is a GET request
    if (
      !event.requestContext?.http ||
      !(event.requestContext.http.method === "GET")
    ) {
      return { message: "Only GET method is supported", statusCode: 400 };
    }
  }

  // An example of expected path is /images/rio/1.jpeg/format=auto,width=100 or /images/rio/1.jpeg/original where /images/rio/1.jpeg is the path of the original image
  var imagePathArray = event.requestContext.http.path.split("/");
  // get the requested image operations
  var operationsPrefix = imagePathArray.pop();
  // get the original image path images/rio/1.jpg
  imagePathArray.shift();
  var originalImagePath = imagePathArray.join("/");

  console.log("[handler] New request for: " + originalImagePath);

  const originalImageResponse = await getOriginalImage(originalImagePath);
  if (!originalImageResponse) {
    return { statusCode: 404 };
  }
  const { originalImage, contentType, presignedUrl } = originalImageResponse;

  console.log("[handler] Content type: " + contentType);

  //  execute the requested operations
  const operationsJSON = Object.fromEntries(
    operationsPrefix.split(",").map((operation) => operation.split("="))
  );

  // To handle the .gcode and .stls
  let shouldTransform = !originalImagePath.includes('.stl') && !originalImagePath.includes('.gcode');

  if (shouldTransform) {
    const transformedImage = await transformImage({
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
    await uploadTransformedImage({
      transformedImage,
      originalImagePath,
      operationsPrefix,
      contentType,
    });
    const body = transformedImage.toString("base64");
    // return transformed image
    return {
      statusCode: 200,
      body,
      isBase64Encoded: true,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": TRANSFORMED_IMAGE_CACHE_TTL,
      },
    };
  } else {
    console.log("[handler] presigned url " + presignedUrl);
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
      error: 'Missing presigned'
    }

  }
};

export const handler = Sentry.AWSLambda.wrapHandler(lambdaCallback);
