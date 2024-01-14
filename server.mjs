import http from "http";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import Sharp from "sharp";

import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

let client = new S3Client({ region: process.env.AWS_REGION });

const S3_ORIGINAL_IMAGE_BUCKET = "public-assets-matter-manifest";

const host = "localhost";
const port = 8000;

const streamToBuffer = (stream) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });

  /**
   * THIS IS FOR TESTING
   */
const requestListener = async function (req, res) {
  // console.log(await client.config.credentials());
  const command = new GetObjectCommand({
    Bucket: S3_ORIGINAL_IMAGE_BUCKET,
    Key: "home/landing-page-learn.png",
  });
  const originalImage = await client.send(command);
  const bufferData = await streamToBuffer(originalImage.Body);
  let transformedImage = Sharp(bufferData, {
    failOn: "none",
    // make sure gifs and animated webp work
    animated: true,
  });
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
  // return bufferTransformedImage;
  // const url = await getSignedUrl(client, command, { expiresIn: 3600 });
  res.end(bufferTransformedImage.toString("base64"));
};
const server = http.createServer(requestListener);

server.listen(port, host, () => {
  console.log(`Server is running on http://${host}:${port}`);
});
