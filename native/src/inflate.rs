/// Minimal, dependency-free RFC 1951 / RFC 1952 GZIP & DEFLATE decompressor.
/// Used to unpack embedded WebView2 UI assets in-process so synthetic responses
/// work identically regardless of HTTP Content-Encoding decoder behavior.

struct BitReader<'a> {
    data: &'a [u8],
    byte_pos: usize,
    bit_pos: u8,
}

impl<'a> BitReader<'a> {
    fn new(data: &'a [u8]) -> Self {
        Self { data, byte_pos: 0, bit_pos: 0 }
    }

    fn read_bit(&mut self) -> Option<u32> {
        let b = *self.data.get(self.byte_pos)?;
        let bit = ((b >> self.bit_pos) & 1) as u32;
        self.bit_pos += 1;
        if self.bit_pos == 8 {
            self.bit_pos = 0;
            self.byte_pos += 1;
        }
        Some(bit)
    }

    fn read_bits(&mut self, n: u8) -> Option<u32> {
        let mut val = 0u32;
        for i in 0..n {
            val |= self.read_bit()? << i;
        }
        Some(val)
    }

    fn align_byte(&mut self) {
        if self.bit_pos != 0 {
            self.bit_pos = 0;
            self.byte_pos += 1;
        }
    }

    fn read_u16_le(&mut self) -> Option<u16> {
        let lo = *self.data.get(self.byte_pos)?;
        let hi = *self.data.get(self.byte_pos + 1)?;
        self.byte_pos += 2;
        Some(u16::from_le_bytes([lo, hi]))
    }

    fn read_slice(&mut self, len: usize) -> Option<&'a [u8]> {
        let end = self.byte_pos.checked_add(len)?;
        let s = self.data.get(self.byte_pos..end)?;
        self.byte_pos = end;
        Some(s)
    }
}

struct HuffTable {
    count: [u16; 16],
    base_code: [i32; 16],
    first_sym: [u16; 16],
    syms: Vec<u16>,
}

impl HuffTable {
    fn from_lengths(lengths: &[u8]) -> Option<Self> {
        let mut count = [0u16; 16];
        for &l in lengths {
            if l as usize >= 16 {
                return None;
            }
            count[l as usize] += 1;
        }
        count[0] = 0;

        let mut base_code = [0i32; 16];
        let mut first_sym = [0u16; 16];
        let mut code = 0i32;
        let mut sym_idx = 0u16;
        for bits in 1..16 {
            code = (code + count[bits - 1] as i32) << 1;
            base_code[bits] = code;
            first_sym[bits] = sym_idx;
            sym_idx = sym_idx.checked_add(count[bits])?;
        }

        let mut syms = vec![0u16; sym_idx as usize];
        let mut offs = first_sym;
        for (sym, &len) in lengths.iter().enumerate() {
            if len != 0 {
                let pos = offs[len as usize] as usize;
                offs[len as usize] += 1;
                syms[pos] = sym as u16;
            }
        }
        Some(Self { count, base_code, first_sym, syms })
    }

    fn decode(&self, r: &mut BitReader<'_>) -> Option<u16> {
        let mut code = 0i32;
        for len in 1..16 {
            code = (code << 1) | (r.read_bit()? as i32);
            let idx = code - self.base_code[len];
            let cnt = self.count[len] as i32;
            if idx >= 0 && idx < cnt {
                return Some(self.syms[self.first_sym[len] as usize + idx as usize]);
            }
        }
        None
    }
}

fn fixed_tables() -> Option<(HuffTable, HuffTable)> {
    let mut ll = [0u8; 288];
    for i in 0..=143 { ll[i] = 8; }
    for i in 144..=255 { ll[i] = 9; }
    for i in 256..=279 { ll[i] = 7; }
    for i in 280..=287 { ll[i] = 8; }
    let dist = [5u8; 32];
    Some((HuffTable::from_lengths(&ll)?, HuffTable::from_lengths(&dist)?))
}

