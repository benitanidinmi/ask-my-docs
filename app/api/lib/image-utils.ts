import OpenAI from "openai";
import { normalizeDocumentText } from "./text-utils";

const VISION_MODEL = "gpt-4.1-mini";
const MAX_IMAGE_DIMENSION = 10_000;
const MAX_IMAGE_PIXELS = 20_000_000;
const NO_USEFUL_CONTENT = "NO_USEFUL_CONTENT";

export class ImageValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ImageValidationError";
  }
}

export class VisionServiceError extends Error {
  constructor() {
    super("Vision extraction failed");
    this.name = "VisionServiceError";
  }
}

function readUint24LE(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readUint32LE(bytes: Uint8Array, offset: number) {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

function getPngDimensions(bytes: Uint8Array) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];

  if (bytes.length < 24 || !signature.every((value, index) => bytes[index] === value)) {
    return null;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function getJpegDimensions(bytes: Uint8Array) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }

  const startOfFrameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
    0xcf,
  ]);
  let offset = 2;

  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];

    if (startOfFrameMarkers.has(marker)) {
      return {
        height: (bytes[offset + 4] << 8) | bytes[offset + 5],
        width: (bytes[offset + 6] << 8) | bytes[offset + 7],
      };
    }

    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01) {
      offset += 1;
      continue;
    }

    if (offset + 2 >= bytes.length) return null;
    const segmentLength = (bytes[offset + 1] << 8) | bytes[offset + 2];
    if (segmentLength < 2) return null;
    offset += segmentLength + 1;
  }

  return null;
}

function getWebpDimensions(bytes: Uint8Array) {
  const ascii = (offset: number, length: number) =>
    String.fromCharCode(...bytes.slice(offset, offset + length));

  if (bytes.length < 30 || ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WEBP") {
    return null;
  }

  let offset = 12;

  while (offset + 8 <= bytes.length) {
    const chunkType = ascii(offset, 4);
    const chunkSize = readUint32LE(bytes, offset + 4);
    const dataOffset = offset + 8;

    if (dataOffset + chunkSize > bytes.length) return null;

    if (chunkType === "VP8X" && chunkSize >= 10) {
      return {
        width: readUint24LE(bytes, dataOffset + 4) + 1,
        height: readUint24LE(bytes, dataOffset + 7) + 1,
      };
    }

    if (chunkType === "VP8L" && chunkSize >= 5 && bytes[dataOffset] === 0x2f) {
      const b0 = bytes[dataOffset + 1];
      const b1 = bytes[dataOffset + 2];
      const b2 = bytes[dataOffset + 3];
      const b3 = bytes[dataOffset + 4];
      return {
        width: 1 + b0 + ((b1 & 0x3f) << 8),
        height: 1 + (b1 >> 6) + (b2 << 2) + ((b3 & 0x0f) << 10),
      };
    }

    if (
      chunkType === "VP8 " &&
      chunkSize >= 10 &&
      bytes[dataOffset + 3] === 0x9d &&
      bytes[dataOffset + 4] === 0x01 &&
      bytes[dataOffset + 5] === 0x2a
    ) {
      return {
        width: (bytes[dataOffset + 6] | (bytes[dataOffset + 7] << 8)) & 0x3fff,
        height: (bytes[dataOffset + 8] | (bytes[dataOffset + 9] << 8)) & 0x3fff,
      };
    }

    offset = dataOffset + chunkSize + (chunkSize % 2);
  }

  return null;
}

function validateImage(bytes: Uint8Array, mimeType: string) {
  const dimensions =
    mimeType === "image/png"
      ? getPngDimensions(bytes)
      : mimeType === "image/jpeg"
        ? getJpegDimensions(bytes)
        : getWebpDimensions(bytes);

  if (!dimensions || dimensions.width < 1 || dimensions.height < 1) {
    throw new ImageValidationError(
      "INVALID_IMAGE",
      "Görsel dosyası okunamadı veya dosya içeriği formatıyla eşleşmiyor."
    );
  }

  if (
    dimensions.width > MAX_IMAGE_DIMENSION ||
    dimensions.height > MAX_IMAGE_DIMENSION ||
    dimensions.width * dimensions.height > MAX_IMAGE_PIXELS
  ) {
    throw new ImageValidationError(
      "IMAGE_DIMENSIONS_TOO_LARGE",
      "Görsel boyutları en fazla 10.000 piksel ve toplam 20 megapiksel olabilir."
    );
  }
}

export async function extractImageText(
  data: ArrayBuffer,
  mimeType: string,
  apiKey: string
) {
  const bytes = new Uint8Array(data);
  validateImage(bytes, mimeType);

  const dataUrl = `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
  const client = new OpenAI({ apiKey });

  try {
    const response = await client.responses.create({
      model: VISION_MODEL,
      instructions:
        "Create a faithful textual representation of the uploaded image for grounded document Q&A. Never infer content that is not visible.",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Extract visible text, headings, labels, values, tables, error messages, UI controls, and important visual relationships. Preserve document and line structure where practical. For screenshots, describe relationships such as an error appearing below a button. Keep the result concise when the image is mostly text. If the image contains no useful visible or textual information for question answering, return exactly ${NO_USEFUL_CONTENT}.`,
            },
            {
              type: "input_image",
              image_url: dataUrl,
              detail: "high",
            },
          ],
        },
      ],
      max_output_tokens: 1_200,
    });

    const text = normalizeDocumentText(response.output_text);

    if (!text || text === NO_USEFUL_CONTENT) {
      throw new ImageValidationError(
        "IMAGE_CONTENT_NOT_FOUND",
        "Görselden soru cevaplamaya uygun içerik çıkarılamadı."
      );
    }

    return text;
  } catch (error) {
    if (error instanceof ImageValidationError) {
      throw error;
    }

    console.error("OpenAI vision extraction failed:", {
      name: error instanceof Error ? error.name : "UnknownError",
      status:
        typeof error === "object" && error !== null && "status" in error
          ? error.status
          : undefined,
    });
    throw new VisionServiceError();
  }
}
