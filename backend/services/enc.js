const { spawn } = require("child_process");
const path = require("path");
const os = require("os");
const fs = require("fs/promises");
const fssync = require("fs");
const ContentABR = require("../models/contentABRmodel");
const s3 = require("../configs/awsConf");
const { getConsumer } = require("../configs/kafka");
const consumer = getConsumer("abr-group");
const mongoose = require('mongoose');

const bucketNameABR = 'lms-poc-abr-c247';

async function downloadFromS3(key, destPath) {
  return new Promise((resolve, reject) => {
    try {
      console.log("Downloading from S3 ->", bucketNameABR, key);
      const file = fssync.createWriteStream(destPath);
      const s3Stream = s3
        .getObject({ Bucket: bucketNameABR, Key: key })
        .createReadStream();

      s3Stream.on("error", async (err) => {
        console.error("❌ S3 stream error:", err.code, err.message);
        await fs.unlink(destPath).catch(() => {});
        reject(err);
      });

      file.on("error", async (err) => {
        console.error("❌ File write error:", err.message);
        await fs.unlink(destPath).catch(() => {});
        reject(err);
      });

      file.on("finish", () => {
        console.log("✅ Download complete:", destPath);
        resolve();
      });

      s3Stream.pipe(file);
    } catch (err) {
      console.error("❌ Unexpected error in downloadFromS3:", err.message);
      reject(err);
    }
  });
}

async function uploadFileToS3(localPath, key) {
  const fileBuffer = await fs.readFile(localPath);
  await s3
    .putObject({
      Bucket: bucketNameABR,
      Key: key,
      Body: fileBuffer,
    })
    .promise();
  console.log(`✅ Uploaded to S3: ${key}`);
}

async function encodeVideo(contentId, inputFile) {
  const outputDir = path.join(os.tmpdir(), `encode-${contentId}-${Date.now()}`);
  await fs.mkdir(outputDir, { recursive: true });

  const renditions = [
    { name: "1080p", width: 1920, height: 1080, bitrate: "5000k", bandwidth: "5000000" },
    { name: "720p", width: 1280, height: 720, bitrate: "3000k", bandwidth: "3000000" },
    { name: "480p", width: 854, height: 480, bitrate: "1500k", bandwidth: "1500000" },
  ];

  const outputs = [];

  for (const r of renditions) {
    const renditionDir = path.join(outputDir, r.name);
    await fs.mkdir(renditionDir, { recursive: true });
    const hlsPath = path.join(renditionDir, `${r.name}.m3u8`);
    const dashPath = path.join(renditionDir, `${r.name}.mpd`);

    await new Promise((resolve, reject) => {
      const ff = spawn("ffmpeg", [
        "-i", inputFile,
        "-vf", `scale=${r.width}:${r.height}:force_original_aspect_ratio=decrease,pad=${r.width}:${r.height}:(ow-iw)/2:(oh-ih)/2`,
        "-b:v", r.bitrate,
        "-c:v", "libx264",
        "-c:a", "aac",
        "-f", "hls",
        "-hls_time", "6",
        "-hls_segment_type", "fmp4",
        "-hls_segment_filename", path.join(renditionDir, "segment_%04d.m4s"),
        hlsPath,
        "-f", "dash",
        "-use_template", "1",
        "-use_timeline", "1",
        "-seg_duration", "6",
        "-init_seg_name", "init.mp4",
        "-media_seg_name", "segment_$Number%04d$.m4s",
        dashPath,
      ]);

      let errorOutput = "";
      ff.stderr.on("data", (data) => {
        errorOutput += data;
        console.error(`FFmpeg stderr (${r.name}): ${data}`);
      });
      ff.on("exit", (code) => {
        if (code === 0) {
          console.log(`✅ Encoding complete for ${r.name}`);
          resolve();
        } else {
          reject(new Error(`FFmpeg failed for ${r.name}: ${errorOutput}`));
        }
      });
    });

    outputs.push({ rendition: r.name, hlsPath, dashPath, renditionDir });
  }

  // Generate master HLS playlist
  const masterHls = `#EXTM3U
#EXT-X-VERSION:6
${renditions
  .map(
    (r) => `#EXT-X-STREAM-INF:BANDWIDTH=${r.bandwidth},RESOLUTION=${r.width}x${r.height}
outputs/${contentId}/${r.name}/${r.name}.m3u8`
  )
  .join("\n")}`;
  const masterHlsPath = path.join(outputDir, "master.m3u8");
  await fs.writeFile(masterHlsPath, masterHls);

  // Use 1080p rendition's .mpd as master DASH manifest
  const masterDashPath = outputs.find((o) => o.rendition === "1080p").dashPath;

  return { outputDir, outputs, masterHlsPath, masterDashPath };
}

