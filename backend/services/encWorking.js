// abrWorker.js
const { spawn } = require("child_process");
const path = require("path");
const os = require("os");
const fs = require("fs/promises");
const fssync = require("fs");
const ContentABR = require("../models/contentABRmodel");
const s3 = require("../configs/awsConf");
const { Kafka } = require("kafkajs");
const mongoose = require('mongoose');

const bucketNameABR = 'lms-poc-abr-c247';
const S3_BASE_URL = `https://${bucketNameABR}.s3.amazonaws.com`;

/**
 * Download a file from S3 to local destPath (streamed).
 */
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

/**
 * Upload a local file to S3 (putObject).
 */
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

/**
 * Encodes inputFile into multiple renditions (video-only + audio-only per rendition),
 * creates per-rendition playlists and init/segment files, and returns output metadata
 * including a generated master manifest path (local).
 */
async function encodeVideo(contentId, inputFile) {
  // Temp base dir
  let tempBaseDir = os.tmpdir();
  console.log("Attempting temp base directory:", tempBaseDir);
  let outputDir;
  try {
    outputDir = path.join(tempBaseDir, `encode-${contentId}-${Date.now()}`);
    await fs.mkdir(outputDir, { recursive: true });
    console.log("Created temp directory:", outputDir);
  } catch (err) {
    console.error("❌ Failed to create temp dir in system temp:", err.message);
    tempBaseDir = path.join(__dirname, "temp");
    outputDir = path.join(tempBaseDir, `encode-${contentId}-${Date.now()}`);
    await fs.mkdir(tempBaseDir, { recursive: true });
    await fs.mkdir(outputDir, { recursive: true });
    console.log("Fell back to custom temp directory:", outputDir);
  }

  const renditions = [
    { name: "1080p", width: 1920, height: 1080, bitrate: "5000k", bandwidth: "5000000" },
    { name: "720p", width: 1280, height: 720, bitrate: "3000k", bandwidth: "3000000" },
    { name: "480p", width: 854, height: 480, bitrate: "1500k", bandwidth: "1500000" },
  ];

  const outputs = [];

  for (const r of renditions) {
    const renditionFolder = `${r.name}`;
    const renditionDir = path.join(outputDir, renditionFolder);
    await fs.mkdir(renditionDir, { recursive: true });

    const hlsPath = path.join(renditionDir, `${r.name}.m3u8`);

    // ---------- VIDEO-only encode (fMP4 HLS) ----------
    await new Promise((resolve, reject) => {
      const videoArgs = [
        "-i", inputFile,

        // Video filter only for video stream
        "-filter:v:0", `scale=${r.width}:${r.height}:force_original_aspect_ratio=decrease,pad=${r.width}:${r.height}:(ow-iw)/2:(oh-ih)/2`,

        // Map video only
        "-map", "v:0",

        // Video codec
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-profile:v", "main",
        "-level", "4.1",
        "-b:v", r.bitrate,

        // disable audio for this run
        "-an",

        // HLS fMP4 settings
        "-f", "hls",
        "-hls_time", "6",
        "-hls_playlist_type", "vod",
        "-hls_segment_type", "fmp4",
        "-hls_flags", "independent_segments",

        // Video init & segments
        "-hls_fmp4_init_filename", "video_init.mp4",
        "-hls_segment_filename", path.join(renditionDir, "video_%04d.m4s").replace(/\\/g, "/"),

        // Output video playlist (named as rendition, e.g., 1080p.m3u8)
        path.join(renditionDir, `${r.name}.m3u8`).replace(/\\/g, "/"),
      ];

      console.log(`Spawning ffmpeg (video) for ${r.name}: ffmpeg ${videoArgs.join(" ")}`);
      const ffVideo = spawn("ffmpeg", videoArgs);

      let vErr = "";
      ffVideo.stderr.on("data", (d) => {
        const s = d.toString();
        vErr += s;
        console.error(`[ffmpeg-video ${r.name}] ${s}`);
      });

      ffVideo.on("exit", (code) => {
        if (code === 0) {
          console.log(`✅ video HLS created for ${r.name}`);
          resolve();
        } else {
          reject(new Error(`FFmpeg video failed for ${r.name}: exit ${code}\n${vErr.slice(0, 8000)}`));
        }
      });
    });

    // Small delay to ensure files flushed
    await new Promise((res) => setTimeout(res, 500));

    // ---------- AUDIO-only encode (fMP4 HLS) ----------
    await new Promise((resolve, reject) => {
      const audioArgs = [
        "-i", inputFile,

        // Map audio only
        "-map", "a:0",

        // Audio codec
        "-c:a", "aac",
        "-b:a", "128k",

        // disable video for this run
        "-vn",

        // HLS fMP4 settings
        "-f", "hls",
        "-hls_time", "6",
        "-hls_playlist_type", "vod",
        "-hls_segment_type", "fmp4",
        "-hls_flags", "independent_segments",

        // Audio init & segments
        "-hls_fmp4_init_filename", "audio_init.mp4",
        "-hls_segment_filename", path.join(renditionDir, "audio_%04d.m4s").replace(/\\/g, "/"),

        // Output audio playlist (named audio_<rendition>.m3u8)
        path.join(renditionDir, `audio_${r.name}.m3u8`).replace(/\\/g, "/"),
      ];

      console.log(`Spawning ffmpeg (audio) for ${r.name}: ffmpeg ${audioArgs.join(" ")}`);
      const ffAudio = spawn("ffmpeg", audioArgs);

      let aErr = "";
      ffAudio.stderr.on("data", (d) => {
        const s = d.toString();
        aErr += s;
        console.error(`[ffmpeg-audio ${r.name}] ${s}`);
      });

      ffAudio.on("exit", (code) => {
        if (code === 0) {
          console.log(`✅ audio HLS created for ${r.name}`);
          resolve();
        } else {
          reject(new Error(`FFmpeg audio failed for ${r.name}: exit ${code}\n${aErr.slice(0, 8000)}`));
        }
      });
    });

    // Wait briefly to ensure init segments are present on disk
    await new Promise((res) => setTimeout(res, 1000));

    // Upload init segments early if you want (optional) - we still will upload all below in ordered uploads
    const videoInitPath = path.join(renditionDir, "video_init.mp4");
    if (await fs.access(videoInitPath).then(() => true).catch(() => false)) {
      console.log("video_init exists for", r.name);
    } else {
      console.warn(`⚠️ video_init.mp4 not found in ${renditionDir}`);
    }
    const audioInitPath = path.join(renditionDir, "audio_init.mp4");
    if (await fs.access(audioInitPath).then(() => true).catch(() => false)) {
      console.log("audio_init exists for", r.name);
    } else {
      console.warn(`⚠️ audio_init.mp4 not found in ${renditionDir}`);
    }

    outputs.push({ rendition: r.name, hlsPath, renditionDir });
  }

  // Generate single master HLS playlist (references audio playlists too) with absolute S3 URLs
  const masterLines = [
    "#EXTM3U",
    "#EXT-X-VERSION:7",
  ];

  // Put audio group entries (group-id "audio")
  for (const r of renditions) {
    const audioUri = `${S3_BASE_URL}/outputs/${contentId}/${r.name}/audio_${r.name}.m3u8`;
    masterLines.push(
      `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="${r.name}-audio",DEFAULT=${r === renditions[0] ? "YES" : "NO"},AUTOSELECT=YES,URI="${audioUri}"`
    );
  }

  // Add stream entries referencing video playlists and audio group
  for (const r of renditions) {
    const videoUri = `${S3_BASE_URL}/outputs/${contentId}/${r.name}/${r.name}.m3u8`;
    masterLines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${r.bandwidth},RESOLUTION=${r.width}x${r.height},CODECS="avc1.4d401f,mp4a.40.2",AUDIO="audio"`
    );
    masterLines.push(videoUri);
  }

  const masterHls = masterLines.join("\n") + "\n";
  const masterHlsPath = path.join(outputDir, "master.m3u8");
  await fs.writeFile(masterHlsPath, masterHls);

  return { outputDir, outputs, masterHlsPath };
}

/**
 * Worker runner: consumes Kafka messages, downloads source, encodes, uploads, updates DB, commits.
 */
async function runWorker() {
  try {
    const kafka = new Kafka({
      clientId: 'abr-client',
      brokers: ['localhost:9092'],
    });
    const consumer = kafka.consumer({
      groupId: 'abr-group',
      sessionTimeout: 90000,
      heartbeatInterval: 30000,
      retry: { retries: 5 },
    });

    await mongoose.connect("mongodb://localhost:27017/lms", { connectTimeoutMS: 10000 });
    await consumer.connect();
    await consumer.subscribe({ topic: "video-encoding" });

    await consumer.run({
      autoCommit: false,
      eachMessage: async ({ topic, partition, message }) => {
        let tempFiles = [];
        let processingSuccessful = false;
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

          // Update status to processing
          await ContentABR.findByIdAndUpdate(contentId, { status: "processing" });

          // Encode video (this writes files under outputDir and returns outputs metadata)
          const { outputDir, outputs, masterHlsPath } = await encodeVideo(contentId, inputFile);
          tempFiles.push(outputDir);
          for (const o of outputs) {
            tempFiles.push(o.renditionDir);
          }

          // Upload renditions to S3 with explicit ordering per rendition
          const basePath = `outputs/${contentId}/`;
          const renditionNames = [];

          for (const o of outputs) {
            const rendName = o.rendition;
            const rendDir = o.renditionDir;

            // 1) upload video_init.mp4
            const videoInitLocal = path.join(rendDir, "video_init.mp4");
            if (await fs.access(videoInitLocal).then(() => true).catch(() => false)) {
              await uploadFileToS3(videoInitLocal, `${basePath}${rendName}/video_init.mp4`);
            }

            // 2) upload video segments (video_XXXX.m4s)
            const filesAll = await fs.readdir(rendDir);
            const videoSegs = filesAll.filter(f => f.startsWith("video_") && f.endsWith(".m4s")).sort();
            for (const seg of videoSegs) {
              await uploadFileToS3(path.join(rendDir, seg), `${basePath}${rendName}/${seg}`);
            }

            // 3) upload video playlist (e.g., 1080p.m3u8)
            const videoPlaylistLocal = path.join(rendDir, `${rendName}.m3u8`);
            if (await fs.access(videoPlaylistLocal).then(() => true).catch(() => false)) {
              await uploadFileToS3(videoPlaylistLocal, `${basePath}${rendName}/${path.basename(videoPlaylistLocal)}`);
            }

            // 4) upload audio_init.mp4
            const audioInitLocal = path.join(rendDir, "audio_init.mp4");
            if (await fs.access(audioInitLocal).then(() => true).catch(() => false)) {
              await uploadFileToS3(audioInitLocal, `${basePath}${rendName}/audio_init.mp4`);
            }

            // 5) upload audio segments (audio_XXXX.m4s)
            const audioSegs = filesAll.filter(f => f.startsWith("audio_") && f.endsWith(".m4s")).sort();
            for (const seg of audioSegs) {
              await uploadFileToS3(path.join(rendDir, seg), `${basePath}${rendName}/${seg}`);
            }

            // 6) upload audio playlist (audio_<rendition>.m3u8)
            const audioPlaylistLocal = path.join(rendDir, `audio_${rendName}.m3u8`);
            if (await fs.access(audioPlaylistLocal).then(() => true).catch(() => false)) {
              await uploadFileToS3(audioPlaylistLocal, `${basePath}${rendName}/${path.basename(audioPlaylistLocal)}`);
            }

            renditionNames.push(rendName);
          }

          // Upload master manifest to manifests/{contentId}.m3u8
          await uploadFileToS3(masterHlsPath, `manifests/${contentId}.m3u8`);

          // Update DB to ready status before committing offset
          await ContentABR.findByIdAndUpdate(contentId, {
            renditions: renditionNames,
            s3Path: basePath,
            manifestHls: `manifests/${contentId}.m3u8`,
            status: "ready",
          });

          processingSuccessful = true;

          // Commit Kafka offset with retry
          let commitSuccess = false;
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              await consumer.commitOffsets([{ topic, partition, offset: Number(message.offset) + 1 }]);
              commitSuccess = true;
              console.log(`✅ Offset committed for contentId ${contentId}, offset ${message.offset}`);
              break;
            } catch (commitErr) {
              console.error(`❌ Offset commit attempt ${attempt} failed for contentId ${contentId}:`, commitErr.message);
              if (attempt === 3) throw commitErr;
              await new Promise((resolve) => setTimeout(resolve, 1000));
            }
          }
          if (!commitSuccess) throw new Error(`Failed to commit offset for contentId ${contentId} after retries`);

          console.log(`✅ Processing complete for contentId ${contentId}`);
        } catch (err) {
          console.error("❌ Worker error:", err);
          // Only set status to failed if critical steps failed
          try {
            if (!processingSuccessful) {
              // message.key might be undefined; we used contentId earlier, but in error case use message.key fallback
              const keyId = (() => {
                try {
                  const parsed = JSON.parse(message.value.toString());
                  return parsed.contentId;
                } catch (e) {
                  return message.key?.toString();
                }
              })();
              if (keyId) {
                await ContentABR.findByIdAndUpdate(keyId, { status: "failed" });
              }
            }
          } catch (dbErr) {
            console.error("❌ Failed to update DB to failed status:", dbErr.message);
          }
          throw err;
        } finally {
          // Delay cleanup to ensure file handles are released
          await new Promise(resolve => setTimeout(resolve, 2000));

          // Cleanup temporary files without throwing errors
          for (const file of tempFiles) {
            for (let attempt = 1; attempt <= 3; attempt++) {
              try {
                await fs.rm(file, { recursive: true, force: true });
                console.log(`🧹 Cleaned up: ${file}`);
                break;
              } catch (cleanupErr) {
                console.error(`❌ Cleanup error for ${file} (attempt ${attempt}):`, cleanupErr.message);
                if (attempt === 3) {
                  console.error(`❌ Failed to clean up ${file} after 3 attempts`);
                }
                await new Promise((resolve) => setTimeout(resolve, 1000));
              }
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
