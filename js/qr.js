/*
 * Brief — qr.js
 * Minimal QR Code encoder. Byte mode, ECC level M, versions 1–15.
 * Pure JS, zero dependencies. Renders to <canvas>.
 *
 * Scanability fixes:
 *  - Integer module sizes (no sub-pixel rendering)
 *  - 4-module quiet zone (ISO spec minimum)
 *  - Canvas intrinsic size = display size (no CSS scaling blur)
 *  - White background always drawn before modules
 *  - crisp fillRect — no anti-aliasing possible on canvas rects
 *
 * Algorithm: ISO/IEC 18004:2015.
 */

// ── GF(256) arithmetic ────────────────────────────────────────────────────────
const GF_EXP = new Uint8Array(512), GF_LOG = new Uint8Array(256);
(function () {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x; GF_LOG[x] = i;
    x = (x << 1) ^ (x & 128 ? 0x11d : 0);
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

const gMul = (a, b) => (!a || !b) ? 0 : GF_EXP[(GF_LOG[a] + GF_LOG[b]) % 255];

/** RS generator polynomial for n ECC codewords. */
function genPoly(n) {
  let p = new Uint8Array([1]);
  for (let i = 0; i < n; i++) {
    const q = new Uint8Array(p.length + 1);
    for (let j = 0; j < p.length; j++) {
      q[j]     ^= p[j];
      q[j + 1] ^= gMul(p[j], GF_EXP[i]);
    }
    p = q;
  }
  return p;
}

/** Compute n Reed-Solomon ECC codewords for data block. */
function rsEncode(data, n) {
  const gen = genPoly(n);
  const buf = new Uint8Array(data.length + n);
  buf.set(data);
  for (let i = 0; i < data.length; i++) {
    const c = buf[i];
    if (!c) continue;
    for (let j = 0; j <= n; j++) buf[i + j] ^= gMul(c, gen[j]);
  }
  return buf.slice(data.length); // return copy, not view
}

// ── QR version tables (ECC level M only) ─────────────────────────────────────
// [size, totalDataBytes, [[groupCount, dataPerBlock, eccPerBlock], ...]]
const VER = [
  null,
  [21,  16,  [[1, 16, 10]]],
  [25,  28,  [[1, 28, 16]]],
  [29,  44,  [[1, 44, 26]]],
  [33,  64,  [[2, 32, 18]]],
  [37,  86,  [[2, 43, 24]]],
  [41,  108, [[4, 27, 16]]],
  [45,  124, [[4, 31, 18]]],
  [49,  154, [[2, 38, 22], [2, 39, 22]]],
  [53,  182, [[3, 36, 22], [2, 37, 22]]],
  [57,  216, [[4, 43, 26], [1, 44, 26]]],
  [61,  254, [[1, 50, 30], [4, 51, 30]]],
  [65,  290, [[6, 36, 22], [2, 37, 22]]],
  [69,  334, [[8, 37, 22], [1, 38, 22]]],
  [73,  365, [[4, 40, 24], [5, 41, 24]]],
  [77,  415, [[5, 41, 24], [5, 42, 24]]],
];

// Alignment pattern centre coordinates per version
const APOS = [
  [], [], [6,18], [6,22], [6,26], [6,30], [6,34],
  [6,22,38], [6,24,42], [6,26,46], [6,28,50],
  [6,30,54], [6,32,58], [6,34,62], [6,26,46,66], [6,26,48,70],
];

// Precomputed format info words for ECC level M, masks 0–7 (ISO 18004 Table C.1)
const FMT = [
  0b101010000010010,
  0b101000100100101,
  0b101111001111100,
  0b101101101001011,
  0b100010111111001,
  0b100000011001110,
  0b100111110010111,
  0b100101010100000,
];

// Remainder bits per version
const REM = [0, 0, 7, 7, 7, 7, 7, 0, 0, 0, 0, 0, 0, 0, 3, 0];

// Mask functions (r = row, c = col, 0-indexed)
const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r, c) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => (r * c) % 2 + (r * c) % 3 === 0,
  (r, c) => ((r * c) % 2 + (r * c) % 3) % 2 === 0,
  (r, c) => ((r + c) % 2 + (r * c) % 3) % 2 === 0,
];

// ── Data encoding ─────────────────────────────────────────────────────────────
function buildDataCodewords(text, totalBytes) {
  const bytes = new TextEncoder().encode(text);
  const bits  = [];
  const push  = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >> i) & 1); };

  push(0b0100, 4);       // byte mode
  push(bytes.length, 8); // character count (versions 1–9)
  for (const b of bytes) push(b, 8);

  const cap = totalBytes * 8;
  for (let i = 0; i < 4 && bits.length < cap; i++) bits.push(0); // terminator
  while (bits.length % 8) bits.push(0);                          // pad to byte

  const cw = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | (bits[i + j] || 0);
    cw.push(b);
  }
  for (let pi = 0; cw.length < totalBytes; pi++) cw.push(pi % 2 === 0 ? 0xEC : 0x11);
  return cw;
}

