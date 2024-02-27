import lambdaLocal = require('lambda-local');
import 'dotenv/config';

const jsonPayload = {
  body: JSON.stringify({}),
  messageAttributes: JSON.stringify({}),

  requestContext: {
    http: {
      // path: '/products/ef0533e0-e8c3-4aeb-9588-4d04b91bb66c/images/8wWyQ6_OwlCookieCutter8_PushEdge2_ENDER_3_PRO.png/format=webp,width=991',
      path: '/robots.txt/original',
    },
  },
  messageId: 'aa5aa707-8ccb-4b4e-8bb1-580809f8cf71',
};

lambdaLocal
  .execute({
    event: jsonPayload,
    lambdaPath: './../../functions/image-processing/index.js',
    profilePath: '~/.aws/credentials',
    profileName: 'matter-manifest',
    timeoutMs: 3000,
    esm: true,
    envFile: '../../.env',
  })
  .then(function (done) {
    console.log(done);
  })
  .catch(function () {});
