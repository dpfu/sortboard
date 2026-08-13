import { normalizeImageAspectRatio } from './cardLayout';

export interface VideoBlobMetadata {
  aspectRatio?: number;
  durationSec?: number;
  posterBlob?: Blob;
}

const IMAGE_METADATA_TIMEOUT_MS = 2000;
const POSTER_MAX_DIMENSION = 720;

function normalizeDurationSec(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
  return Math.round(value * 100) / 100;
}

export function formatDurationLabel(durationSec: number | undefined) {
  if (typeof durationSec !== 'number' || !Number.isFinite(durationSec) || durationSec < 0) return '';
  const rounded = Math.max(0, Math.round(durationSec));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const seconds = rounded % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export async function readImageAspectRatioFromBlob(blob: Blob): Promise<number | undefined> {
  if (typeof createImageBitmap === 'function') {
    let bitmap: ImageBitmap | undefined;
    try {
      bitmap = await Promise.race<ImageBitmap | undefined>([
        createImageBitmap(blob),
        new Promise<ImageBitmap | undefined>((resolve) => {
          globalThis.setTimeout(() => resolve(undefined), IMAGE_METADATA_TIMEOUT_MS);
        }),
      ]);
      if (bitmap) {
        return normalizeImageAspectRatio(bitmap.width / bitmap.height);
      }
    } catch {
      // fallback to HTMLImageElement path
    } finally {
      if (bitmap && typeof bitmap.close === 'function') {
        bitmap.close();
      }
    }
  }

  if (typeof Image === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return undefined;
  }

  return new Promise<number | undefined>((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    let settled = false;
    const finish = (value: number | undefined) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeoutId);
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timeoutId = globalThis.setTimeout(() => {
      finish(undefined);
    }, IMAGE_METADATA_TIMEOUT_MS);
    img.onload = () => {
      finish(normalizeImageAspectRatio(img.naturalWidth / img.naturalHeight));
    };
    img.onerror = () => {
      finish(undefined);
    };
    img.src = url;
  });
}

function createPosterBlobFromVideo(video: HTMLVideoElement) {
  if (typeof document === 'undefined') return Promise.resolve<Blob | undefined>(undefined);
  if (!video.videoWidth || !video.videoHeight) return Promise.resolve<Blob | undefined>(undefined);

  const scale = Math.min(1, POSTER_MAX_DIMENSION / Math.max(video.videoWidth, video.videoHeight));
  const width = Math.max(1, Math.round(video.videoWidth * scale));
  const height = Math.max(1, Math.round(video.videoHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return Promise.resolve<Blob | undefined>(undefined);

  try {
    context.drawImage(video, 0, 0, width, height);
  } catch {
    return Promise.resolve<Blob | undefined>(undefined);
  }

  return new Promise<Blob | undefined>((resolve) => {
    if (typeof canvas.toBlob !== 'function') {
      resolve(undefined);
      return;
    }
    canvas.toBlob((blob) => resolve(blob || undefined), 'image/jpeg', 0.86);
  });
}

export async function readVideoMetadataFromBlob(blob: Blob): Promise<VideoBlobMetadata> {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return {};
  }

  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;
  video.playsInline = true;

  const objectUrl = URL.createObjectURL(blob);

  return new Promise<VideoBlobMetadata>((resolve) => {
    let settled = false;
    let metadata: VideoBlobMetadata = {};
    let captureTimeout = 0;

    const cleanup = () => {
      if (captureTimeout) {
        window.clearTimeout(captureTimeout);
      }
      video.pause();
      video.removeAttribute('src');
      try {
        video.load();
      } catch {
        // ignore jsdom / browser edge-case load errors
      }
      URL.revokeObjectURL(objectUrl);
    };

    const finish = (next: VideoBlobMetadata) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(next);
    };

    video.onerror = () => {
      finish(metadata);
    };

    video.onloadedmetadata = () => {
      metadata = {
        aspectRatio: normalizeImageAspectRatio(video.videoWidth / video.videoHeight),
        durationSec: normalizeDurationSec(video.duration),
      };
    };

    video.onloadeddata = async () => {
      const posterBlob = await createPosterBlobFromVideo(video).catch(() => undefined);
      finish({
        ...metadata,
        posterBlob,
      });
    };

    captureTimeout = window.setTimeout(() => {
      finish(metadata);
    }, 5000);

    video.src = objectUrl;
    try {
      video.load();
    } catch {
      // ignore load errors in limited test environments
    }
  });
}
