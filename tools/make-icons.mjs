// Generates the flat coloured-disc toolbar icons into src/icons/.
// Pure Node (zlib only) minimal PNG encoder — run with `node tools/make-icons.mjs`.

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "icons");
mkdirSync(OUT, { recursive: true });

const COLORS = {
  gold: [0xff, 0xc9, 0x3c], // branding (extensions page)
  gray: [0x82, 0x8a, 0xa0], // not on a Twitch page
  green: [0x3f, 0xba, 0x74], // connected, stream live
  blue: [0x4a, 0x95, 0xe0], // connected, stream offline (idle — not polling)
  yellow: [0xf0, 0xbe, 0x46], // missing a connection / still connecting
  red: [0xe2, 0x5c, 0x5c], // broken / needs login
};
const SIZES = [16, 32, 48, 128];

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return (buf) => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
})();

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(CRC(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, [r, g, b]) {
  const c = (size - 1) / 2;
  const rad = size * 0.44;
  const ring = Math.max(1, size * 0.09);
  const rowLen = size * 4 + 1;
  const raw = Buffer.alloc(rowLen * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      let a = 0;
      if (d <= rad - 0.6) a = 255;
      else if (d < rad + 0.6) a = Math.round((255 * (rad + 0.6 - d)) / 1.2);
      let rr = r, gg = g, bb = b;
      if (a && d > rad - ring) {
        rr = (r * 0.58) | 0;
        gg = (g * 0.58) | 0;
        bb = (b * 0.58) | 0;
      }
      const o = y * rowLen + 1 + x * 4;
      raw[o] = rr;
      raw[o + 1] = gg;
      raw[o + 2] = bb;
      raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

let n = 0;
for (const [name, rgb] of Object.entries(COLORS)) {
  for (const s of SIZES) {
    writeFileSync(join(OUT, `${name}-${s}.png`), png(s, rgb));
    n++;
  }
}
console.log(`wrote ${n} icons to src/icons/`);
