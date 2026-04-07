const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const {
  ADS_OPTIMIZED_UPLOADS_DIR,
  ADS_OPTIMIZED_UPLOADS_PUBLIC_PATH,
  ensureAdsUploadsDir,
} = require('../config/adStorage');

const execFileAsync = promisify(execFile);

const FFPROBE_PATH = process.env.FFPROBE_PATH || 'ffprobe';
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';
const SIGNAGE_COMPRESSION_PROFILE = Object.freeze({
  preset: 'slow',
  crf: 20,
  maxWidth: 1920,
  videoCodec: 'libx264',
  audioCodec: 'aac',
});

function sanitizeBaseName(input) {
  return String(input || 'video')
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'video';
}

function getAbsolutePathFromPublicPath(publicPath) {
  const normalized = String(publicPath || '').replace(/\\/g, '/');
  if (!normalized.startsWith('/uploads_test/ads/')) {
    return null;
  }

  return path.join(__dirname, '..', 'public', normalized.replace(/^\//, ''));
}

function getOptimizedPaths(sourcePublicPath) {
  const parsed = path.parse(sourcePublicPath);
  const optimizedBaseName = `${sanitizeBaseName(parsed.name)}.optimized.mp4`;

  return {
    absolutePath: path.join(ADS_OPTIMIZED_UPLOADS_DIR, optimizedBaseName),
    publicPath: `${ADS_OPTIMIZED_UPLOADS_PUBLIC_PATH}/${optimizedBaseName}`,
  };
}

async function ensureFfmpegAvailable() {
  try {
    await execFileAsync(FFMPEG_PATH, ['-version']);
  } catch (error) {
    const message = error.code === 'ENOENT'
      ? 'FFmpeg is not installed or not available on the server PATH.'
      : `FFmpeg is unavailable: ${error.message}`;
    const wrapped = new Error(message);
    wrapped.cause = error;
    throw wrapped;
  }
}

async function getVideoWidth(filePath) {
  try {
    const { stdout } = await execFileAsync(FFPROBE_PATH, [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width',
      '-of', 'csv=p=0',
      filePath,
    ]);

    const width = Number.parseInt(String(stdout || '').trim(), 10);
    return Number.isFinite(width) ? width : null;
  } catch (error) {
    return null;
  }
}

async function compressVideoForSignage(sourcePublicPath) {
  ensureAdsUploadsDir();

  const sourceAbsolutePath = getAbsolutePathFromPublicPath(sourcePublicPath);
  if (!sourceAbsolutePath) {
    throw new Error('Unsupported source file path.');
  }

  if (!fs.existsSync(sourceAbsolutePath)) {
    throw new Error('Source video file was not found on disk.');
  }

  const sourceExtension = path.extname(sourceAbsolutePath).toLowerCase();
  if (sourceExtension !== '.mp4') {
    throw new Error('Only MP4 video files can be compressed for signage.');
  }

  await ensureFfmpegAvailable();

  const optimizedPaths = getOptimizedPaths(sourcePublicPath);
  const sourceStats = fs.statSync(sourceAbsolutePath);

  if (fs.existsSync(optimizedPaths.absolutePath)) {
    const optimizedStats = fs.statSync(optimizedPaths.absolutePath);
    return {
      skipped: true,
      sourceAbsolutePath,
      sourcePublicPath,
      optimizedAbsolutePath: optimizedPaths.absolutePath,
      optimizedPublicPath: optimizedPaths.publicPath,
      sourceSizeBytes: sourceStats.size,
      optimizedSizeBytes: optimizedStats.size,
    };
  }

  const width = await getVideoWidth(sourceAbsolutePath);
  const args = [
    '-y',
    '-i', sourceAbsolutePath,
    '-c:v', SIGNAGE_COMPRESSION_PROFILE.videoCodec,
    '-preset', SIGNAGE_COMPRESSION_PROFILE.preset,
    '-crf', String(SIGNAGE_COMPRESSION_PROFILE.crf),
    '-c:a', SIGNAGE_COMPRESSION_PROFILE.audioCodec,
    '-b:a', '192k',
    '-movflags', '+faststart',
  ];

  if (width && width > SIGNAGE_COMPRESSION_PROFILE.maxWidth) {
    args.push('-vf', `scale=${SIGNAGE_COMPRESSION_PROFILE.maxWidth}:-2`);
  }

  args.push(optimizedPaths.absolutePath);

  try {
    await execFileAsync(FFMPEG_PATH, args, { windowsHide: true });
  } catch (error) {
    if (fs.existsSync(optimizedPaths.absolutePath)) {
      fs.unlinkSync(optimizedPaths.absolutePath);
    }

    const stderr = String(error.stderr || '').trim();
    const wrapped = new Error(stderr || error.message || 'FFmpeg compression failed.');
    wrapped.cause = error;
    throw wrapped;
  }

  const optimizedStats = fs.statSync(optimizedPaths.absolutePath);

  return {
    skipped: false,
    sourceAbsolutePath,
    sourcePublicPath,
    optimizedAbsolutePath: optimizedPaths.absolutePath,
    optimizedPublicPath: optimizedPaths.publicPath,
    sourceSizeBytes: sourceStats.size,
    optimizedSizeBytes: optimizedStats.size,
  };
}

module.exports = {
  SIGNAGE_COMPRESSION_PROFILE,
  ensureFfmpegAvailable,
  compressVideoForSignage,
  getAbsolutePathFromPublicPath,
  getOptimizedPaths,
};
