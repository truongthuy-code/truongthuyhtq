/**
 * Minimal read-only Compound File Binary (OLE2 / CFB) reader.
 *
 * Used to pull named streams (e.g. "Equation Native") out of the OLE objects
 * stored in `word/embeddings/oleObjectNN.bin` inside a .docx package.
 *
 * SECURITY: this only reads bytes — no embedded object is ever executed,
 * no COM/ActiveX/macro is invoked. Malformed input throws instead of crashing.
 */

const CFB_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const FREE_SECT_MIN = 0xfffffffa;

export function isCfb(buf: Uint8Array): boolean {
  if (buf.length < 512) return false;
  for (let i = 0; i < 8; i++) if (buf[i] !== CFB_SIGNATURE[i]) return false;
  return true;
}

/** Reads all streams of a CFB file, keyed by (case-sensitive) entry name. */
export function readCfbStreams(buf: Uint8Array): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  if (!isCfb(buf)) return out;

  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const sectorSize = 1 << dv.getUint16(30, true);
  const miniSectorSize = 1 << dv.getUint16(32, true);
  const numFatSectors = dv.getUint32(44, true);
  const dirStart = dv.getUint32(48, true);
  const miniFatStart = dv.getUint32(60, true);
  const difStart = dv.getUint32(68, true);
  const numDifSectors = dv.getUint32(72, true);

  const sector = (i: number): Uint8Array => {
    const off = (i + 1) * sectorSize;
    if (off + sectorSize > buf.length) return new Uint8Array(sectorSize);
    return buf.subarray(off, off + sectorSize);
  };

  // Collect FAT sector numbers (header DIFAT + extra DIFAT sectors).
  const fatSectorIds: number[] = [];
  for (let i = 0; i < 109 && fatSectorIds.length < numFatSectors; i++) {
    const s = dv.getUint32(76 + i * 4, true);
    if (s < FREE_SECT_MIN) fatSectorIds.push(s);
  }
  let dif = difStart;
  let guard = 0;
  while (dif < FREE_SECT_MIN && guard++ < numDifSectors + 8) {
    const s = sector(dif);
    const sdv = new DataView(s.buffer, s.byteOffset, s.byteLength);
    const n = sectorSize / 4 - 1;
    for (let i = 0; i < n; i++) {
      const v = sdv.getUint32(i * 4, true);
      if (v < FREE_SECT_MIN) fatSectorIds.push(v);
    }
    dif = sdv.getUint32(n * 4, true);
  }

  const readChainInts = (ids: number[]): Uint32Array => {
    const arr = new Uint32Array(ids.length * (sectorSize / 4));
    ids.forEach((id, k) => {
      const s = sector(id);
      const sdv = new DataView(s.buffer, s.byteOffset, s.byteLength);
      for (let i = 0; i < sectorSize / 4; i++) {
        arr[k * (sectorSize / 4) + i] = sdv.getUint32(i * 4, true);
      }
    });
    return arr;
  };

  const fat = readChainInts(fatSectorIds);

  const chain = (start: number): number[] => {
    const list: number[] = [];
    let i = start;
    let steps = 0;
    while (i < FREE_SECT_MIN && steps++ < fat.length + 8) {
      list.push(i);
      i = fat[i];
      if (i === undefined) break;
    }
    return list;
  };

  const readStream = (start: number, size?: number): Uint8Array => {
    const ids = chain(start);
    const total = ids.length * sectorSize;
    const res = new Uint8Array(total);
    ids.forEach((id, k) => res.set(sector(id), k * sectorSize));
    return size !== undefined ? res.subarray(0, size) : res;
  };

  // Directory entries
  const dirData = readStream(dirStart);
  type Entry = { name: string; type: number; start: number; size: number };
  const entries: Entry[] = [];
  for (let off = 0; off + 128 <= dirData.length; off += 128) {
    const edv = new DataView(dirData.buffer, dirData.byteOffset + off, 128);
    const nameLen = edv.getUint16(64, true);
    let name = "";
    for (let i = 0; i + 1 < Math.max(0, nameLen - 2); i += 2) {
      name += String.fromCharCode(edv.getUint16(i, true));
    }
    entries.push({
      name,
      type: edv.getUint8(66),
      start: edv.getUint32(116, true),
      size: edv.getUint32(120, true),
    });
  }

  const root = entries.find((e) => e.type === 5);
  const miniData = root ? readStream(root.start) : new Uint8Array(0);
  const miniFatIds = chain(miniFatStart);
  const miniFat = readChainInts(miniFatIds);

  const readMini = (start: number, size: number): Uint8Array => {
    const res = new Uint8Array(size);
    let i = start;
    let written = 0;
    let steps = 0;
    while (i < FREE_SECT_MIN && written < size && steps++ < miniFat.length + 8) {
      const from = i * miniSectorSize;
      const take = Math.min(miniSectorSize, size - written);
      res.set(miniData.subarray(from, from + take), written);
      written += take;
      i = miniFat[i];
      if (i === undefined) break;
    }
    return res;
  };

  for (const e of entries) {
    if (e.type !== 2 || !e.name) continue;
    try {
      out.set(e.name, e.size >= 4096 ? readStream(e.start, e.size) : readMini(e.start, e.size));
    } catch {
      /* skip unreadable stream */
    }
  }
  return out;
}