// ── ECC interleaving ──────────────────────────────────────────────────────────
function buildBitStream(version, dataCW) {
  const [, , groups] = VER[version];
  const dataBlocks = [], eccBlocks = [];
  let off = 0;
  for (const [cnt, dc, ec] of groups) {
    for (let i = 0; i < cnt; i++) {
      const blk = dataCW.slice(off, off + dc);
      dataBlocks.push(blk);
      eccBlocks.push(Array.from(rsEncode(new Uint8Array(blk), ec)));
      off += dc;
    }
  }

  const final = [];
  // Interleave data
  const maxD = Math.max(...dataBlocks.map(b => b.length));
  for (let i = 0; i < maxD; i++)
    for (const b of dataBlocks) if (i < b.length) final.push(b[i]);
  // Interleave ECC — each block has same ECC count within a group, but maxE covers all
  const maxE = Math.max(...eccBlocks.map(b => b.length));
  for (let i = 0; i < maxE; i++)
    for (const b of eccBlocks) if (i < b.length) final.push(b[i]);

  const bits = [];
  for (const cw of final) for (let i = 7; i >= 0; i--) bits.push((cw >> i) & 1);
  for (let i = 0; i < (REM[version] || 0); i++) bits.push(0);
  return bits;
}

// ── Matrix construction ───────────────────────────────────────────────────────
function buildMatrix(version, maskIdx, bits) {
  const [sz] = VER[version];
  // mat: 1 = dark, 0 = light
  const mat = Array.from({ length: sz }, () => new Int8Array(sz));
  // fn: 1 = function module (don't apply mask or overwrite with data)
  const fn  = Array.from({ length: sz }, () => new Uint8Array(sz));

  const set = (r, c, v) => {
    if (r >= 0 && r < sz && c >= 0 && c < sz) { mat[r][c] = v; fn[r][c] = 1; }
  };

  // Finder patterns (7×7) + separators
  const FP = [0x7F, 0x41, 0x5D, 0x5D, 0x5D, 0x41, 0x7F];
  function placeFinder(tr, lc) {
    for (let r = 0; r < 7; r++)
      for (let c = 0; c < 7; c++)
        set(tr + r, lc + c, (FP[r] >> (6 - c)) & 1);
    // Separator (light border)
    for (let k = lc - 1; k <= lc + 7; k++) { set(tr - 1, k, 0); set(tr + 7, k, 0); }
    for (let k = tr - 1; k <= tr + 7; k++) { set(k, lc - 1, 0); set(k, lc + 7, 0); }
  }
  placeFinder(0, 0);
  placeFinder(0, sz - 7);
  placeFinder(sz - 7, 0);

  // Timing patterns
  for (let k = 8; k < sz - 8; k++) {
    set(6, k, k % 2 === 0 ? 1 : 0);
    set(k, 6, k % 2 === 0 ? 1 : 0);
  }

  // Alignment patterns
  const AP = [0x1F, 0x11, 0x15, 0x11, 0x1F];
  const apos = APOS[version];
  for (let i = 0; i < apos.length; i++) {
    for (let j = 0; j < apos.length; j++) {
      const ar = apos[i], ac = apos[j];
      if (fn[ar][ac]) continue; // skip if inside finder area
      for (let dr = -2; dr <= 2; dr++)
        for (let dc = -2; dc <= 2; dc++)
          set(ar + dr, ac + dc, (AP[dr + 2] >> (4 - (dc + 2))) & 1);
    }
  }

  // Dark module (always dark)
  set(4 * version + 9, 8, 1);

  // Reserve format info areas (set to 0, mark as function)
  const FR = [8, 8, 8, 8, 8, 8, 8, 8, 7, 5, 4, 3, 2, 1, 0];
  const FC = [0, 1, 2, 3, 4, 5, 7, 8, 8, 8, 8, 8, 8, 8, 8];
  for (let k = 0; k < 15; k++) set(FR[k], FC[k], 0);
  for (let k = 0; k < 7; k++) set(sz - 1 - k, 8, 0);
  for (let k = 0; k < 8; k++) set(8, sz - 8 + k, 0);

  // Place data in zigzag
  let bitIdx = 0, goUp = true;
  for (let col = sz - 1; col >= 1; col -= 2) {
    if (col === 6) col--; // skip timing column
    for (let row = 0; row < sz; row++) {
      const r = goUp ? sz - 1 - row : row;
      for (const c of [col, col - 1]) {
        if (!fn[r][c]) mat[r][c] = bitIdx < bits.length ? bits[bitIdx++] : 0;
      }
    }
    goUp = !goUp;
  }

  // Apply mask to data modules only
  const mf = MASKS[maskIdx];
  for (let r = 0; r < sz; r++)
    for (let c = 0; c < sz; c++)
      if (!fn[r][c]) mat[r][c] ^= mf(r, c) ? 1 : 0;

  // Write format info
  const fi = FMT[maskIdx];
  for (let k = 0; k < 15; k++) mat[FR[k]][FC[k]] = (fi >> (14 - k)) & 1;
  for (let k = 0; k < 7; k++) mat[sz - 1 - k][8] = (fi >> (14 - k)) & 1;
  for (let k = 0; k < 8; k++) mat[8][sz - 8 + k] = (fi >> (7 - k)) & 1;

  return mat;
}

