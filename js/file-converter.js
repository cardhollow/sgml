(function(){
	'use strict';

	const ASSETS={
		mammoth:'https://cdn.jsdelivr.net/npm/mammoth@1.13.0/mammoth.browser.min.js',
		jszip:'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
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
	const SVG_NS='http://www.w3.org/2000/svg';
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
		return value;
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

	const SVG_BLOCKED_ELEMENTS=new Set(['script','iframe','object','embed','applet','frame','frameset','portal']);

	function hasDangerousEmbeddedCode(value){
		return /(?:javascript|vbscript)\s*:|data\s*:\s*text\/html|expression\s*\(|-moz-binding|behavior\s*:/i.test(String(value||''));
	}

	function sanitizeSVGSubtree(node,outputDoc){
		if(node.nodeType===Node.TEXT_NODE)return outputDoc.createTextNode(node.nodeValue||'');
		if(node.nodeType===Node.CDATA_SECTION_NODE)return outputDoc.createTextNode(node.nodeValue||'');
		if(node.nodeType===Node.COMMENT_NODE)return outputDoc.createComment(node.nodeValue||'');
		if(node.nodeType!==Node.ELEMENT_NODE)return null;

		const tag=String(node.localName||node.nodeName||'').toLowerCase();
		if(SVG_BLOCKED_ELEMENTS.has(tag))return null;
		if(tag==='style'&&hasDangerousEmbeddedCode(node.textContent||''))return null;

		// Import the original SVG element with its original namespace, qualified
		// name, attributes, and casing. No SVG shape or attribute whitelist is used.
		const clone=outputDoc.importNode(node,false);
		for(const attribute of Array.from(clone.attributes||[])){
			const name=String(attribute.name||attribute.localName||'').toLowerCase();
			const value=attribute.value||'';
			if(name.startsWith('on')||name==='srcdoc'||name==='srcset'||hasDangerousEmbeddedCode(value)){
				if(attribute.namespaceURI)clone.removeAttributeNS(attribute.namespaceURI,attribute.localName);
				else clone.removeAttribute(attribute.name);
			}
		}
		for(const child of Array.from(node.childNodes||[])){
			const safeChild=sanitizeSVGSubtree(child,outputDoc);
			if(safeChild)clone.appendChild(safeChild);
		}
		return clone;
	}

	function sanitizeHtmlFragment(html){
		const parsed=new DOMParser().parseFromString('<!doctype html><body>'+String(html||'')+'</body>','text/html');
		const outputDoc=document.implementation.createHTMLDocument('');

		function clean(node){
			if(node.nodeType===Node.TEXT_NODE)return outputDoc.createTextNode(node.nodeValue||'');
			if(node.nodeType!==Node.ELEMENT_NODE)return null;
			const tag=node.tagName.toLowerCase();
			if(node.namespaceURI===SVG_NS||tag==='svg')return sanitizeSVGSubtree(node,outputDoc);
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
		'table','tbody','td','tfoot','th','thead','tr','ul','docx-line'
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
		// Keep SVG's case-sensitive element names exactly as imported. Lowercasing
		// names such as linearGradient or foreignObject can change SVG semantics.
		const isSVG=node.namespaceURI===SVG_NS;
		const tag=isSVG?node.localName:node.tagName.toLowerCase();
		const open='<'+tag+serializeAttributes(node)+'>';
		if(!isSVG&&HTML_VOID_TAGS.has(tag))return open;
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
			// Whitespace-only text nodes can be intentional DOCX content (tabs,
			// indentation, or blank spacing). Serialize them instead of dropping them.
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
		// Keep whitespace-only top-level text nodes too; they may originate from DOCX.
		const nodes=Array.from(parsed.body.childNodes||[]);
		return nodes.map(node=>node.nodeType===Node.ELEMENT_NODE&&HTML_BLOCK_TAGS.has(node.tagName.toLowerCase())
			?serializePrettyNode(node,0):serializeCompactNode(node)).join('\n');
	}

	// DOCX paragraphs are Word layout containers, not SGML source syntax. Use
	// a temporary grouping element so a paragraph's inline runs remain together,
	// then remove that element after formatting. Only explicitly formatted Word
	// paragraphs retain a non-paragraph block so alignment, shading, or other
	// paragraph-level styling remains visible in the rendered document.
	function flattenDocxParagraphs(html){
		const parsed=new DOMParser().parseFromString('<!doctype html><body>'+String(html||'')+'</body>','text/html');
		// Mammoth uses <br> for explicit Word line breaks. Keep those as actual
		// source newlines instead of leaving them as HTML tags in the SGML text.
		Array.from(parsed.body.querySelectorAll('br')).forEach(lineBreak=>{
			if(lineBreak.closest('pre,code,svg')||!lineBreak.parentNode)return;
			lineBreak.parentNode.replaceChild(parsed.createTextNode('\n'),lineBreak);
		});
		const paragraphs=Array.from(parsed.body.querySelectorAll('p'));
		paragraphs.forEach(paragraph=>{
			const parent=paragraph.parentNode;
			if(!parent)return;
			const classes=String(paragraph.getAttribute('class')||'').trim();
			const keepBlock=!!(classes||paragraph.hasAttribute('style')||paragraph.hasAttribute('align')||paragraph.hasAttribute('dir')||paragraph.hasAttribute('id'));
			const replacement=parsed.createElement(keepBlock?'div':'docx-line');
			if(classes)replacement.setAttribute('class',classes);
			for(const name of ['id','dir','align','style','title']){
				if(paragraph.hasAttribute(name))replacement.setAttribute(name,paragraph.getAttribute(name));
			}
			while(paragraph.firstChild)replacement.appendChild(paragraph.firstChild);
			parent.replaceChild(replacement,paragraph);
		});
		return formatHTMLForEditing(parsed.body.innerHTML).replace(/<docx-line>([\s\S]*?)<\/docx-line>/gi,'$1');
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

	function expandStandaloneParagraphRange(source,start,end){
		// Mammoth wraps every Word paragraph in <p> and often adds <span> around
		// each run. If the only content in that paragraph is one SGML/HTML token,
		// remove the generated paragraph wrapper so block components such as
		// <root>, <bh>, <line>, and future custom syntax reach the SGML parser at
		// the document level instead of being trapped inside a Word paragraph.
		const before=source.slice(0,start);
		const paragraphOpens=Array.from(before.matchAll(/<p\b[^>]*>/gi));
		if(!paragraphOpens.length)return{start,end};
		const paragraphOpen=paragraphOpens[paragraphOpens.length-1];
		const lastClose=before.toLowerCase().lastIndexOf('</p');
		if(lastClose>paragraphOpen.index)return{start,end};
		const openEnd=paragraphOpen.index+paragraphOpen[0].length;
		const beforeToken=source.slice(openEnd,start).replace(/<[^>]*>/g,'').replace(/&nbsp;/gi,' ').trim();
		if(beforeToken)return{start,end};
		const closeStart=source.toLowerCase().indexOf('</p',end);
		if(closeStart<0)return{start,end};
		const closeEnd=source.indexOf('>',closeStart);
		if(closeEnd<0)return{start,end};
		const afterToken=source.slice(end,closeStart).replace(/<[^>]*>/g,'').replace(/&nbsp;/gi,' ').trim();
		if(afterToken)return{start,end};
		return{start:paragraphOpen.index,end:closeEnd+1};
	}

	function dangerousImportedTagName(source,start,end){
		const token=String(source||'').slice(start,end);
		const match=token.match(/^&lt;\s*\/?\s*([a-z][a-z0-9_.:-]*)/i);
		if(!match)return'';
		const name=match[1].toLowerCase();
		return ['script','iframe','object','embed','applet','frame','frameset','portal'].includes(name)?name:'';
	}

	function sanitizeRestoredTagText(value){
		// Keep the source language open-ended, but do not turn executable HTML
		// attributes or script URLs from an imported DOCX into active content.
		return String(value||'')
			.replace(/\s+on[a-z0-9_:-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,'')
			.replace(/\s+(?:href|src|xlink:href|formaction|action)\s*=\s*(["'])\s*(?:javascript|vbscript):[\s\S]*?\1/gi,'')
			.replace(/\s+(?:href|src|xlink:href|formaction|action)\s*=\s*(?:javascript|vbscript):[^\s>]+/gi,'');
	}

	function isInsideMarkdownFence(source,index){
		// DOCX often stores each source-code line as its own Word paragraph.
		// Reconstruct logical lines from those paragraph boundaries and track
		// Markdown fences without knowing or listing any SGML component names.
		const prefix=String(source||'').slice(0,index)
			.replace(/<br\b[^>]*>/gi,'\n')
			.replace(/<\/(?:p|div|li|h[1-6]|pre|section|tr)\s*>/gi,'\n')
			.replace(/<[^>]*>/g,'');
		let fence=null;
		for(const line of prefix.split(/\r?\n/)){
			if(fence){
				const close=new RegExp('^\\s{0,3}'+fence.char+'{'+fence.length+',}\\s*$');
				if(close.test(line))fence=null;
				continue;
			}
			const opening=/^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
			if(opening)fence={char:opening[1][0],length:opening[1].length};
		}
		return!!fence;
	}

	function restoreSGMLMarkupInHTML(html){
		const source=String(html||'');
		const replacements=[];
		// Do not enumerate SGML component names here. Every SGML version may add
		// new tags or question syntaxes; the converter's job is only to undo the
		// HTML entity-escaping Mammoth applies to tag-shaped DOCX text. The SGML
		// renderer remains the single authority for which syntax it understands.
		const startPattern=/&lt;\s*\/?\s*[a-z][a-z0-9_.:-]*(?=:|\s|\/|&gt;)/gi;
		let match;
		while((match=startPattern.exec(source))){
			const start=match.index;
			if(isInsideCodeOrPre(source,start)||isInsideMarkdownFence(source,start))continue;
			const end=findEncodedBlockEnd(source,start);
			if(end<0)continue;
			// Block active embedded-content elements. Skip their matching closing
			// token too, so their contents cannot be partially decoded as markup.
			const dangerousName=dangerousImportedTagName(source,start,end);
			if(dangerousName){
				const isClosing=/^&lt;\s*\//i.test(source.slice(start,end));
				let skipTo=end;
				if(!isClosing){
					const closing=new RegExp('&lt;\\s*\\/\\s*'+dangerousName+'\\s*&gt;','ig');
					closing.lastIndex=end;
					const closeMatch=closing.exec(source);
					if(closeMatch)skipTo=closing.lastIndex;
				}
				startPattern.lastIndex=skipTo;
				continue;
			}
			const expanded=expandStandaloneParagraphRange(source,start,end);
			const raw=restoreEncodedSGMLBlock(source.slice(expanded.start,expanded.end));
			replacements.push({start:expanded.start,end:expanded.end,text:sanitizeRestoredTagText(raw)});
			startPattern.lastIndex=expanded.end;
		}

		replacements.sort((a,b)=>b.start-a.start);
		let output=source;
		for(const item of replacements)output=output.slice(0,item.start)+item.text+output.slice(item.end);
		return output;
	}

	function buildImportedWrapper(kind,title,fragment,options={}){
		const safeTitle=escapeHTML(String(title||'Imported document').replace(/\.[^.]+$/,''));
		const baseClass=options.baseClass&&/^[a-z0-9_-]+$/i.test(options.baseClass)?' '+options.baseClass:'';
		const styleBlock=options.css?'<style data-sgml-docx-styles>\n'+options.css+'\n</style>\n':'';
		return '<div class="sgml-imported-document sgml-imported-'+kind+baseClass+'" data-sgml-imported-from="'+kind+'">\n'+styleBlock+fragment+'\n</div>';
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

	const WORD_NS='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
	const WORD_HIGHLIGHTS={
		yellow:'#ffff00',green:'#00ff00',cyan:'#00ffff',magenta:'#ff00ff',blue:'#0000ff',red:'#ff0000',
		darkblue:'#000080',darkcyan:'#008080',darkgreen:'#008000',darkmagenta:'#800080',darkred:'#800000',
		darkyellow:'#808000',darkgray:'#808080',lightgray:'#c0c0c0',black:'#000000',white:'#ffffff'
	};

	function wordChild(parent,localName){
		if(!parent)return null;
		for(const child of Array.from(parent.childNodes||[])){
			if(child.nodeType===Node.ELEMENT_NODE&&child.namespaceURI===WORD_NS&&child.localName===localName)return child;
		}
		return null;
	}

	function wordDescendants(parent,localName){
		return Array.from(parent&&parent.getElementsByTagNameNS?parent.getElementsByTagNameNS(WORD_NS,localName):[]);
	}

	function wordAttr(element,name='val'){
		if(!element)return '';
		return element.getAttributeNS(WORD_NS,name)||element.getAttribute('w:'+name)||'';
	}

	// Mammoth omits some visually blank Word paragraphs. Add a temporary text
	// marker to those paragraphs before conversion, then remove the marker while
	// retaining the empty HTML block so every intentional blank line survives.
	function markEmptyDocxParagraphs(documentXML){
		const documentDoc=new DOMParser().parseFromString(String(documentXML||''),'application/xml');
		if(documentDoc.getElementsByTagName('parsererror').length)return{xml:documentXML,markers:[]};
		const body=wordDescendants(documentDoc,'body')[0];
		if(!body)return{xml:documentXML,markers:[]};
		let markerPrefix='SGMLDOCX_EMPTY_PARAGRAPH_';
		while(String(documentXML||'').includes(markerPrefix))markerPrefix+='_X';
		const markers=[];
		for(const paragraph of wordDescendants(body,'p')){
			const hasText=wordDescendants(paragraph,'t').some(node=>(node.textContent||'').length>0)||
				wordDescendants(paragraph,'delText').some(node=>(node.textContent||'').length>0)||
				wordDescendants(paragraph,'instrText').some(node=>(node.textContent||'').length>0);
			const hasNonTextContent=['tab','br','cr','drawing','pict','object','sym','footnoteReference','endnoteReference','altChunk'].some(name=>wordDescendants(paragraph,name).length>0);
			if(hasText||hasNonTextContent)continue;
			const marker=markerPrefix+String(markers.length).padStart(6,'0')+'_END';
			const run=documentDoc.createElementNS(WORD_NS,'w:r');
			const text=documentDoc.createElementNS(WORD_NS,'w:t');
			text.setAttributeNS('http://www.w3.org/XML/1998/namespace','xml:space','preserve');
			text.textContent=marker;
			run.appendChild(text);
			paragraph.appendChild(run);
			markers.push(marker);
		}
		return{xml:new XMLSerializer().serializeToString(documentDoc),markers};
	}

	function restoreDocxEmptyParagraphMarkers(html,markers){
		if(!markers||!markers.length)return String(html||'');
		const markerSet=new Set(markers);
		const parsed=new DOMParser().parseFromString('<!doctype html><body>'+String(html||'')+'</body>','text/html');
		const candidates=Array.from(parsed.body.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,td,th'));
		for(const element of candidates){
			if(!markerSet.has(String(element.textContent||'').trim()))continue;
			const tag=element.tagName.toLowerCase();
			if(/^h[1-6]$/.test(tag)){
				const paragraph=parsed.createElement('p');
				for(const attribute of Array.from(element.attributes||[]))paragraph.setAttribute(attribute.name,attribute.value);
				element.parentNode.replaceChild(paragraph,element);
			}else{
				while(element.firstChild)element.removeChild(element.firstChild);
			}
		}
		return parsed.body.innerHTML;
	}

	function wordRGB(value){
		const color=String(value||'').trim();
		return /^[0-9a-f]{6}$/i.test(color)?'#'+color:'';
	}

	function wordRunColorStyle(rPr){
		const css={};
		if(!rPr)return css;
		const color=wordRGB(wordAttr(wordChild(rPr,'color')));
		if(color)css.color=color;
		const size=Number(wordAttr(wordChild(rPr,'sz'))||wordAttr(wordChild(rPr,'szCs')));
		if(Number.isFinite(size)&&size>0&&size<=3276)css['font-size']=(size/2)+'pt';
		const highlight=wordAttr(wordChild(rPr,'highlight')).toLowerCase();
		if(highlight&&WORD_HIGHLIGHTS[highlight])css['background-color']=WORD_HIGHLIGHTS[highlight];
		const shading=wordChild(rPr,'shd');
		const fill=wordRGB(wordAttr(shading,'fill'));
		if(fill)css['background-color']=fill;
		const strike=wordChild(rPr,'strike');
		const doubleStrike=wordChild(rPr,'dstrike');
		if(strike||doubleStrike){
			const enabled=element=>element&&!['0','false','off','none','no'].includes(wordAttr(element).toLowerCase());
			css['text-decoration']=enabled(strike)||enabled(doubleStrike)?'line-through':'none';
		}
		return css;
	}

	function wordParagraphStyle(pPr){
		const css={};
		if(!pPr)return css;
		const alignment=wordAttr(wordChild(pPr,'jc')).toLowerCase();
		if(alignment==='both'||alignment==='distribute'||alignment==='thaidistribute')css['text-align']='justify';
		else if(['left','center','right'].includes(alignment))css['text-align']=alignment;
		else if(alignment==='start'||alignment==='end'){
			const bidi=wordChild(pPr,'bidi');
			const rtl=bidi&&!['0','false','off','none','no'].includes(wordAttr(bidi).toLowerCase());
			css['text-align']=alignment==='start'?(rtl?'right':'left'):(rtl?'left':'right');
		}
		const shading=wordChild(pPr,'shd');
		const fill=wordRGB(wordAttr(shading,'fill'));
		if(fill)css['background-color']=fill;
		return css;
	}

	function mergeWordCSS(...objects){
		const result={};
		objects.forEach(item=>Object.assign(result,item||{}));
		return result;
	}

	function collectWordText(element){
		let value='';
		function walk(node){
			for(const child of Array.from(node.childNodes||[])){
				if(child.nodeType!==Node.ELEMENT_NODE||child.namespaceURI!==WORD_NS)continue;
				if(child.localName==='t')value+=child.textContent||'';
				else if(child.localName==='tab'||child.localName==='br'||child.localName==='cr')value+=' ';
				else walk(child);
			}
		}
		walk(element);
		return value;
	}

	function wordStyleChain(styleMap,id){
		const chain=[];
		const seen=new Set();
		let current=id;
		while(current&&!seen.has(current)&&styleMap.has(current)){
			seen.add(current);
			const style=styleMap.get(current);
			chain.unshift(style);
			current=style.basedOn;
		}
		return chain;
	}

	async function extractDocxColorFormatting(bytes,JSZip){
		try{
			const zip=await JSZip.loadAsync(bytesToArrayBuffer(bytesFrom(bytes)));
			const documentFile=zip.file('word/document.xml');
			if(!documentFile)return[];
			const documentXML=await documentFile.async('string');
			const documentDoc=new DOMParser().parseFromString(documentXML,'application/xml');
			if(documentDoc.getElementsByTagName('parsererror').length)return[];

			const styleMap=new Map();
			const stylesFile=zip.file('word/styles.xml');
			let stylesDoc=null;
			if(stylesFile){
				const stylesXML=await stylesFile.async('string');
				stylesDoc=new DOMParser().parseFromString(stylesXML,'application/xml');
				for(const style of wordDescendants(stylesDoc,'style')){
					const id=style.getAttributeNS(WORD_NS,'styleId')||style.getAttribute('w:styleId');
					if(!id)continue;
					styleMap.set(id,{
						basedOn:wordAttr(wordChild(style,'basedOn')),
						pPr:wordChild(style,'pPr'),
						rPr:wordChild(style,'rPr')
					});
				}
			}

			const defaults=stylesDoc?wordDescendants(stylesDoc,'docDefaults')[0]:null;
			const defaultPPr=wordChild(wordChild(defaults,'pPrDefault'),'pPr');
			const defaultRPr=wordChild(wordChild(defaults,'rPrDefault'),'rPr');
			const baseParagraphCSS=wordParagraphStyle(defaultPPr);
			const baseRunCSS=wordRunColorStyle(defaultRPr);
			const body=wordDescendants(documentDoc,'body')[0];
			if(!body)return[];

			return wordDescendants(body,'p').map(paragraph=>{
				const pPr=wordChild(paragraph,'pPr');
				const paragraphStyleId=wordAttr(wordChild(pPr,'pStyle'));
				const styleChain=wordStyleChain(styleMap,paragraphStyleId);
				let paragraphCSS=mergeWordCSS(baseParagraphCSS);
				let inheritedRunCSS=mergeWordCSS(baseRunCSS);
				styleChain.forEach(style=>{
					paragraphCSS=mergeWordCSS(paragraphCSS,wordParagraphStyle(style.pPr));
					inheritedRunCSS=mergeWordCSS(inheritedRunCSS,wordRunColorStyle(style.rPr),wordRunColorStyle(wordChild(style.pPr,'rPr')));
				});
				paragraphCSS=mergeWordCSS(paragraphCSS,wordParagraphStyle(pPr));
				inheritedRunCSS=mergeWordCSS(inheritedRunCSS,wordRunColorStyle(wordChild(pPr,'rPr')));

				const runs=wordDescendants(paragraph,'r').filter(run=>{
					let ancestor=run.parentNode;
					while(ancestor&&ancestor!==paragraph&&!(ancestor.namespaceURI===WORD_NS&&ancestor.localName==='p'))ancestor=ancestor.parentNode;
					return ancestor===paragraph;
				}).map(run=>{
					const rPr=wordChild(run,'rPr');
					const runStyleId=wordAttr(wordChild(rPr,'rStyle'));
					let runStyleCSS={};
					wordStyleChain(styleMap,runStyleId).forEach(style=>{runStyleCSS=mergeWordCSS(runStyleCSS,wordRunColorStyle(style.rPr));});
					return{text:collectWordText(run),css:mergeWordCSS(inheritedRunCSS,runStyleCSS,wordRunColorStyle(rPr))};
				}).filter(run=>run.text);
				return{text:collectWordText(paragraph),css:paragraphCSS,runs};
			});
		}catch(error){
			console.warn('DOCX formatting could not be restored; keeping the normal DOCX conversion.',error);
			return[];
		}
	}

	function normalizeWordMatchText(value){
		return String(value||'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
	}

	function escapeRegExp(value){
		return String(value||'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
	}

	function findWordRunMatch(fullText,runText,fromIndex){
		if(!runText)return null;
		let index=fullText.indexOf(runText,fromIndex);
		if(index>=0)return{index,length:runText.length};
		const pattern=runText.trim().split(/(\s+)/).filter(Boolean).map(part=>/^\s+$/.test(part)?'[\\s\\u00a0]+':escapeRegExp(part)).join('');
		if(!pattern)return null;
		const match=new RegExp(pattern).exec(fullText.slice(fromIndex));
		return match?{index:fromIndex+match.index,length:match[0].length}:null;
	}

	function wordTextRange(element,start,length){
		const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);
		let node,position=0,startNode=null,startOffset=0,endNode=null,endOffset=0;
		while((node=walker.nextNode())){
			const next=position+(node.nodeValue||'').length;
			if(!startNode&&start>=position&&start<=next){startNode=node;startOffset=start-position;}
			if(startNode&&start+length>=position&&start+length<=next){endNode=node;endOffset=start+length-position;break;}
			position=next;
		}
		if(!startNode||!endNode)return null;
		const range=document.createRange();
		range.setStart(startNode,startOffset);
		range.setEnd(endNode,endOffset);
		return range;
	}

	const DOCX_INHERITABLE_PROPERTIES=new Set(['color','font-size','font-family','font-weight','font-style','text-decoration','vertical-align']);
	const DOCX_CSS_PROPERTIES=new Set(['color','background-color','font-size','text-align','text-decoration']);

	function safeDocxCSS(css){
		const result={};
		Object.keys(css||{}).sort().forEach(property=>{
			const value=String(css[property]||'').trim();
			if(!DOCX_CSS_PROPERTIES.has(property)||!value)return;
			if(property==='color'||property==='background-color'){
				if(/^#[0-9a-f]{6}$/i.test(value))result[property]=value;
			}else if(property==='font-size'){
				if(/^\d+(?:\.\d+)?pt$/.test(value))result[property]=value;
			}else if(property==='text-align'){
				if(['left','right','center','justify'].includes(value))result[property]=value;
			}else if(property==='text-decoration'){
				if(['line-through','none'].includes(value))result[property]=value;
			}
		});
		return result;
	}

	function cssSignature(css){
		return Object.keys(css).sort().map(property=>property+':'+css[property]).join(';');
	}

	function createDocxStyleManager(){
		const classes=new Map();
		const rules=[];
		return{
			classFor(css){
				const safe=safeDocxCSS(css);
				const signature=cssSignature(safe);
				if(!signature)return'';
				if(classes.has(signature))return classes.get(signature);
				const className='docx-style-'+(classes.size+1);
				classes.set(signature,className);
				const declarations=Object.entries(safe).map(([property,value])=>property+':'+value).join(';');
				rules.push('.sgml-imported-docx .'+className+'{'+declarations+'}');
				if(safe['text-align']){
					const align=safe['text-align'];
					const margins=align==='center'?'margin-left:auto;margin-right:auto':align==='right'?'margin-left:auto;margin-right:0':'margin-left:0;margin-right:auto';
					rules.push('.sgml-imported-docx svg.'+className+'{display:block;'+margins+'}');
				}
				return className;
			},
			addBase(css){
				const safe=safeDocxCSS(css);
				if(!Object.keys(safe).length)return'';
				const className='docx-base-style';
				const declarations=Object.entries(safe).map(([property,value])=>property+':'+value).join(';');
				rules.unshift('.sgml-imported-docx.'+className+'{'+declarations+'}');
				if(safe['text-align']){
					const align=safe['text-align'];
					const margins=align==='center'?'margin-left:auto;margin-right:auto':align==='right'?'margin-left:auto;margin-right:0':'margin-left:0;margin-right:auto';
					rules.push('.sgml-imported-docx.'+className+' svg{display:block;'+margins+'}');
				}
				return className;
			},
			cssText(){return rules.join('\n');}
		};
	}

	function commonCSS(items,properties){
		if(!items.length)return{};
		const first=items[0]||{};
		const common={};
		Object.keys(first).forEach(property=>{
			if(!properties.has(property))return;
			const value=first[property];
			if(items.every(item=>item&&item[property]===value))common[property]=value;
		});
		return common;
	}

	function dominantCSSValue(items,property,minimumRatio=0.8){
		if(!items.length)return'';
		const counts=new Map();
		for(const item of items){
			const value=String(item&&item[property]||'');
			counts.set(value,(counts.get(value)||0)+1);
		}
		let bestValue='';
		let bestCount=0;
		for(const [value,count] of counts){
			if(value&&count>bestCount){bestValue=value;bestCount=count;}
		}
		return bestCount/items.length>=minimumRatio?bestValue:'';
	}

	function withoutCommonCSS(css,common){
		const remaining={};
		Object.entries(css||{}).forEach(([property,value])=>{
			if(common[property]!==value)remaining[property]=value;
		});
		return remaining;
	}

	function applyWordRunClasses(element,runs,commonRunCSS,styleManager){
		const text=element.textContent||'';
		let cursor=0;
		for(const run of runs||[]){
			if(!run.text)continue;
			const match=findWordRunMatch(text,run.text,cursor)||findWordRunMatch(text,run.text,0);
			if(!match)continue;
			cursor=match.index+match.length;
			const className=styleManager.classFor(withoutCommonCSS(run.css||{},commonRunCSS));
			if(!className)continue;
			const range=wordTextRange(element,match.index,match.length);
			if(!range)continue;
			const span=document.createElement('span');
			span.className=className;
			try{span.appendChild(range.extractContents());range.insertNode(span);}catch(_){continue;}
		}
	}

	function applyDocxColorFormatting(html,paragraphs){
		if(!paragraphs||!paragraphs.length)return{html,css:'',baseClass:''};
		const allRuns=paragraphs.flatMap(item=>item.runs||[]).filter(run=>run&&run.text);
		const runStyles=allRuns.map(run=>run.css||{});
		const commonRun=commonCSS(runStyles,DOCX_INHERITABLE_PROPERTIES);
		// A document-wide default such as 11pt often applies to nearly every run,
		// while a few headings or emphasis runs have explicit sizes. Put the
		// dominant default on the wrapper and emit classes only for the exceptions.
		const dominantFontSize=dominantCSSValue(runStyles,'font-size',0.8);
		if(dominantFontSize)commonRun['font-size']=dominantFontSize;
		const commonParagraph=commonCSS(paragraphs.map(item=>item.css||{}),new Set(['text-align']));
		const baseCSS=Object.assign({},commonRun,commonParagraph);
		const styleManager=createDocxStyleManager();
		const baseClass=styleManager.addBase(baseCSS);

		const parsed=new DOMParser().parseFromString('<!doctype html><body>'+String(html||'')+'</body>','text/html');
		const lookup=new Map();
		paragraphs.forEach(item=>{
			const key=normalizeWordMatchText(item.text);
			if(!key)return;
			if(!lookup.has(key))lookup.set(key,[]);
			lookup.get(key).push(item);
		});
		const candidates=Array.from(parsed.body.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li')).filter(element=>!(element.tagName.toLowerCase()==='li'&&element.querySelector('p')));
		for(const element of candidates){
			const queue=lookup.get(normalizeWordMatchText(element.textContent));
			if(!queue||!queue.length)continue;
			const item=queue.shift();
			const paragraphClass=styleManager.classFor(withoutCommonCSS(item.css||{},commonParagraph));
			if(paragraphClass)element.classList.add(paragraphClass);
			applyWordRunClasses(element,item.runs,commonRun,styleManager);
		}
		return{html:parsed.body.innerHTML,css:styleManager.cssText(),baseClass};
	}

	function parseDocxSVG(markup,doc){
		try{
			let source=String(markup||'');
			const rootOpenTag=/<svg\b[^>]*>/i.exec(source);
			const hadNamespace=!!(rootOpenTag&&/\bxmlns\s*=/i.test(rootOpenTag[0]));
			if(rootOpenTag&&!hadNamespace){
				source=source.replace(/<svg\b/i,match=>match+' xmlns="'+SVG_NS+'"');
			}
			const parsed=new DOMParser().parseFromString(source,'image/svg+xml');
			if(parsed.getElementsByTagName('parsererror').length)return null;
			const root=parsed.documentElement;
			if(!root||String(root.localName||'').toLowerCase()!=='svg'||root.namespaceURI!==SVG_NS)return null;
			if(!hadNamespace)root.removeAttribute('xmlns');
			return doc.importNode(root,true);
		}catch(_){return null;}
	}

	function backtickStateAfter(text,state=''){
		const pattern=/`+/g;
		let match;
		while((match=pattern.exec(String(text||'')))){
			if(match[0].length>=3)continue;
			if(!state)state=match[0].length;
			else if(state===match[0].length)state='';
		}
		return state;
	}

	function inlineCodeStateAt(text,index,state=''){
		return backtickStateAfter(String(text||'').slice(0,index),state);
	}

	function restoreDocxSVGMarkup(html){
		const parsed=new DOMParser().parseFromString('<!doctype html><body>'+String(html||'')+'</body>','text/html');
		const blocks=Array.from(parsed.body.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,td,th'))
			.filter(element=>!element.closest('pre,code'))
			.filter(element=>!(element.tagName.toLowerCase()==='li'&&element.querySelector('p')))
			.filter(element=>!(['td','th'].includes(element.tagName.toLowerCase())&&element.querySelector('p,li,h1,h2,h3,h4,h5,h6')));
		let fence=null;
		let inlineTicks='';
		for(let i=0;i<blocks.length;i++){
			const block=blocks[i];
			if(!block.isConnected)continue;
			const text=block.textContent||'';
			const trimmed=text.trim();
			const fenceMatch=/^(`{3,}|~{3,})(.*)$/.exec(trimmed);
			if(fence){
				if(fenceMatch&&fenceMatch[1][0]===fence.char&&fenceMatch[1].length>=fence.length&&!fenceMatch[2].trim())fence=null;
				continue;
			}
			if(fenceMatch){fence={char:fenceMatch[1][0],length:fenceMatch[1].length};continue;}
			const svgStart=text.search(/<svg\b/i);
			if(svgStart>=0&&!inlineCodeStateAt(text,svgStart,inlineTicks)){
				const pieces=[];
				const offsets=[];
				let combined='';
				let endBlock=-1;
				let localEnd=-1;
				for(let j=i;j<blocks.length;j++){
					const piece=blocks[j].textContent||'';
					offsets.push(combined.length+(j===i?0:1));
					pieces.push(piece);
					combined+=(j===i?'':'\n')+piece;
					const close=combined.slice(svgStart).search(/<\/svg\s*>/i);
					if(close>=0){
						const closeMatch=combined.slice(svgStart+close).match(/^<\/svg\s*>/i);
						const absoluteEnd=svgStart+close+closeMatch[0].length;
						for(let k=0;k<offsets.length;k++){
							const begin=offsets[k];
							const finish=begin+pieces[k].length;
							if(absoluteEnd<=finish){endBlock=i+k;localEnd=absoluteEnd-begin;break;}
						}
						break;
					}
				}
				if(endBlock>=i){
					const markup=combined.slice(svgStart,offsets[endBlock-i]+localEnd);
					const svg=parseDocxSVG(markup,parsed);
					if(svg){
						const first=blocks[i];
						const last=blocks[endBlock];
						const prefix=(first.textContent||'').slice(0,svgStart);
						const suffix=(last.textContent||'').slice(localEnd);
						// Preserve Word-generated class hooks without wrapping a standalone SVG
						// in the paragraph/span markup used for ordinary text.
						const inheritedClasses=new Set();
						[first,...Array.from(first.querySelectorAll('[class]'))].forEach(element=>{
							String(element.className&&typeof element.className==='string'?element.className:element.getAttribute('class')||'').split(/\s+/).filter(Boolean).forEach(name=>inheritedClasses.add(name));
						});
						if(!prefix&&!suffix&&first.parentNode){
							if(inheritedClasses.size)svg.classList.add(...inheritedClasses);
							first.parentNode.insertBefore(svg,first);
							for(let j=i;j<=endBlock;j++)if(blocks[j].parentNode)blocks[j].parentNode.removeChild(blocks[j]);
						}else{
							while(first.firstChild)first.removeChild(first.firstChild);
							if(prefix)first.appendChild(parsed.createTextNode(prefix));
							first.appendChild(svg);
							if(suffix)first.appendChild(parsed.createTextNode(suffix));
							for(let j=i+1;j<=endBlock;j++)if(blocks[j].parentNode)blocks[j].parentNode.removeChild(blocks[j]);
						}
						inlineTicks=backtickStateAfter(prefix+suffix,inlineTicks);
						i=endBlock;
						continue;
					}
				}
			}
			inlineTicks=backtickStateAfter(text,inlineTicks);
		}
		return parsed.body.innerHTML;
	}

	function docxBlockTextWithBreaks(element){
		let text='';
		function visit(node){
			for(const child of Array.from(node.childNodes||[])){
				if(child.nodeType===Node.TEXT_NODE)text+=child.nodeValue||'';
				else if(child.nodeType===Node.ELEMENT_NODE){
					if(child.tagName&&child.tagName.toLowerCase()==='br')text+='\n';
					else visit(child);
				}
			}
		}
		visit(element);
		return text;
	}

	function extractDocxRawICBBlocks(html){
		const parsed=new DOMParser().parseFromString('<!doctype html><body>'+String(html||'')+'</body>','text/html');
		const blocks=Array.from(parsed.body.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,td,th'))
			.filter(element=>!element.closest('pre,code'))
			.filter(element=>!(element.tagName.toLowerCase()==='li'&&element.querySelector('p')))
			.filter(element=>!(['td','th'].includes(element.tagName.toLowerCase())&&element.querySelector('p,li,h1,h2,h3,h4,h5,h6')));
		const groups=[];
		let active=null;
		for(let index=0;index<blocks.length;index++){
			const block=blocks[index];
			const text=docxBlockTextWithBreaks(block);
			const lines=text.split(/\r?\n/);
			for(let lineIndex=0;lineIndex<lines.length;lineIndex++){
				const line=lines[lineIndex];
				if(!active){
					const opening=/^\s{0,3}(~{3,})([^\r\n~].*)$/.exec(line);
					if(opening&&lineIndex===0){
						active={start:index,lines:[line],fenceLength:opening[1].length};
					}
					continue;
				}
				active.lines.push(line);
				const close=new RegExp('^\\s{0,3}~{'+active.fenceLength+',}\\s*$');
				if(close.test(line)&&lineIndex===lines.length-1){
					active.end=index;
					const selected=blocks.slice(active.start,active.end+1);
					if(selected.length&&selected.every(item=>item.parentNode===selected[0].parentNode))groups.push({
						start:active.start,
						end:active.end,
						parent:selected[0].parentNode,
						first:selected[0],
						nodes:selected,
						source:active.lines.join('\n')
					});
					active=null;
					break;
				}
			}
		}
		const rawBlocks=[];
		for(const group of groups.reverse()){
			const index=rawBlocks.length;
			const token='\uE300SGMLDOCXRAWICB'+index+'\uE301';
			const placeholder=parsed.createTextNode(token);
			group.parent.insertBefore(placeholder,group.first);
			group.nodes.forEach(node=>{if(node.parentNode===group.parent)group.parent.removeChild(node);});
			rawBlocks.unshift({token,source:group.source});
		}
		return{html:parsed.body.innerHTML,blocks:rawBlocks};
	}

	function restoreDocxRawICBBlocks(source,blocks){
		let result=String(source||'');
		for(const block of blocks||[]){
			result=result.split(block.token).join(block.source);
		}
		return result;
	}

	async function convertDocx(bytes,fileName){
		const mammoth=await loadScript(ASSETS.mammoth,'mammoth');
		const data=bytesFrom(bytes);
		const arrayBuffer=data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength);
		let conversionArrayBuffer=arrayBuffer;
		let emptyParagraphMarkers=[];
		let formatting=[];
		try{
			const JSZip=await loadScript(ASSETS.jszip,'JSZip');
			const zip=await JSZip.loadAsync(arrayBuffer);
			const documentFile=zip.file('word/document.xml');
			if(documentFile){
				const documentXML=await documentFile.async('string');
				const marked=markEmptyDocxParagraphs(documentXML);
				emptyParagraphMarkers=marked.markers;
				if(emptyParagraphMarkers.length){
					zip.file('word/document.xml',marked.xml);
					conversionArrayBuffer=await zip.generateAsync({type:'arraybuffer'});
				}
			}
			formatting=await extractDocxColorFormatting(data,JSZip);
		}catch(error){
			console.warn('Additional DOCX formatting or blank-line preservation is unavailable; using the original DOCX package.',error);
			conversionArrayBuffer=arrayBuffer;
			emptyParagraphMarkers=[];
		}
		// Preserve the original Word paragraph structure before Mammoth converts
		// it to HTML; otherwise empty paragraphs can disappear during conversion.
		const result=await mammoth.convertToHtml({arrayBuffer:conversionArrayBuffer},{
			styleMap:['u => u'],
			includeDefaultStyleMap:true
		});
		const withEmptyParagraphs=restoreDocxEmptyParagraphMarkers(result.value||'',emptyParagraphMarkers);
		const formatted=applyDocxColorFormatting(withEmptyParagraphs,formatting);
		const withSVG=restoreDocxSVGMarkup(formatted.html);
		// ~~~Name blocks are SGML's isolated raw-HTML containers. Lift their
		// original Word text out before sanitization so SVG, <style>, buttons,
		// scripts, and all other authored contents are not HTML-escaped or
		// rewritten by the ordinary DOCX HTML sanitizer.
		const rawICB=extractDocxRawICBBlocks(withSVG);
		const clean=sanitizeHtmlFragment(rawICB.html);
		// Flatten Word paragraphs to source newlines while retaining empty
		// paragraphs and explicit Word line breaks.
		const readable=flattenDocxParagraphs(clean);
		const restored=restoreSGMLMarkupInHTML(readable);
		const sourceWithRawICB=restoreDocxRawICBBlocks(restored,rawICB.blocks);
		return{
			content:buildImportedWrapper('docx',fileName,sourceWithRawICB,{baseClass:formatted.baseClass,css:formatted.css}),
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
