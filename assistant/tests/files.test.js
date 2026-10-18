import test from "node:test";
import assert from "node:assert/strict";
import {fileKind,validateFile,parseTable,inspectText,readAttachment,attachmentReply,MAX_FILE_BYTES,MAX_TEXT_BYTES,formatSize} from "../files.js";

test("classifies safe previews and keeps complex formats metadata-only",()=>{
  assert.equal(fileKind("PLAN.CSV"),"text");
  assert.equal(fileKind("asset.svg"),"text");
  assert.equal(fileKind("portrait.png"),"image");
  assert.equal(fileKind("mix.wav"),"audio");
  for(const name of ["document.pdf","workbook.xlsx","slides.pptx","film.mp4","unknown.bin"])assert.equal(fileKind(name),"metadata");
});
test("enforces empty, per-file and text limits before reading",()=>{
  assert.throws(()=>validateFile({name:"empty.txt",size:0}),/empty/);
  assert.throws(()=>validateFile({name:"large.pdf",size:MAX_FILE_BYTES+1}),/10 MB/);
  assert.throws(()=>validateFile({name:"large.txt",size:MAX_TEXT_BYTES+1}),/1 MB/);
  assert.doesNotThrow(()=>validateFile({name:"fine.txt",size:MAX_TEXT_BYTES}));
});
test("CSV handles BOM, quoted commas, escaped quotes, multiline fields and CRLF",()=>{
  assert.deepEqual(parseTable('\uFEFFName,Note\r\n"Jane, A","A ""quote"""\r\nBob,"line\nbreak"\r\n'),
    [["Name","Note"],["Jane, A",'A "quote"'],["Bob","line\nbreak"]]);
});
test("CSV rejects malformed quotes and excessive row counts",()=>{
  assert.throws(()=>parseTable('a,b\n"unfinished'),/Unclosed/);
  assert.throws(()=>parseTable('a,b\n"x"evil,2'),/closing quote/);
  assert.throws(()=>parseTable('a,b\nun"quoted,2'),/Unexpected/);
  assert.throws(()=>parseTable("a\n".repeat(10002)),/10,000/);
});
test("CSV and TSV checks report shape without executing spreadsheet formulas",()=>{
  const table=inspectText("budget.csv",'Name,Cost\nMaterials,20\n"=HYPERLINK(""bad"")",30\n');
  assert.match(table.summary,/2 data rows, 2 columns/);
  assert.match(table.summary,/Formulas are not executed/);
  assert.match(inspectText("bad.csv","A,B\n1\n").summary,/1 rows have a different/);
  assert.match(inspectText("data.tsv","A\tB\n1\t2").summary,/2 columns/);
});
test("invalid CSV has a clear check error rather than an invented result",()=>{
  assert.match(inspectText("bad.csv",'A,B\n"bad').summary,/Table check failed/);
});
test("JSON reports arrays, objects, primitives and invalid input",()=>{
  assert.match(inspectText("list.json","[1,2,3]").summary,/Array with 3 items/);
  assert.match(inspectText("config.json",'{"colour":"gold","size":12}').summary,/2 keys/);
  assert.match(inspectText("null.json","null").summary,/null value/);
  assert.match(inspectText("bad.json",'{a:1}').summary,/Invalid JSON/);
  inspectText("unsafe.json",'{"__proto__":{"polluted":true}}');
  assert.equal({}.polluted,undefined);
});
test("text preview is bounded and markup remains plain data",()=>{
  const result=inspectText("file.html","<script>globalThis.pwned=true</script>\n"+"x".repeat(2000));
  assert.equal(result.preview.length,1200);
  assert.ok(result.preview.startsWith("<script>"));
  assert.equal(globalThis.pwned,undefined);
  assert.match(result.summary,/not a semantic summary/);
});
test("attachment reader accepts UTF-8 locally and rejects binary or broken encoding",async()=>{
  const file=await readAttachment(new File(["Hello file"],"note.txt",{type:"text/plain"}));
  assert.equal(file.kind,"text");assert.equal(file.preview,"Hello file");
  await assert.rejects(readAttachment(new File([new Uint8Array([255,255])],"broken.txt")),/not valid UTF-8/);
  await assert.rejects(readAttachment(new File(["A\u0000B"],"binary.txt")),/binary data/);
});
test("PDF and native projects expose details only without decompression",async()=>{
  const file=await readAttachment(new File(["not parsed"],"document.pdf",{type:"application/pdf"}));
  assert.equal(file.kind,"metadata");assert.equal(file.preview,undefined);
  assert.match(file.summary,/not parsed/);
});
test("SVG never becomes executable image markup and fake image extensions are rejected",async()=>{
  const svg=await readAttachment(new File(['<svg><script>bad()</script></svg>'],"test.svg",{type:"image/svg+xml"}));
  assert.equal(svg.kind,"text");assert.equal(svg.previewBlob,undefined);
  await assert.rejects(readAttachment(new File(["<svg/>"],"fake.png",{type:"image/png"})),/contents do not match/);
});
test("audio preview is a constrained local blob, not remote HTML",async()=>{
  const file=await readAttachment(new File(["example"],"audio.wav",{type:"text/html"}));
  assert.equal(file.previewBlob.type,"audio/wav");
  assert.match(file.summary,/No transcription/);
});
test("file reply and size formatting communicate privacy and limits",()=>{
  const result=attachmentReply([{name:"test.txt",size:10,summary:"Text preview."}]);
  assert.match(result,/not neural content analysis/);
  assert.match(result,/not uploaded/);
  assert.equal(formatSize(10),"10 B");
  assert.equal(formatSize(1024),"1.0 KB");
  assert.equal(formatSize(1024*1024),"1.0 MB");
});