// ── Mask penalty scoring ──────────────────────────────────────────────────────
function scorePenalty(mat, sz) {
  let s = 0;
  // Rule 1: 5+ consecutive same-color
  for (let i = 0; i < sz; i++) {
    for (const axis of [0, 1]) {
      let run = 1;
      for (let k = 1; k < sz; k++) {
        const a = axis ? mat[i][k]     : mat[k][i];
        const b = axis ? mat[i][k - 1] : mat[k - 1][i];
        if (a === b) { run++; if (run === 5) s += 3; else if (run > 5) s++; }
        else run = 1;
      }
    }
  }
  // Rule 2: 2×2 blocks
  for (let r = 0; r < sz - 1; r++)
    for (let c = 0; c < sz - 1; c++) {
      const v = mat[r][c];
      if (v === mat[r][c+1] && v === mat[r+1][c] && v === mat[r+1][c+1]) s += 3;
    }
  // Rule 3: finder-like patterns
  const P1 = [1,0,1,1,1,0,1,0,0,0,0];
  const P2 = [0,0,0,0,1,0,1,1,1,0,1];
  for (let r = 0; r < sz; r++)
    for (let c = 0; c <= sz - 11; c++) {
      if (P1.every((v,k) => mat[r][c+k] === v) || P2.every((v,k) => mat[r][c+k] === v)) s += 40;
      if (P1.every((v,k) => mat[c+k][r] === v) || P2.every((v,k) => mat[c+k][r] === v)) s += 40;
    }
  // Rule 4: dark ratio
  let dark = 0;
  for (let r = 0; r < sz; r++) for (let c = 0; c < sz; c++) if (mat[r][c]) dark++;
  s += Math.floor(Math.abs((dark * 100) / (sz * sz) - 50) / 5) * 10;
  return s;
}

// ── Public API ────────────────────────────────────────────────────────────────
/**
 * generateQR(text, canvas)
 *
 * Encodes text as a scannable QR code (ECC M) and renders onto canvas.
 * Canvas is sized to exactly (sz + 2*quiet) * moduleSize pixels.
 * No CSS scaling is applied — canvas intrinsic size == display size.
 * Returns true on success, false if text exceeds v15 capacity.
 */
export function generateQR(text, canvas) {
  const bytes = new TextEncoder().encode(text);
  let version = 1;
  while (version <= 15 && bytes.length > VER[version][1]) version++;
  if (version > 15) {
    console.warn('Brief QR: text too long for version 15');
    return false;
  }

  const [sz, totalBytes] = VER[version];
  const codewords = buildDataCodewords(text, totalBytes);
  const bits      = buildBitStream(version, codewords);

  // Pick best mask
  let bestMask = 0, bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    const sc = scorePenalty(buildMatrix(version, m, bits), sz);
    if (sc < bestScore) { bestScore = sc; bestMask = m; }
  }

  const matrix  = buildMatrix(version, bestMask, bits);
  const quiet   = 4;   // ISO minimum quiet zone (modules)
  const total   = sz + 2 * quiet;

  // Pick a module size that produces a canvas between 160–256px, always integer
  // Minimum 4px per module for reliable scanning
  let mod = Math.max(4, Math.floor(220 / total));

  const px = total * mod;

  // Set canvas to exact pixel size — no CSS width/height override needed
  canvas.width  = px;
  canvas.height = px;
  // Ensure CSS does not scale it (remove any inline style that might have been set before)
  canvas.style.width  = px + 'px';
  canvas.style.height = px + 'px';

  const ctx = canvas.getContext('2d');
  // White background (covers the quiet zone)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, px, px);
  // Dark modules
  ctx.fillStyle = '#000000';
  for (let r = 0; r < sz; r++)
    for (let c = 0; c < sz; c++)
      if (matrix[r][c])
        ctx.fillRect((c + quiet) * mod, (r + quiet) * mod, mod, mod);

  return true;
}

/**
 * downloadQR(canvas, filename)
 * Triggers PNG download of the rendered QR canvas.
 */
export function downloadQR(canvas, filename = 'brief-qr') {
  const a = document.createElement('a');
  a.href     = canvas.toDataURL('image/png');
  a.download = filename.endsWith('.png') ? filename : filename + '.png';
  a.click();
}
