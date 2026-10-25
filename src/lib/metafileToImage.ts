/**
 * Client-side EMF (Enhanced Metafile) & WMF (Windows Metafile) converter.
 *
 * Browsers cannot render image/emf or image/wmf natively in <img> tags.
 * This module:
 * 1. Checks if the metafile contains an embedded raster image (JPEG, PNG, DIB/BMP).
 *    If found, extracts it directly as image/jpeg, image/png, or image/bmp.
 * 2. If it is a vector metafile (lines, rectangles, polygons, curves, text):
 *    Parses the records and renders a scalable SVG (image/svg+xml).
 * 3. Fallback: Creates an SVG vector container with the bounding box and text labels
 *    so the diagram or equation is always visible in the browser, never broken.
 */

function u8ToBase64(u8: Uint8Array): string {
  let binary = "";
  const len = u8.length;
  for (let i = 0; i < len; i += 8192) {
    const chunk = u8.subarray(i, Math.min(i + 8192, len));
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function bgrToHex(bgr: number): string {
  const r = bgr & 0xff;
  const g = (bgr >> 8) & 0xff;
  const b = (bgr >> 16) & 0xff;
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

/**
 * Turns DIB (Device Independent Bitmap) bytes into a standard BMP data URL
 * by prepending the 14-byte BITMAPFILEHEADER.
 */
function dibToBmpDataUrl(bmiBytes: Uint8Array, bitsBytes: Uint8Array): string {
  const totalSize = 14 + bmiBytes.length + bitsBytes.length;
  const header = new Uint8Array(14);
  const view = new DataView(header.buffer);
  header[0] = 0x42; // 'B'
  header[1] = 0x4d; // 'M'
  view.setUint32(2, totalSize, true);
  view.setUint32(6, 0, true);
  view.setUint32(10, 14 + bmiBytes.length, true);

  const bmp = new Uint8Array(totalSize);
  bmp.set(header, 0);
  bmp.set(bmiBytes, 14);
  bmp.set(bitsBytes, 14 + bmiBytes.length);
  return `data:image/bmp;base64,${u8ToBase64(bmp)}`;
}

/** Checks for embedded JPEG or PNG magic bytes inside raw buffer. */
function checkDirectImage(bytes: Uint8Array): string | null {
  if (bytes.length < 8) return null;
  // JPEG: 0xFF, 0xD8, 0xFF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return `data:image/jpeg;base64,${u8ToBase64(bytes)}`;
  }
  // PNG: 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return `data:image/png;base64,${u8ToBase64(bytes)}`;
  }
  return null;
}

/**
 * Converts EMF bytes to a browser-renderable image (JPEG, PNG, BMP, or SVG).
 */
export function convertEmfToDisplayable(data: Uint8Array): string | null {
  if (data.length < 88) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  // Check EMF Header signature at offset 40: " EMF" (0x464D4520)
  const sig =
    String.fromCharCode(data[40]) +
    String.fromCharCode(data[41]) +
    String.fromCharCode(data[42]) +
    String.fromCharCode(data[43]);
  if (sig !== " EMF") {
    // Some EMF variants might not have " EMF" exactly at 40; verify record type 1
    const rType = view.getUint32(0, true);
    if (rType !== 1) return null;
  }

  const boundLeft = view.getInt32(8, true);
  const boundTop = view.getInt32(12, true);
  const boundRight = view.getInt32(16, true);
  const boundBottom = view.getInt32(20, true);
  const width = Math.max(1, boundRight - boundLeft);
  const height = Math.max(1, boundBottom - boundTop);

  let pos = view.getUint32(4, true); // Header record size (usually 88 or 100)
  if (pos < 88 || pos > data.length) pos = 88;

  const svgElements: string[] = [];
  let curX = 0;
  let curY = 0;
  let strokeColor = "#000000";
  let strokeWidth = 1;
  let fillColor = "none";
  let textColor = "#000000";

  let guard = 0;
  while (pos + 8 <= data.length && guard++ < 100000) {
    const recType = view.getUint32(pos, true);
    const recSize = view.getUint32(pos + 4, true);
    if (recSize < 8 || pos + recSize > data.length) break;

    // EMR_STRETCHDIBITS (81) or EMR_BITBLT (76)
    if (recType === 81) {
      if (pos + 56 <= data.length) {
        const offBmi = view.getUint32(pos + 40, true);
        const cbBmi = view.getUint32(pos + 44, true);
        const offBits = view.getUint32(pos + 48, true);
        const cbBits = view.getUint32(pos + 52, true);

        if (cbBits > 0 && pos + offBits + cbBits <= data.length) {
          const bitBytes = data.subarray(pos + offBits, pos + offBits + cbBits);
          const direct = checkDirectImage(bitBytes);
          if (direct) return direct;

          if (cbBmi > 0 && pos + offBmi + cbBmi <= data.length) {
            const bmiBytes = data.subarray(pos + offBmi, pos + offBmi + cbBmi);
            return dibToBmpDataUrl(bmiBytes, bitBytes);
          }
        }
      }
    } else if (recType === 76) {
      // EMR_BITBLT
      if (pos + 70 <= data.length) {
        const offBmi = view.getUint32(pos + 56, true);
        const cbBmi = view.getUint32(pos + 60, true);
        const offBits = view.getUint32(pos + 64, true);
        const cbBits = view.getUint32(pos + 68, true);

        if (cbBits > 0 && pos + offBits + cbBits <= data.length) {
          const bitBytes = data.subarray(pos + offBits, pos + offBits + cbBits);
          const direct = checkDirectImage(bitBytes);
          if (direct) return direct;

          if (cbBmi > 0 && pos + offBmi + cbBmi <= data.length) {
            const bmiBytes = data.subarray(pos + offBmi, pos + offBmi + cbBmi);
            return dibToBmpDataUrl(bmiBytes, bitBytes);
          }
        }
      }
    } else if (recType === 27) {
      // EMR_MOVETOEX
      curX = view.getInt32(pos + 8, true);
      curY = view.getInt32(pos + 12, true);
    } else if (recType === 54) {
      // EMR_LINETO
      const x = view.getInt32(pos + 8, true);
      const y = view.getInt32(pos + 12, true);
      svgElements.push(
        `<line x1="${curX}" y1="${curY}" x2="${x}" y2="${y}" stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-linecap="round"/>`,
      );
      curX = x;
      curY = y;
    } else if (recType === 43) {
      // EMR_RECTANGLE
      const l = view.getInt32(pos + 8, true);
      const t = view.getInt32(pos + 12, true);
      const r = view.getInt32(pos + 16, true);
      const b = view.getInt32(pos + 20, true);
      svgElements.push(
        `<rect x="${l}" y="${t}" width="${Math.max(1, r - l)}" height="${Math.max(1, b - t)}" fill="${fillColor}" stroke="${strokeColor}" stroke-width="${strokeWidth}"/>`,
      );
    } else if (recType === 42) {
      // EMR_ELLIPSE
      const l = view.getInt32(pos + 8, true);
      const t = view.getInt32(pos + 12, true);
      const r = view.getInt32(pos + 16, true);
      const b = view.getInt32(pos + 20, true);
      const cx = (l + r) / 2;
      const cy = (t + b) / 2;
      const rx = Math.max(1, (r - l) / 2);
      const ry = Math.max(1, (b - t) / 2);
      svgElements.push(
        `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fillColor}" stroke="${strokeColor}" stroke-width="${strokeWidth}"/>`,
      );
    } else if (recType === 4 || recType === 3) {
      // EMR_POLYLINE (4) or EMR_POLYGON (3)
      const count = view.getUint32(pos + 24, true);
      if (count > 0 && pos + 28 + count * 8 <= data.length) {
        const pts: string[] = [];
        for (let i = 0; i < count; i++) {
          const px = view.getInt32(pos + 28 + i * 8, true);
          const py = view.getInt32(pos + 28 + i * 8 + 4, true);
          pts.push(`${px},${py}`);
        }
        const tag = recType === 3 ? "polygon" : "polyline";
        const f = recType === 3 ? fillColor : "none";
        svgElements.push(
          `<${tag} points="${pts.join(" ")}" fill="${f}" stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-linejoin="round"/>`,
        );
      }
    } else if (recType === 84) {
      // EMR_EXTTEXTOUTW
      const refX = view.getInt32(pos + 24, true);
      const refY = view.getInt32(pos + 28, true);
      const numChars = view.getUint32(pos + 32, true);
      const offString = view.getUint32(pos + 36, true);
      if (numChars > 0 && pos + offString + numChars * 2 <= data.length) {
        let str = "";
        for (let i = 0; i < numChars; i++) {
          str += String.fromCharCode(view.getUint16(pos + offString + i * 2, true));
        }
        const clean = str.trim();
        if (clean) {
          svgElements.push(
            `<text x="${refX}" y="${refY}" fill="${textColor}" font-family="sans-serif" font-size="12">${escapeXml(clean)}</text>`,
          );
        }
      }
    } else if (recType === 24) {
      // EMR_SETTEXTCOLOR
      const c = view.getUint32(pos + 8, true);
      textColor = bgrToHex(c);
    } else if (recType === 38) {
      // EMR_CREATEPEN
      strokeWidth = Math.max(1, view.getUint32(pos + 12, true));
      const c = view.getUint32(pos + 20, true);
      strokeColor = bgrToHex(c);
    } else if (recType === 39) {
      // EMR_CREATEBRUSHINDIRECT
      const style = view.getUint32(pos + 8, true);
      if (style === 0) {
        // BS_SOLID
        fillColor = bgrToHex(view.getUint32(pos + 12, true));
      } else if (style === 1) {
        // BS_HOLLOW / BS_NULL
        fillColor = "none";
      }
    } else if (recType === 14) {
      // EMR_EOF
      break;
    }

    pos += recSize;
  }

  if (svgElements.length > 0) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${boundLeft} ${boundTop} ${width} ${height}" width="${width}" height="${height}">${svgElements.join("")}</svg>`;
    const encoded = encodeURIComponent(svg).replace(/'/g, "%27").replace(/"/g, "%22");
    return `data:image/svg+xml;utf8,${encoded}`;
  }

  // Fallback: scalable SVG placeholder maintaining dimensions
  const fallbackSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#f8fafc" stroke="#e2e8f0" stroke-width="1"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#94a3b8" font-family="sans-serif" font-size="14">EMF Vector Image</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(fallbackSvg)}`;
}

/**
 * Converts WMF bytes to a browser-renderable image (JPEG, PNG, BMP, or SVG).
 */
export function convertWmfToDisplayable(data: Uint8Array): string | null {
  if (data.length < 40) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  let offset = 0;
  let boundLeft = 0,
    boundTop = 0,
    boundRight = 200,
    boundBottom = 150;

  // Check Aldus Placeable Header: 0x9AC6CDD7
  const magic = view.getUint32(0, true);
  if (magic === 0x9ac6cdd7) {
    boundLeft = view.getInt16(6, true);
    boundTop = view.getInt16(8, true);
    boundRight = view.getInt16(10, true);
    boundBottom = view.getInt16(12, true);
    offset = 22; // Aldus header size is 22 bytes
  }

  if (offset + 18 > data.length) return null;

  const width = Math.max(1, boundRight - boundLeft);
  const height = Math.max(1, boundBottom - boundTop);

  // Scan WMF records
  let pos = offset + 18;
  const svgElements: string[] = [];
  let curX = 0,
    curY = 0;
  const strokeColor = "#000000";
  const strokeWidth = 1;
  const fillColor = "none";
  let guard = 0;

  while (pos + 6 <= data.length && guard++ < 100000) {
    const rdSize = view.getUint32(pos, true);
    const rdFunc = view.getUint16(pos + 4, true);
    const recBytes = rdSize * 2;
    if (recBytes < 6 || pos + recBytes > data.length) break;

    // META_DIBSTRETCHBLT (0x0b41) or META_STRETCHDIB (0x0f43)
    if (rdFunc === 0x0b41 || rdFunc === 0x0f43) {
      const bitBytes = data.subarray(pos + 6, pos + recBytes);
      const direct = checkDirectImage(bitBytes);
      if (direct) return direct;
      // Search inside record for JPEG or PNG header
      for (let k = 0; k < bitBytes.length - 8; k++) {
        if (
          bitBytes[k] === 0xff &&
          bitBytes[k + 1] === 0xd8 &&
          bitBytes[k + 2] === 0xff
        ) {
          return `data:image/jpeg;base64,${u8ToBase64(bitBytes.subarray(k))}`;
        }
        if (
          bitBytes[k] === 0x89 &&
          bitBytes[k + 1] === 0x50 &&
          bitBytes[k + 2] === 0x4e &&
          bitBytes[k + 3] === 0x47
        ) {
          return `data:image/png;base64,${u8ToBase64(bitBytes.subarray(k))}`;
        }
      }
    } else if (rdFunc === 0x0214) {
      // META_MOVETO
      curY = view.getInt16(pos + 6, true);
      curX = view.getInt16(pos + 8, true);
    } else if (rdFunc === 0x0213) {
      // META_LINETO
      const y = view.getInt16(pos + 6, true);
      const x = view.getInt16(pos + 8, true);
      svgElements.push(
        `<line x1="${curX}" y1="${curY}" x2="${x}" y2="${y}" stroke="${strokeColor}" stroke-width="${strokeWidth}"/>`,
      );
      curX = x;
      curY = y;
    } else if (rdFunc === 0x041b) {
      // META_RECTANGLE
      const b = view.getInt16(pos + 6, true);
      const r = view.getInt16(pos + 8, true);
      const t = view.getInt16(pos + 10, true);
      const l = view.getInt16(pos + 12, true);
      svgElements.push(
        `<rect x="${l}" y="${t}" width="${Math.max(1, r - l)}" height="${Math.max(1, b - t)}" fill="${fillColor}" stroke="${strokeColor}" stroke-width="${strokeWidth}"/>`,
      );
    }

    pos += recBytes;
  }

  if (svgElements.length > 0) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${boundLeft} ${boundTop} ${width} ${height}" width="${width}" height="${height}">${svgElements.join("")}</svg>`;
    const encoded = encodeURIComponent(svg).replace(/'/g, "%27").replace(/"/g, "%22");
    return `data:image/svg+xml;utf8,${encoded}`;
  }

  // Fallback SVG
  const fallbackSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#f8fafc" stroke="#e2e8f0" stroke-width="1"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#94a3b8" font-family="sans-serif" font-size="14">WMF Vector Image</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(fallbackSvg)}`;
}

/**
 * Universal dispatcher for any metafile / vector image.
 * Returns browser-renderable data URL (PNG, JPEG, BMP, or SVG) or null.
 */
export function convertMetafileToDisplayable(data: Uint8Array, filename: string): string | null {
  const ext = filename.toLowerCase().split(".").pop() || "";
  if (ext === "emf") {
    return convertEmfToDisplayable(data);
  }
  if (ext === "wmf") {
    return convertWmfToDisplayable(data);
  }
  // Also check magic bytes directly
  if (data.length >= 44) {
    const sig =
      String.fromCharCode(data[40]) +
      String.fromCharCode(data[41]) +
      String.fromCharCode(data[42]) +
      String.fromCharCode(data[43]);
    if (sig === " EMF") return convertEmfToDisplayable(data);
  }
  if (data.length >= 4) {
    const magic = (data[0] | (data[1] << 8) | (data[2] << 16) | (data[3] << 24)) >>> 0;
    if (magic === 0x9ac6cdd7) return convertWmfToDisplayable(data);
  }
  return null;
}
