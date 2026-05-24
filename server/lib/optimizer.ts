export interface OptimizeOptions {
  format: "jpeg" | "png" | "webp";
  quality: number;
  width?: number;
  height?: number;
  fit?: "fill" | "inside";
  withoutEnlargement?: boolean;
  progressive?: boolean;
}

export interface OptimizeResult {
  originalSize: number;
  optimizedSize: number;
  savedBytes: number;
  savedPercent: number;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  format: string;
  data: Uint8Array;
  mimeType: string;
}

const MIME_MAP: Record<string, string> = {
  jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
};

export async function optimizeImage(
  buffer: Buffer | Uint8Array,
  options: OptimizeOptions,
): Promise<OptimizeResult> {
  const originalSize = buffer.byteLength;
  const metaImg = new Bun.Image(buffer);
  const meta = await metaImg.metadata();
  const originalWidth = meta.width;
  const originalHeight = meta.height;

  let img = new Bun.Image(buffer, { autoOrient: true, maxPixels: 8192 * 8192 });

  if (options.width || options.height) {
    img = img.resize(options.width as number, options.height as number, {
      fit: options.fit || "inside",
      withoutEnlargement: options.withoutEnlargement ?? true,
      filter: "lanczos3",
    });
  }

  switch (options.format) {
    case "jpeg":
      img = img.jpeg({ quality: options.quality, progressive: options.progressive ?? false });
      break;
    case "png":
      img = img.png({ compressionLevel: Math.min(9, Math.ceil(options.quality / 11)) });
      break;
    case "webp":
      img = img.webp({ quality: options.quality });
      break;
  }

  const data = await img.bytes();
  const outputWidth = img.width > 0 ? img.width : originalWidth;
  const outputHeight = img.height > 0 ? img.height : originalHeight;
  const optimizedSize = data.byteLength;
  const savedBytes = Math.max(0, originalSize - optimizedSize);
  const savedPercent = originalSize > 0 ? Math.round((savedBytes / originalSize) * 100) : 0;

  return {
    originalSize, optimizedSize, savedBytes, savedPercent,
    width: outputWidth, height: outputHeight,
    originalWidth, originalHeight,
    format: options.format,
    data,
    mimeType: MIME_MAP[options.format] || "application/octet-stream",
  };
}

export async function optimizeBatch(
  files: { name: string; buffer: Buffer | Uint8Array }[],
  options: OptimizeOptions,
  maxFiles: number,
) {
  const toProcess = files.slice(0, maxFiles);
  const results: OptimizeResult[] = [];
  const errors: { name: string; error: string }[] = [];

  for (const file of toProcess) {
    try {
      results.push(await optimizeImage(file.buffer, options));
    } catch (e: any) {
      errors.push({ name: file.name, error: e.message || "Unknown error" });
    }
  }
  return { results, errors };
}