async function runWorker() {
  try {
    await mongoose.connect("mongodb://localhost:27017/lms", { connectTimeoutMS: 10000 });
    await consumer.connect();
    await consumer.subscribe({ topic: "video-encoding" });

    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        let tempFiles = [];
        try {
          const { contentId, originalS3Key, title } = JSON.parse(message.value.toString());
          console.log("Processing video:", contentId, originalS3Key);

          // Validate contentId
          const content = await ContentABR.findById(contentId);
          if (!content) throw new Error(`Content ${contentId} not found`);

          // Download from S3
          const inputFile = path.join(os.tmpdir(), `${contentId}-input.mp4`);
          tempFiles.push(inputFile);
          await downloadFromS3(originalS3Key, inputFile);

          // Update status
          await ContentABR.findByIdAndUpdate(contentId, { status: "processing" });

          // Encode video
          const { outputDir, outputs, masterHlsPath, masterDashPath } = await encodeVideo(contentId, inputFile);
          tempFiles.push(outputDir);

          // Upload renditions to S3
          const basePath = `outputs/${contentId}/`;
          const renditionNames = [];
          const validExtensions = [".m3u8", ".mpd", ".m4s", ".mp4"];

          for (const o of outputs) {
            const files = (await fs.readdir(o.renditionDir)).filter((file) =>
              validExtensions.some((ext) => file.endsWith(ext))
            );
            for (const file of files) {
              const filePath = path.join(o.renditionDir, file);
              await uploadFileToS3(filePath, `${basePath}${o.rendition}/${file}`);
            }
            renditionNames.push(o.rendition);
          }

          // Upload master manifests
          await uploadFileToS3(masterHlsPath, `manifests/${contentId}.m3u8`);
          await uploadFileToS3(masterDashPath, `manifests/${contentId}.mpd`);

          // Update DB
          await ContentABR.findByIdAndUpdate(contentId, {
            renditions: renditionNames,
            s3Path: basePath,
            manifestHls: `manifests/${contentId}.m3u8`,
            manifestDash: `manifests/${contentId}.mpd`,
            status: "ready",
          });

          // Commit Kafka offset
          await consumer.commitOffsets([{ topic, partition, offset: message.offset + 1 }]);
          console.log(`✅ Processing complete for contentId ${contentId}`);
        } catch (err) {
          console.error("❌ Worker error:", err);
          await ContentABR.findByIdAndUpdate(message.key?.toString(), { status: "failed" });
        } finally {
          // Cleanup temporary files
          for (const file of tempFiles) {
            try {
              await fs.rm(file, { recursive: true, force: true });
              console.log(`🧹 Cleaned up: ${file}`);
            } catch (cleanupErr) {
              console.error(`❌ Cleanup error for ${file}:`, cleanupErr.message);
            }
          }
        }
      },
    });
  } catch (err) {
    console.error("Worker crashed:", err);
    process.exit(1);
  }
}

runWorker().catch((err) => {
  console.error("Worker crashed:", err);
  process.exit(1);
});