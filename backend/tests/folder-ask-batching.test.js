// Tes buildAskBatches — jalankan: node tests/folder-ask-batching.test.js (dari folder backend/)
const assert = require('assert');
const { buildAskBatches } = require('../src/services/notulen.service');

function makeSession(id, judul, nSegs, segLen) {
  const segments = [];
  for (let i = 0; i < nSegs; i++) {
    segments.push({ text: `${judul}-seg${i}-` + 'x'.repeat(segLen), timestamp_seconds: i * 10 });
  }
  return { session: { id, judul, tanggal: '2026-07-01' }, segments };
}

// 1. Dua sesi kecil → satu batch bersama, header per sesi ada
{
  const input = [makeSession(1, 'SesiA', 5, 50), makeSession(2, 'SesiB', 5, 50)];
  const batches = buildAskBatches(input, 10000);
  assert.strictEqual(batches.length, 1, 'dua sesi kecil harus berbagi satu batch');
  assert.ok(batches[0].text.includes('=== SESI: SesiA — 2026-07-01 ==='), 'header SesiA');
  assert.ok(batches[0].text.includes('=== SESI: SesiB — 2026-07-01 ==='), 'header SesiB');
  assert.deepStrictEqual(batches[0].sessionIds, [1, 2]);
}

// 2. Sesi lebih besar dari maxChars → dipecah dengan label (bagian n/m)
{
  const input = [makeSession(1, 'BIG', 40, 500)]; // ±20rb karakter
  const batches = buildAskBatches(input, 6000);
  assert.ok(batches.length >= 3, `sesi besar harus terpecah, dapat ${batches.length}`);
  assert.ok(batches[0].text.includes('(bagian 1/'), 'label bagian ada');
}

// 3. INVARIAN INTI: setiap segmen muncul TEPAT SATU KALI, berurutan
{
  const input = [makeSession(1, 'AA', 7, 800), makeSession(2, 'BB', 30, 700), makeSession(3, 'CC', 2, 100)];
  const batches = buildAskBatches(input, 5000);
  const allTexts = input.flatMap(s => s.segments.map(g => g.text));
  const joined = batches.map(b => b.text).join('\n');
  let pos = 0;
  for (const t of allTexts) {
    const idx = joined.indexOf(t, pos);
    assert.ok(idx >= 0, `segmen hilang/tidak urut: ${t.slice(0, 30)}`);
    pos = idx + t.length;
  }
  for (const t of allTexts) {
    assert.strictEqual(joined.split(t).length - 1, 1, `segmen duplikat: ${t.slice(0, 30)}`);
  }
  for (const b of batches) {
    assert.ok(b.text.length <= 5200, `batch melebihi batas: ${b.text.length}`);
  }
}

// 4. Sesi tanpa segmen dilewati tanpa error
{
  const input = [{ session: { id: 9, judul: 'Kosong', tanggal: '2026-07-01' }, segments: [] }, makeSession(1, 'Isi', 3, 40)];
  const batches = buildAskBatches(input, 10000);
  assert.strictEqual(batches.length, 1);
  assert.deepStrictEqual(batches[0].sessionIds, [1]);
}

console.log('✅ folder-ask-batching: semua tes lulus');
process.exit(0); // pool DB ikut ter-require dari service — keluar eksplisit
