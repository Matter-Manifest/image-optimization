import http from "http";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

let client = new S3Client({ region: process.env.AWS_REGION });

const S3_ORIGINAL_IMAGE_BUCKET = "public-assets-matter-manifest";

const host = "localhost";
const port = 8000;
const requestListener = async function (req, res) {
  // console.log(await client.config.credentials());
  const command = new GetObjectCommand({
    Bucket: S3_ORIGINAL_IMAGE_BUCKET,
    Key: "catalog/Friendly_Articulated_Slug/Ender_3_Pro/PLA/Slug_v1.1_ezbrim_3h26m_0.16mm_205C_PLA_ENDER3PRO.gcode",
  });
  const url = await getSignedUrl(client, command, { expiresIn: 3600 });
  res.end(url);
};
const server = http.createServer(requestListener);

server.listen(port, host, () => {
  console.log(`Server is running on http://${host}:${port}`);
});