fn dynamic_tables(r: &mut BitReader<'_>) -> Option<(HuffTable, HuffTable)> {
    const CL_ORDER: [usize; 19] = [
        16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15,
    ];
    let hlit = r.read_bits(5)? as usize + 257;
    let hdist = r.read_bits(5)? as usize + 1;
    let hclen = r.read_bits(4)? as usize + 4;
    if hlit > 286 || hdist > 30 || hclen > 19 {
        return None;
    }

    let mut cl_lens = [0u8; 19];
    for i in 0..hclen {
        cl_lens[CL_ORDER[i]] = r.read_bits(3)? as u8;
    }
    let cl_tbl = HuffTable::from_lengths(&cl_lens)?;

    let total = hlit + hdist;
    let mut lengths = Vec::with_capacity(total);
    while lengths.len() < total {
        let sym = cl_tbl.decode(r)?;
        match sym {
            0..=15 => lengths.push(sym as u8),
            16 => {
                let prev = *lengths.last()?;
                let rep = r.read_bits(2)? as usize + 3;
                for _ in 0..rep {
                    if lengths.len() >= total { return None; }
                    lengths.push(prev);
                }
            }
            17 | 18 => {
                let rep = if sym == 17 {
                    r.read_bits(3)? as usize + 3
                } else {
                    r.read_bits(7)? as usize + 11
                };
                for _ in 0..rep {
                    if lengths.len() >= total { return None; }
                    lengths.push(0);
                }
            }
            _ => return None,
        }
    }
    Some((
        HuffTable::from_lengths(&lengths[..hlit])?,
        HuffTable::from_lengths(&lengths[hlit..])?,
    ))
}

fn inflate_raw(raw: &[u8], cap_hint: usize) -> Option<Vec<u8>> {
    const LEN_BASE: [u16; 29] = [
        3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59,
        67, 83, 99, 115, 131, 163, 195, 227, 258,
    ];
    const LEN_EXTRA: [u8; 29] = [
        0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3,
        4, 4, 4, 4, 5, 5, 5, 5, 0,
    ];
    const DIST_BASE: [u16; 30] = [
        1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385,
        513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
    ];
    const DIST_EXTRA: [u8; 30] = [
        0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7,
        8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
    ];

    let mut r = BitReader::new(raw);
    let mut out = Vec::with_capacity(cap_hint);
    loop {
        let bfinal = r.read_bit()?;
        let btype = r.read_bits(2)?;
        if btype == 0 {
            r.align_byte();
            let len = r.read_u16_le()? as usize;
            let nlen = r.read_u16_le()?;
            if len != (!nlen) as usize {
                return None;
            }
            out.extend_from_slice(r.read_slice(len)?);
        } else if btype == 1 || btype == 2 {
            let (ll, dist_tbl) = if btype == 1 { fixed_tables()? } else { dynamic_tables(&mut r)? };
            loop {
                let sym = ll.decode(&mut r)?;
                if sym < 256 {
                    out.push(sym as u8);
                } else if sym == 256 {
                    break;
                } else {
                    let li = (sym - 257) as usize;
                    if li >= LEN_BASE.len() {
                        return None;
                    }
                    let length = LEN_BASE[li] as usize + r.read_bits(LEN_EXTRA[li])? as usize;
                    let di = dist_tbl.decode(&mut r)? as usize;
                    if di >= DIST_BASE.len() {
                        return None;
                    }
                    let dist = DIST_BASE[di] as usize + r.read_bits(DIST_EXTRA[di])? as usize;
                    if dist == 0 || dist > out.len() {
                        return None;
                    }
                    for _ in 0..length {
                        let b = out[out.len() - dist];
                        out.push(b);
                    }
                }
            }
        } else {
            return None;
        }
        if bfinal == 1 {
            break;
        }
    }
    Some(out)
}

pub fn gzip(src: &[u8]) -> Option<Vec<u8>> {
    if src.len() < 18 || src[0] != 0x1F || src[1] != 0x8B || src[2] != 0x08 {
        return None;
    }
    let flg = src[3];
    let mut pos = 10usize;
    if flg & 0x04 != 0 {
        let xlen = u16::from_le_bytes([*src.get(pos)?, *src.get(pos + 1)?]) as usize;
        pos = pos.checked_add(2 + xlen)?;
    }
    if flg & 0x08 != 0 {
        while *src.get(pos)? != 0 { pos += 1; }
        pos += 1;
    }
    if flg & 0x10 != 0 {
        while *src.get(pos)? != 0 { pos += 1; }
        pos += 1;
    }
    if flg & 0x02 != 0 {
        pos = pos.checked_add(2)?;
    }
    let end = src.len().checked_sub(8)?;
    if pos > end {
        return None;
    }
    let isize_hint = u32::from_le_bytes([src[end + 4], src[end + 5], src[end + 6], src[end + 7]]) as usize;
    inflate_raw(&src[pos..end], isize_hint.min(8 * 1024 * 1024))
}
