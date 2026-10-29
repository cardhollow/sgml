(function(){
	'use strict';

	const ASSETS={
		mammoth:'https://cdn.jsdelivr.net/npm/mammoth@1.13.0/mammoth.browser.min.js',
		pdfjs:'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
		pdfWorker:'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
	};

	const TEXT_EXTENSIONS=new Set(['sgml','txt','md','markdown','text']);
	const HTML_TAGS=new Set([
		'a','article','aside','b','blockquote','br','caption','cite','code','dd','del','div','dl','dt',
		'em','figcaption','figure','h1','h2','h3','h4','h5','h6','hr','i','img','ins','kbd','li',
		'ol','p','pre','s','section','small','span','strong','sub','sup','table','tbody','td','tfoot',
		'th','thead','tr','u','ul'
	]);
	const DROP_CONTENT_TAGS=new Set(['script','style','iframe','object','embed','svg','math','form','input','button','textarea','select','option','link','meta','base']);
	let pdfWorkerBlobURL='';
	const STYLE_PROPERTIES=new Set(['color','background-color','font-weight','font-style','font-size','font-family','text-align','text-decoration','vertical-align','border','border-color','border-style','border-width','border-collapse','padding','padding-left','padding-right','padding-top','padding-bottom','margin','margin-left','margin-right','margin-top','margin-bottom','width','max-width','height']);

	function getExtension(name){
		const match=String(name||'').trim().match(/\.([a-z0-9]+)$/i);
		return match?match[1].toLowerCase():'';
	}

	function getNameFromDisposition(value){
		const header=String(value||'');
		let match=header.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
		if(match){try{return decodeURIComponent(match[1].trim().replace(/^"|"$/g,''));}catch(_){return match[1].trim().replace(/^"|"$/g,'');}}
		match=header.match(/filename\s*=\s*(?:"([^"]+)"|([^;]+))/i);
		if(!match)return'';
		return String(match[1]||match[2]||'').trim().replace(/^"|"$/g,'');
	}

	function bytesFrom(value){
		if(value instanceof ArrayBuffer)return new Uint8Array(value);
		if(ArrayBuffer.isView(value))return new Uint8Array(value.buffer,value.byteOffset,value.byteLength);
		throw new TypeError('The file data was not available as bytes.');
	}

	function bytesToArrayBuffer(bytes){
		return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
	}

	function startsWithPDF(bytes){
		const limit=Math.min(bytes.length,1024);
		const signature=[37,80,68,70,45];
		for(let start=0;start<=limit-signature.length;start++){
			let matches=true;
			for(let i=0;i<signature.length;i++)if(bytes[start+i]!==signature[i]){matches=false;break;}
			if(matches)return true;
		}
		return false;
	}

	function looksLikeDocx(bytes){
		if(bytes.length<4||bytes[0]!==0x50||bytes[1]!==0x4b)return false;
		// Scan the ZIP package, including its central directory at the end. Some
		// large DOCX files place word/document.xml beyond the first megabyte.
		const containsASCII=needle=>{
			for(let start=0;start<=bytes.length-needle.length;start++){
				if(bytes[start]!==needle.charCodeAt(0))continue;
				let match=true;
				for(let offset=1;offset<needle.length;offset++){
					if(bytes[start+offset]!==needle.charCodeAt(offset)){match=false;break;}
				}
				if(match)return true;
			}
			return false;
		};
		return containsASCII('word/document.xml')&&containsASCII('[Content_Types].xml');
	}

	function decodeText(bytes){
		let text;
		try{text=new TextDecoder('utf-8').decode(bytes);}catch(_){text=String.fromCharCode.apply(null,bytes);}
		return text.replace(/^\uFEFF/,'');
	}

	function escapeHTML(value){
		return String(value==null?'':value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
	}

	function safeURL(value,forImage){
		const raw=String(value||'').trim();
		if(!raw||/[\u0000-\u001f]/.test(raw))return'';
		if(forImage&&/^data:image\/(?:png|jpe?g|gif|webp|bmp);base64,/i.test(raw))return raw;
		try{
			const url=new URL(raw,location.href);
			if(['http:','https:'].includes(url.protocol))return raw;
			if(!forImage&&['mailto:','tel:'].includes(url.protocol))return raw;
		}catch(_){
			if(!/^[a-z][a-z0-9+.-]*:/i.test(raw)&&!raw.startsWith('//'))return raw;
		}
		return'';
	}

	function sanitizeStyle(value){
		const safe=[];
		String(value||'').split(';').forEach(part=>{
			const colon=part.indexOf(':');
			if(colon<1)return;
			const property=part.slice(0,colon).trim().toLowerCase();
			const content=part.slice(colon+1).trim();
			if(!STYLE_PROPERTIES.has(property)||!content)return;
			if(/url\s*\(|expression\s*\(|javascript:|@import|\\/i.test(content))return;
			if(!/^[#(),.%\w\s"'\-]+$/.test(content))return;
			safe.push(property+': '+content);
		});
		return safe.join('; ');
	}

	function sanitizeHtmlFragment(html){
		const parsed=new DOMParser().parseFromString('<!doctype html><body>'+String(html||'')+'</body>','text/html');
		const outputDoc=document.implementation.createHTMLDocument('');

		function clean(node){
			if(node.nodeType===Node.TEXT_NODE)return outputDoc.createTextNode(node.nodeValue||'');
			if(node.nodeType!==Node.ELEMENT_NODE)return null;
			const tag=node.tagName.toLowerCase();
			if(DROP_CONTENT_TAGS.has(tag))return null;
			if(!HTML_TAGS.has(tag)){
				const fragment=outputDoc.createDocumentFragment();
				for(const child of Array.from(node.childNodes)){const next=clean(child);if(next)fragment.appendChild(next);}
				return fragment;
			}

			const element=outputDoc.createElement(tag);
			for(const attribute of Array.from(node.attributes||[])){
				const name=attribute.name.toLowerCase();
				const value=attribute.value;
				if(name.startsWith('on')||name==='srcdoc'||name==='srcset')continue;
				if(name==='class'){
					const classes=value.split(/\s+/).filter(token=>/^[a-z0-9_-]{1,80}$/i.test(token));
					if(classes.length)element.setAttribute('class',classes.join(' '));
				}else if(name==='id'){
					if(/^[a-z0-9_:.\-]{1,100}$/i.test(value))element.setAttribute('id',value);
				}else if(name==='title'||name==='alt'||name==='dir'||name==='scope'){
					element.setAttribute(name,value.slice(0,500));
				}else if(name==='colspan'||name==='rowspan'||name==='width'||name==='height'||name==='start'||name==='value'){
					if(/^\d{1,5}$/.test(value))element.setAttribute(name,value);
					else if((name==='width'||name==='height')&&/^\d{1,4}%$/.test(value))element.setAttribute(name,value);
				}else if(name==='align'){
					if(['left','right','center','justify'].includes(value.toLowerCase()))element.setAttribute(name,value.toLowerCase());
				}else if(name==='style'){
					const style=sanitizeStyle(value);if(style)element.setAttribute('style',style);
				}else if(name==='href'&&tag==='a'){
					const url=safeURL(value,false);if(url)element.setAttribute('href',url);
				}else if(name==='src'&&tag==='img'){
					const url=safeURL(value,true);if(url)element.setAttribute('src',url);
				}
			}
			for(const child of Array.from(node.childNodes)){const next=clean(child);if(next)element.appendChild(next);}
			if(tag==='a'&&element.getAttribute('target')==='_blank')element.setAttribute('rel','noopener noreferrer');
			return element;
		}

		const root=outputDoc.createElement('div');
		for(const child of Array.from(parsed.body.childNodes)){const next=clean(child);if(next)root.appendChild(next);}
		return root.innerHTML;
	}

	const HTML_BLOCK_TAGS=new Set([
		'article','aside','blockquote','dd','div','dl','dt','fieldset','figcaption','figure','footer',
		'h1','h2','h3','h4','h5','h6','header','hr','li','main','nav','ol','p','pre','section',
		'table','tbody','td','tfoot','th','thead','tr','ul'
	]);
	const HTML_VOID_TAGS=new Set(['br','hr','img']);

	function escapeSerializedText(value){
		return String(value==null?'':value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
	}

	function escapeSerializedAttribute(value){
		return escapeSerializedText(value).replace(/"/g,'&quot;');
	}

	function serializeAttributes(element){
		return Array.from(element.attributes||[]).map(attribute=>' '+attribute.name+'="'+escapeSerializedAttribute(attribute.value)+'"').join('');
	}

	function serializeCompactNode(node){
		if(node.nodeType===Node.TEXT_NODE)return escapeSerializedText(node.nodeValue||'');
		if(node.nodeType!==Node.ELEMENT_NODE)return '';
		const tag=node.tagName.toLowerCase();
		const open='<'+tag+serializeAttributes(node)+'>';
		if(HTML_VOID_TAGS.has(tag))return open;
		return open+Array.from(node.childNodes||[]).map(serializeCompactNode).join('')+'</'+tag+'>';
	}

	function serializePrettyNode(node,depth=0){
		if(node.nodeType!==Node.ELEMENT_NODE)return serializeCompactNode(node);
		const tag=node.tagName.toLowerCase();
		const open='<'+tag+serializeAttributes(node)+'>';
		if(HTML_VOID_TAGS.has(tag))return open;
		// Preserve the actual content and whitespace inside code examples.
		if(tag==='pre'||tag==='code')return serializeCompactNode(node);
		const children=Array.from(node.childNodes||[]);
		const hasBlockChildren=children.some(child=>child.nodeType===Node.ELEMENT_NODE&&HTML_BLOCK_TAGS.has(child.tagName.toLowerCase()));
		if(!hasBlockChildren)return open+children.map(serializeCompactNode).join('')+'</'+tag+'>';

		const indent='  '.repeat(depth);
		const childIndent='  '.repeat(depth+1);
		const parts=[];
		let previousWasBlock=false;
		for(const child of children){
			if(child.nodeType===Node.TEXT_NODE&&!String(child.nodeValue||'').trim())continue;
			const isBlock=child.nodeType===Node.ELEMENT_NODE&&HTML_BLOCK_TAGS.has(child.tagName.toLowerCase());
			if(isBlock){
				parts.push('\n'+childIndent+serializePrettyNode(child,depth+1));
				previousWasBlock=true;
			}else{
				if(previousWasBlock)parts.push('\n'+childIndent);
				parts.push(serializeCompactNode(child));
				previousWasBlock=false;
			}
		}
		return open+parts.join('')+'\n'+indent+'</'+tag+'>';
	}

	// Keep converted HTML human-editable: each block-level element gets its own
	// line, while inline formatting remains on the same line as its text. This
	// changes source layout only; it does not add line breaks inside paragraphs.
	function formatHTMLForEditing(html){
		const parsed=new DOMParser().parseFromString('<!doctype html><body>'+String(html||'')+'</body>','text/html');
		const nodes=Array.from(parsed.body.childNodes||[]).filter(node=>!(node.nodeType===Node.TEXT_NODE&&!String(node.nodeValue||'').trim()));
		return nodes.map(node=>node.nodeType===Node.ELEMENT_NODE&&HTML_BLOCK_TAGS.has(node.tagName.toLowerCase())
			?serializePrettyNode(node,0):serializeCompactNode(node)).join('\n');
	}

	function isInsideCodeOrPre(source,index){
		const before=source.slice(0,index).toLowerCase();
		for(const tag of ['pre','code']){
			const open=before.lastIndexOf('<'+tag);
			const close=before.lastIndexOf('</'+tag);
			if(open>close)return true;
		}
		return false;
	}

	function findEncodedBlockEnd(source,start){
		let angleDepth=0,roundDepth=0,squareDepth=0,curlyDepth=0;
		for(let i=start;i<source.length;){
			if(source.startsWith('&lt;',i)){
				angleDepth++;
				i+=4;
				continue;
			}
			if(source.startsWith('&gt;',i)){
				// A literal comparison inside a questionnaire field is also HTML-escaped.
				// It must not be mistaken for the outer SGML closing angle bracket.
				if(angleDepth===1&&(roundDepth>0||squareDepth>0||curlyDepth>0)){
					i+=4;
					continue;
				}
				angleDepth--;
				i+=4;
				if(angleDepth===0&&roundDepth===0&&squareDepth===0&&curlyDepth===0)return i;
				continue;
			}
			// DOCX converters wrap each Word paragraph in real HTML tags. Skip
			// those wrappers while searching for the end of a text-encoded SGML block.
			if(source[i]==='<'){
				const tagEnd=source.indexOf('>',i+1);
				if(tagEnd<0)return-1;
				i=tagEnd+1;
				continue;
			}
			if(source[i]==='(')roundDepth++;
			else if(source[i]===')')roundDepth=Math.max(0,roundDepth-1);
			else if(source[i]==='[')squareDepth++;
			else if(source[i]===']')squareDepth=Math.max(0,squareDepth-1);
			else if(source[i]==='{')curlyDepth++;
			else if(source[i]==='}')curlyDepth=Math.max(0,curlyDepth-1);
			i++;
		}
		return-1;
	}

	function restoreEncodedSGMLBlock(value){
		// Remove wrappers emitted by DOCX-to-HTML conversion and turn paragraph
		// boundaries into whitespace; the existing SGML parser handles whitespace.
		const withoutWrappers=String(value||'')
			.replace(/<\/?(?:p|div|li|br|h[1-6]|ul|ol)\b[^>]*>/gi,'\n')
			.replace(/<[^>]+>/g,'');
		const textarea=document.createElement('textarea');
		textarea.innerHTML=withoutWrappers;
		return textarea.value;
	}

	function restoreSGMLMarkupInHTML(html){
		const source=String(html||'');
		const replacements=[];
		const blocked=[];
		const startPattern=/&lt;(Choices|Fillin|Enumeration|connect|flashcard)\b/gi;
		let match;
		while((match=startPattern.exec(source))){
			const start=match.index;
			if(isInsideCodeOrPre(source,start))continue;
			const end=findEncodedBlockEnd(source,start);
			if(end<0)continue;

			// If SGML syntax is spread over Word paragraphs, absorb the paragraph
			// wrapper at each edge so the rendered question is not nested in <p>.
			let replacementStart=start;
			const priorTagStart=source.lastIndexOf('<',start);
			const priorTagEnd=priorTagStart>=0?source.indexOf('>',priorTagStart):-1;
			if(priorTagStart>=0&&priorTagEnd>=0&&priorTagEnd<start&&/^<p\b[^>]*>$/i.test(source.slice(priorTagStart,priorTagEnd+1))&&/^\s*$/.test(source.slice(priorTagEnd+1,start))){
				replacementStart=priorTagStart;
			}
			let replacementEnd=end;
			const trailingParagraph=/^\s*<\/p\s*>/i.exec(source.slice(end));
			if(trailingParagraph)replacementEnd=end+trailingParagraph[0].length;

			replacements.push({start:replacementStart,end:replacementEnd,text:restoreEncodedSGMLBlock(source.slice(replacementStart,replacementEnd))});
			blocked.push({start:replacementStart,end:replacementEnd});
			startPattern.lastIndex=replacementEnd;
		}

		const inlinePattern=/&lt;(\/?)((?:st|spoiler|encircle|info|root|line|ref|bh))\b((?:(?!&lt;).)*?)&gt;/gi;
		while((match=inlinePattern.exec(source))){
			const start=match.index;
			const end=inlinePattern.lastIndex;
			if(isInsideCodeOrPre(source,start))continue;
			if(blocked.some(range=>start>=range.start&&end<=range.end))continue;
			replacements.push({start,end,text:restoreEncodedSGMLBlock(source.slice(start,end))});
		}

		replacements.sort((a,b)=>b.start-a.start);
		let output=source;
		for(const item of replacements)output=output.slice(0,item.start)+item.text+output.slice(item.end);
		return output;
	}

	function buildImportedWrapper(kind,title,fragment){
		const safeTitle=escapeHTML(String(title||'Imported document').replace(/\.[^.]+$/,''));
		return '<div class="sgml-imported-document sgml-imported-'+kind+'" data-sgml-imported-from="'+kind+'">\n<h1>'+safeTitle+'</h1>\n'+fragment+'\n</div>';
	}

	function escapePDFText(value){return escapeHTML(String(value||'').replace(/\u00a0/g,' '));}

	function joinPDFRow(items){
		items.sort((a,b)=>a.x-b.x);
		let result='';
		let previous=null;
		for(const item of items){
			let value=String(item.str||'').replace(/\u00a0/g,' ');
			if(!value)continue;
			if(previous){
				const gap=item.x-previous.endX;
				if(gap>Math.max(1.3,(item.height||10)*0.14)&&!/[\s]$/.test(result)&&!/^\s/.test(value))result+=' ';
			}
			result+=value;
			previous={endX:item.x+item.width,str:value,height:item.height};
		}
		return result.trim();
	}

	function groupPDFRows(items){
		const normalized=[];
		for(const item of items||[]){
			if(!item||typeof item.str!=='string'||!item.str.trim()||!Array.isArray(item.transform))continue;
			normalized.push({
				str:item.str,
				x:Number(item.transform[4])||0,
				y:Number(item.transform[5])||0,
				width:Math.max(0,Number(item.width)||0),
				height:Math.max(1,Number(item.height)||Math.abs(Number(item.transform[3])||10))
			});
		}
		normalized.sort((a,b)=>b.y-a.y||a.x-b.x);
		const rows=[];
		for(const item of normalized){
			let row=rows[rows.length-1];
			const tolerance=Math.max(2,Math.min(4.5,item.height*0.28));
			if(!row||Math.abs(row.y-item.y)>tolerance){row={y:item.y,items:[]};rows.push(row);}
			row.items.push(item);
		}
		return rows.map(row=>joinPDFRow(row.items)).filter(Boolean);
	}

	async function loadScript(url,globalName){
		if(window[globalName])return window[globalName];
		const current=Array.from(document.scripts).find(script=>script.dataset.sgmlConverterSrc===url);
		if(current){
			return new Promise((resolve,reject)=>{
				if(window[globalName])return resolve(window[globalName]);
				current.addEventListener('load',()=>window[globalName]?resolve(window[globalName]):reject(new Error('Conversion library did not initialize.')),{once:true});
				current.addEventListener('error',()=>reject(new Error('Could not load a document-conversion library. Connect to the internet once, then retry.')),{once:true});
			});
		}
		return new Promise((resolve,reject)=>{
			const script=document.createElement('script');
			script.src=url;
			script.async=true;
			script.crossOrigin='anonymous';
			script.dataset.sgmlConverterSrc=url;
			script.onload=()=>window[globalName]?resolve(window[globalName]):reject(new Error('Conversion library loaded but did not initialize.'));
			script.onerror=()=>{script.remove();reject(new Error('Could not load a document-conversion library. Connect to the internet once, then retry.'));};
			document.head.appendChild(script);
		});
	}

	async function convertDocx(bytes,fileName){
		const mammoth=await loadScript(ASSETS.mammoth,'mammoth');
		const data=bytesFrom(bytes);
		const arrayBuffer=data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength);
		const result=await mammoth.convertToHtml({arrayBuffer});
		const clean=sanitizeHtmlFragment(result.value||'');
		const readable=formatHTMLForEditing(clean);
		const restored=restoreSGMLMarkupInHTML(readable);
		return{
			content:buildImportedWrapper('docx',fileName,restored),
			kind:'docx',
			warnings:(result.messages||[]).map(item=>String(item.message||'Document conversion note'))
		};
	}

	async function getPDFWorkerBlobURL(){
		if(pdfWorkerBlobURL)return pdfWorkerBlobURL;
		const response=await fetch(ASSETS.pdfWorker,{mode:'cors',cache:'no-cache'});
		if(!response.ok)throw new Error('The PDF conversion worker is not available. Connect to the internet once and retry.');
		const source=await response.text();
		pdfWorkerBlobURL=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
		return pdfWorkerBlobURL;
	}

	async function convertPDF(bytes,fileName){
		const pdfjs=await loadScript(ASSETS.pdfjs,'pdfjsLib');
		if(pdfjs.GlobalWorkerOptions)pdfjs.GlobalWorkerOptions.workerSrc=await getPDFWorkerBlobURL();
		const data=bytesFrom(bytes);
		const loadingTask=pdfjs.getDocument({data:new Uint8Array(data),isEvalSupported:false,useWorkerFetch:false});
		const pdf=await loadingTask.promise;
		const pages=[];
		let extractedCharacters=0;
		for(let pageNumber=1;pageNumber<=pdf.numPages;pageNumber++){
			const page=await pdf.getPage(pageNumber);
			const textContent=await page.getTextContent();
			const rows=groupPDFRows(textContent.items||[]);
			extractedCharacters+=rows.join('').length;
			const body='<div class="sgml-imported-pdf-text">'+rows.map(escapePDFText).join('\n')+'</div>';
			pages.push('<section class="sgml-imported-pdf-page" data-page-number="'+pageNumber+'"><h2>Page '+pageNumber+'</h2>'+body+'</section>');
		}
		if(typeof pdf.destroy==='function')await pdf.destroy();
		if(!extractedCharacters){
			throw new Error('This PDF has no extractable text. It may be a scanned/image-only PDF; OCR is not included.');
		}
		const readable=formatHTMLForEditing(pages.join('\n'));
		const restored=restoreSGMLMarkupInHTML(readable);
		return{content:buildImportedWrapper('pdf',fileName,restored),kind:'pdf',warnings:[]};
	}

	function looksBinaryText(text){
		if(!text)return false;
		const sample=text.slice(0,10000);
		let unusual=0;
		for(let i=0;i<sample.length;i++)if(sample.charCodeAt(i)===0||sample.charCodeAt(i)===0xfffd||(sample.charCodeAt(i)<9)||(sample.charCodeAt(i)>13&&sample.charCodeAt(i)<32))unusual++;
		return unusual>Math.max(2,sample.length*0.005);
	}

	async function convertBytes(input,fileName='Uploaded file',contentType=''){
		const bytes=bytesFrom(input);
		const name=String(fileName||'Uploaded file');
		const ext=getExtension(name);
		const mime=String(contentType||'').split(';')[0].trim().toLowerCase();
		const isPDF=ext==='pdf'||mime==='application/pdf'||startsWithPDF(bytes);
		const isDocx=ext==='docx'||mime==='application/vnd.openxmlformats-officedocument.wordprocessingml.document'||looksLikeDocx(bytes);

		if(isPDF){
			if(!startsWithPDF(bytes))throw new Error('The selected resource was expected to be a PDF, but its bytes do not contain a valid PDF signature. Check that the URL returns the file itself, not a download or permission page.');
			return Object.assign({fileName:name},await convertPDF(bytes,name));
		}
		if(isDocx){
			if(!looksLikeDocx(bytes))throw new Error('The selected resource was expected to be a DOCX file, but it is not a valid Word DOCX package.');
			return Object.assign({fileName:name},await convertDocx(bytes,name));
		}
		if(ext==='doc')throw new Error('Legacy .doc files are not supported. Save the document as .docx and import it again.');

		if(ext==='html'||ext==='htm'||mime==='text/html'){
			return{fileName:name,kind:'html',content:decodeText(bytes)};
		}
		const text=decodeText(bytes);
		if(looksBinaryText(text)&&!TEXT_EXTENSIONS.has(ext)){
			throw new Error('This file type is not supported. Choose an SGML, TXT, Markdown, DOCX, or text-based PDF file.');
		}
		return{fileName:name,kind:'text',content:text,warnings:[]};
	}

	async function convertFile(file){
		if(!file)throw new Error('No file was selected.');
		const extension=getExtension(file.name);
		if(!['sgml','txt','md','markdown','text','docx','pdf'].includes(extension)){
			throw new Error('Unsupported file type. Choose .sgml, .txt, .md, .docx, or .pdf.');
		}
		const buffer=await file.arrayBuffer();
		return convertBytes(buffer,file.name||'Uploaded file',file.type||'');
	}

	async function convertResponse(response,fallbackFileName='Imported file'){
		if(!response||!response.ok)throw new Error('Could not fetch the file'+(response?' (HTTP '+response.status+').':'.'));
		const responseName=getNameFromDisposition(response.headers&&response.headers.get('content-disposition'));
		let urlName='';
		try{const url=new URL(response.url||location.href,location.href);urlName=decodeURIComponent(url.pathname.split('/').pop()||'');if(/^(?:uc|download|view|export)$/i.test(urlName))urlName='';}catch(_){}
		let name=responseName||urlName||fallbackFileName;
		const mime=response.headers&&response.headers.get('content-type')||'';
		const bytes=await response.arrayBuffer();
		const result=await convertBytes(bytes,name,mime);
		if(!getExtension(name)){
			if(result.kind==='pdf')name+='.pdf';
			else if(result.kind==='docx')name+='.docx';
		}
		result.fileName=name;
		return result;
	}

	function warmCache(){
		if(!navigator.onLine||!navigator.serviceWorker)return;
		try{
			navigator.serviceWorker.ready.then(registration=>{
				const worker=registration.active||navigator.serviceWorker.controller;
				if(worker)worker.postMessage({type:'CACHE_CONVERTER_LIBRARIES'});
			}).catch(()=>{});
		}catch(_){}
	}

	window.SGMLFileConverter={
		assets:ASSETS,
		convertBytes,
		convertFile,
		convertResponse,
		warmCache,
		looksLikeDocx,
		startsWithPDF
	};
})();
