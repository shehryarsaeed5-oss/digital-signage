const fs = require('fs');
const path = require('path');

const ADS_UPLOADS_DIR = path.join(__dirname, '..', 'public', 'uploads_test', 'ads');
const ADS_UPLOADS_PUBLIC_PATH = '/uploads_test/ads';
const ADS_OPTIMIZED_UPLOADS_DIR = path.join(__dirname, '..', 'public', 'uploads_test', 'ads_optimized');
const ADS_OPTIMIZED_UPLOADS_PUBLIC_PATH = '/uploads_test/ads_optimized';

const AD_ALLOWED_MIME_TYPES = Object.freeze([
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
]);

const AD_ALLOWED_EXTENSIONS = Object.freeze([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.mp4',
]);

function ensureAdsUploadsDir() {
  fs.mkdirSync(ADS_UPLOADS_DIR, { recursive: true });
  fs.mkdirSync(ADS_OPTIMIZED_UPLOADS_DIR, { recursive: true });
  return ADS_UPLOADS_DIR;
}

function isValidAdUpload(file) {
  if (!file) {
    return false;
  }

  const extension = path.extname(file.originalname || '').toLowerCase();

  return (
    AD_ALLOWED_MIME_TYPES.includes(file.mimetype) &&
    AD_ALLOWED_EXTENSIONS.includes(extension)
  );
}

module.exports = {
  ADS_UPLOADS_DIR,
  ADS_UPLOADS_PUBLIC_PATH,
  ADS_OPTIMIZED_UPLOADS_DIR,
  ADS_OPTIMIZED_UPLOADS_PUBLIC_PATH,
  AD_ALLOWED_MIME_TYPES,
  AD_ALLOWED_EXTENSIONS,
  ensureAdsUploadsDir,
  isValidAdUpload,
};
