export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.avif', '.heic', '.heif'];
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.m4v', '.webm', '.ogv', '.ogg', '.avi', '.mkv'];

export const SUPPORTED_MEDIA_ACCEPT = ['image/*', 'video/*', ...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS].join(',');

function hasKnownExtension(fileName: string, extensions: string[]) {
  const lower = fileName.trim().toLowerCase();
  return extensions.some((ext) => lower.endsWith(ext));
}

export function isImageFile(file: File) {
  return file.type.startsWith('image/') || hasKnownExtension(file.name, IMAGE_EXTENSIONS);
}

export function isVideoFile(file: File) {
  return file.type.startsWith('video/') || hasKnownExtension(file.name, VIDEO_EXTENSIONS);
}

export function isSupportedMediaFile(file: File) {
  return isImageFile(file) || isVideoFile(file);
}

export function detectMediaKind(file: File): 'image' | 'video' | null {
  if (isImageFile(file)) return 'image';
  if (isVideoFile(file)) return 'video';
  return null;
}
