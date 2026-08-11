import { deflateSync } from 'node:zlib';

/**
 * A minimal PNG encoder: 8-bit RGBA, no interlacing, filter 0.
 *
 * Factored out of `make-plaster.mjs`, which had it inline, because the launcher
 * icon needs the same forty lines of CRC and zlib and two copies would be two
 * chances to get the checksum wrong in different ways.
 *
 * Filter 0 (none) throughout. The clever filters predict a pixel from its
 * neighbours and pay off on photographs; these are flat colour over an
 * antialiased edge, where the win is small and the code is not.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb8_8320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffff_ffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffff_ffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/**
 * @param width  pixels
 * @param height pixels
 * @param rgba   Uint8Array of width*height*4, straight (not premultiplied)
 */
export function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type 6 — RGBA
  // 10..12 are compression, filter and interlace, all zero.

  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.subarray(y * stride, (y + 1) * stride)).copy(raw, y * (stride + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** `#rrggbb` → [r, g, b]. */
export function rgb(hex) {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/**
 * Coverage → pixels: `ink` laid over `ground`, or over nothing.
 *
 * A null ground leaves the background transparent, which is what an Android
 * adaptive foreground and a monochrome layer both need — the system supplies
 * what goes behind them.
 */
export function compose(coverage, size, ink, ground) {
  const out = new Uint8Array(size * size * 4);
  const [ir, ig, ib] = rgb(ink);
  const back = ground === null ? null : rgb(ground);

  for (let i = 0; i < coverage.length; i += 1) {
    const a = coverage[i];
    const at = i * 4;

    if (back === null) {
      out[at] = ir;
      out[at + 1] = ig;
      out[at + 2] = ib;
      out[at + 3] = Math.round(a * 255);
      continue;
    }

    out[at] = Math.round(back[0] + (ir - back[0]) * a);
    out[at + 1] = Math.round(back[1] + (ig - back[1]) * a);
    out[at + 2] = Math.round(back[2] + (ib - back[2]) * a);
    out[at + 3] = 255;
  }

  return out;
}
