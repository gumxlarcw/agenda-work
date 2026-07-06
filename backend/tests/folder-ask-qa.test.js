// Tes askFolderQuestion dengan LLM palsu — jalankan: ASK_RETRY_BASE_MS=1 node tests/folder-ask-qa.test.js (dari backend/)
const assert = require('assert');
const { askFolderQuestion } = require('../src/services/notulen.service');

const folder = { id: 7, name: 'Folder Uji' };
function makeSession(id, judul, nSegs, segLen) {
  const segments = [];
  for (let i = 0; i < nSegs; i++) {
    segments.push({ text: `${judul}-seg${i}-` + 'x'.repeat(segLen), timestamp_seconds: i * 10 });
  }
  return { session: { id, judul, tanggal: '2026-07-01' }, segments };
}
// 4 sesi × ±30rb karakter → dengan maxChars default 50000 hasilnya multi-batch (±3 batch)
const sessions = [1, 2, 3, 4].map(i => makeSession(i, `Sesi${i}`, 40, 700));

(async () => {
  // 1. Alur normal: N panggilan ekstraksi + 1 panggilan final; jawaban dari LLM final
  {
    // PENTING: bedakan jenis panggilan dengan frasa UNIK 'asisten ekstraksi informasi'
    // (kata "ekstraksi" saja juga muncul di system prompt merge & final).
    const isExtract = (msgs) => msgs[0].content.includes('asisten ekstraksi informasi');
    const calls = [];
    const fakeLlm = async (messages, maxTokens) => {
      calls.push({ system: messages[0].content, user: messages[1].content, maxTokens });
      if (isExtract(messages)) {
        return 'Fakta relevan [SesiX — 00:10]';
      }
      return 'JAWABAN FINAL dengan sitasi [Sesi1 — 00:10]';
    };
    const progressLog = [];
    const result = await askFolderQuestion(folder, sessions, 'Apa isi rapat?',
      (p, s) => progressLog.push([p, s]), fakeLlm);

    const extractCalls = calls.filter(c => c.system.includes('asisten ekstraksi informasi'));
    const finalCalls = calls.filter(c => !c.system.includes('asisten ekstraksi informasi'));
    assert.ok(extractCalls.length >= 2, `harus multi-batch, dapat ${extractCalls.length}`);
    assert.strictEqual(finalCalls.length, 1, 'tepat satu panggilan final');
    assert.ok(finalCalls[0].user.includes('Apa isi rapat?'), 'pertanyaan sampai ke final');
    assert.ok(finalCalls[0].user.includes('Folder Uji'), 'nama folder di konteks final');
    assert.strictEqual(result.answer, 'JAWABAN FINAL dengan sitasi [Sesi1 — 00:10]');
    assert.strictEqual(result.batchFailed, 0);
    assert.strictEqual(result.sessionsCovered, 4);
    assert.ok(progressLog.some(([p]) => p === 100), 'progress mencapai 100');
    // Setiap batch (semua segmen) benar-benar terkirim ke LLM ekstraksi
    const sentText = extractCalls.map(c => c.user).join('\n');
    for (const s of sessions) {
      for (const seg of s.segments) {
        assert.ok(sentText.includes(seg.text), `segmen tidak terkirim: ${seg.text.slice(0, 25)}`);
      }
    }
  }

  // 2. Gagal sekali lalu retry sukses → TIDAK dihitung gagal (dokumentasi perilaku retry)
  {
    let extractSeq = 0;
    const fakeLlm = async (messages) => {
      if (messages[0].content.includes('asisten ekstraksi informasi')) {
        extractSeq++;
        if (extractSeq === 1) throw new Error('proxy 503'); // hanya panggilan pertama yang gagal
        return 'Fakta relevan [SesiX — 00:10]';
      }
      return 'JAWABAN UTUH';
    };
    const result = await askFolderQuestion(folder, sessions, 'Apa isi rapat?', null, fakeLlm);
    assert.strictEqual(result.batchFailed, 0, 'retry sukses tidak dihitung gagal');
    assert.ok(!result.answer.startsWith('⚠️'), 'tanpa peringatan bila retry menyelamatkan');
  }

  // 2b. Gagal permanen (batch pertama selalu gagal) → jawaban parsial + peringatan ⚠️
  {
    const fakeLlm = async (messages) => {
      if (messages[0].content.includes('asisten ekstraksi informasi')) {
        if (messages[1].content.includes('Sesi1-seg0-')) throw new Error('proxy 503');
        return 'Fakta relevan [SesiX — 00:10]';
      }
      return 'JAWABAN PARSIAL';
    };
    const result = await askFolderQuestion(folder, sessions, 'Apa isi rapat?', null, fakeLlm);
    assert.strictEqual(result.batchFailed, 1, 'satu batch gagal');
    assert.ok(result.answer.startsWith('⚠️'), 'ada peringatan parsial di awal jawaban');
    assert.ok(result.answer.includes('bagian transkrip gagal dibaca'), 'kalimat peringatan sesuai spec');
    assert.ok(result.answer.includes('JAWABAN PARSIAL'), 'jawaban tetap disusun');
  }

  // 3. Semua batch "TIDAK ADA INFORMASI RELEVAN" → jawaban jujur, tanpa panggilan final
  {
    const calls = [];
    const fakeLlm = async (messages) => {
      calls.push(messages[0].content);
      return 'TIDAK ADA INFORMASI RELEVAN';
    };
    const result = await askFolderQuestion(folder, sessions, 'Siapa presiden Mars?', null, fakeLlm);
    assert.ok(result.answer.includes('Tidak ditemukan informasi'), 'jawaban jujur');
    assert.ok(calls.every(c => c.includes('asisten ekstraksi informasi')), 'tidak ada panggilan final/reduce');
  }

  // 4. Semua batch gagal → throw (bukan jawaban kosong)
  {
    const fakeLlm = async (messages) => {
      if (messages[0].content.includes('asisten ekstraksi informasi')) throw new Error('proxy mati');
      return 'X';
    };
    let threw = false;
    try { await askFolderQuestion(folder, sessions, 'Apa saja?', null, fakeLlm); }
    catch (err) { threw = true; assert.ok(err.message.includes('Semua batch')); }
    assert.ok(threw, 'harus throw saat semua batch gagal');
  }

  console.log('✅ folder-ask-qa: semua tes lulus');
  process.exit(0);
})().catch(err => { console.error('❌', err.message); process.exit(1); });
