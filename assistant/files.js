// Local, deterministic inspection only. Never executes documents or sends file data.
export const MAX_FILES = 3;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_TEXT_BYTES = 1024 * 1024;
const TEXT_EXT = new Set(["txt","md","markdown","csv","tsv","json","svg","srt","vtt","log","xml","html","css","js","py","yaml","yml"]);
export function fileKind(name) {
  const ext=name.toLowerCase().split(".").pop();
  if(TEXT_EXT.has(ext))return "text";
  if(["png","jpg","jpeg","webp","gif"].includes(ext))return "image";
  if(["wav","mp3","ogg","m4a","flac"].includes(ext))return "audio";
  return "metadata";
}
export function validateFile(file) {
  if(!file.name||file.size===0)throw new Error("The file is empty or has no filename.");
  if(file.size>MAX_FILE_BYTES)throw new Error("Each file must be 10 MB or smaller.");
  if(fileKind(file.name)==="text"&&file.size>MAX_TEXT_BYTES)throw new Error("Readable text files must be 1 MB or smaller.");
}
export function parseTable(text,delimiter=",") {
  const rows=[];let row=[],field="",quoted=false,afterQuote=false;
  text=text.replace(/^\uFEFF/,"");
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(afterQuote&&c!==delimiter&&c!=="\n"&&c!=="\r")throw new Error("Characters after a closing quote.");
    if(c==='"'){
      if(quoted&&text[i+1]==='"'){field+='"';i++;}
      else if(quoted||field===""){afterQuote=quoted;quoted=!quoted;}
      else throw new Error("Unexpected quote in an unquoted field.");
    }else if(c===delimiter&&!quoted){row.push(field);field="";afterQuote=false;}
    else if((c==="\n"||c==="\r")&&!quoted){
      if(c==="\r"&&text[i+1]==="\n")i++;
      row.push(field);rows.push(row);row=[];field="";afterQuote=false;
      if(rows.length>10000)throw new Error("Preview is limited to 10,000 rows.");
    }else field+=c;
  }
  if(quoted)throw new Error("Unclosed quoted field.");
  if(field!==""||row.length){row.push(field);rows.push(row);}
  if(rows.length>10000)throw new Error("Preview is limited to 10,000 rows.");
  return rows;
}
export function inspectText(name,text) {
  const ext=name.toLowerCase().split(".").pop();
  const base={characters:text.length,lines:text?text.split(/\r\n|\r|\n/).length:0,words:(text.match(/\S+/g)||[]).length};
  const preview=text.replace(/\u0000/g,"").slice(0,1200);
  if(ext==="csv"||ext==="tsv"){
    try{
      const rows=parseTable(text,ext==="tsv"?"\t":",");
      const columns=rows[0]?.length||0;
      const inconsistent=rows.slice(1).filter(r=>r.length!==columns).length;
      return {...base,preview,summary:`Table: ${Math.max(0,rows.length-1)} data rows, ${columns} columns. Headers: ${(rows[0]||[]).slice(0,12).map(s=>s.slice(0,60)).join(", ")}.${inconsistent?` ${inconsistent} rows have a different field count.`:" Field counts are consistent."} Formulas are not executed.`};
    }catch(error){return {...base,preview,summary:`Table check failed: ${error.message}`};}
  }
  if(ext==="json"){
    try{
      const value=JSON.parse(text);
      const description=Array.isArray(value)?`Array with ${value.length} items`:
        value&&typeof value==="object"?`Object with ${Object.keys(value).length} keys; first keys: ${Object.keys(value).slice(0,10).join(", ").slice(0,300)}`:
        `Top-level ${value===null?"null":typeof value} value`;
      return {...base,preview,summary:`Valid JSON. ${description}.`};
    }catch{return {...base,preview,summary:"Invalid JSON. Check quotes, commas and matching braces."};}
  }
  return {...base,preview,summary:`Text: ${base.words} words, ${base.lines} lines, ${base.characters} characters. Preview is limited to the first 1,200 characters. This is not a semantic summary.`};
}
export async function readAttachment(file) {
  validateFile(file);
  const kind=fileKind(file.name);
  const result={name:file.name,size:file.size,kind,file};
  if(kind==="text"){
    const bytes=await file.arrayBuffer();
    let text;
    try{text=new TextDecoder("utf-8",{fatal:true}).decode(bytes);}
    catch{throw new Error("This text file is not valid UTF-8. Convert it to UTF-8 before attaching.");}
    if(text.includes("\u0000"))throw new Error("This appears to be binary data, not readable UTF-8 text.");
    Object.assign(result,inspectText(file.name,text));
  }else if(kind==="image"){
    // Blob type is constrained; SVG/HTML never become image previews.
    const types={png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",webp:"image/webp",gif:"image/gif"};
    const type=types[file.name.toLowerCase().split(".").pop()];
    const header=new Uint8Array(await file.slice(0,16).arrayBuffer());
    const ascii=new TextDecoder("ascii").decode(header);
    const valid=type==="image/png"?[137,80,78,71,13,10,26,10].every((v,i)=>header[i]===v):
      type==="image/jpeg"?header[0]===255&&header[1]===216&&header[2]===255:
      type==="image/webp"?ascii.startsWith("RIFF")&&ascii.slice(8,12)==="WEBP":
      ascii.startsWith("GIF87a")||ascii.startsWith("GIF89a");
    if(!valid)throw new Error("The file contents do not match its image extension.");
    const blob=new Blob([file],{type});
    let bitmap;
    try{bitmap=await createImageBitmap(blob);}
    catch{throw new Error("This image could not be decoded. Try PNG, JPEG, WebP or GIF.");}
    const {width,height}=bitmap;bitmap.close();
    if(width*height>25000000)throw new Error("Image previews are limited to 25 megapixels. Resize it first.");
    result.previewBlob=blob;
    result.summary=`Image: ${width} × ${height} pixels. Preview only; this model cannot recognise image contents.`;
  }else if(kind==="audio"){
    const types={wav:"audio/wav",mp3:"audio/mpeg",ogg:"audio/ogg",m4a:"audio/mp4",flac:"audio/flac"};
    result.previewBlob=new Blob([file],{type:types[file.name.toLowerCase().split(".").pop()]});
    result.summary="Local audio attachment. Playback depends on browser codec support. No transcription or audio-content analysis.";
  }else{
    result.summary="File details only. PDF, Office documents, video and native project formats are not parsed. Use the editor’s own open/import control when available.";
  }
  return result;
}
export function attachmentReply(files) {
  return files.map(file=>`${file.name} (${formatSize(file.size)})\n${file.summary}`).join("\n\n")+
    "\n\nThese are deterministic local file checks, not neural content analysis. Files are not uploaded, used for training or automatically imported into the editor.";
}
export function formatSize(bytes) {
  return bytes<1024?`${bytes} B`:bytes<1024*1024?`${(bytes/1024).toFixed(1)} KB`:`${(bytes/(1024*1024)).toFixed(1)} MB`;
}
