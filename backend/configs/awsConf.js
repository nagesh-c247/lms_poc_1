const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const AWS = require("aws-sdk");

const s3 = new AWS.S3({
  region: process.env.AWS_REGION,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  httpOptions: {
    timeout: 30000, // 30s timeout for S3 requests
    connectTimeout: 5000,
  },
  maxRetries: 1, // Retry up to 3 times
  retryDelayOptions: { base: 200 }, // 200ms base delay
});

module.exports = s3;
