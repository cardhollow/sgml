/*
 * SGML extensions: <sgmlCopy>/<sgmlPaste>, <terminalCode>/<terminalOutput>
 * and <procedure>/<step>.
 *
 * Source-level features (copy/paste and terminals) run BEFORE <js> expansion,
 * ICB extraction, literal masking and Markdown, because their bodies must stay
 * opaque. The renderer calls preprocessSGMLExtensions() from prepareSGMLRender().
 * Procedures are ordinary block components built by buildProcedureHTML().
 */
(function(){
	'use strict';

	/* ------------------------------------------------------------------ *
	 * Shared scanning helpers
	 * ------------------------------------------------------------------ */

	const EXT_TAGS=['sgmlCopy','sgmlPaste','sgmlHolder','terminalCode','terminalOutput'];
	const EXT_TAG_PATTERN=/<(sgmlCopy|sgmlPaste|sgmlHolder|terminalCode|terminalOutput)(?=[\s/>])/iy;
	const MAX_PASTE_DEPTH=24;

	// Quote-aware end of an opening tag. Values end at the next matching quote
	// (no backslash escapes), so a ">" or ";" inside style="..." is safe.
	function findOpenTagEnd(source,from){
		let quote='';
		for(let i=from;i<source.length;i++){
			const c=source[i];
			if(quote){if(c===quote)quote='';continue;}
			if(c==='"'||c==="'"){quote=c;continue;}
			if(c==='>')return i+1;
		}
		return -1;
	}

	function escapeRegExp(text){
		return String(text).replace(/[.*+?^${}()|[\]\\\/-]/g,'\\$&');
	}

	function canonicalTag(name){
		const lower=String(name).toLowerCase();
		return EXT_TAGS.find(tag=>tag.toLowerCase()===lower)||name;
	}

	/*
	 * Find top-level extension tags outside of "unrendered" zones: backslash
	 * escapes, backtick literals, ~~~ ICB fences and <js> bodies. A <sgmlCopy>
	 * body is matched with nesting; terminal bodies end at the first close tag.
	 */
	function findExtensionTags(source,names){
		const wanted=new Set(names.map(name=>name.toLowerCase()));
		const found=[];
		let inLiteral=false;

		for(let i=0;i<source.length;i++){
			const c=source[i];

			if(c==='\\'&&i+1<source.length&&isSGMLEscapable(source[i+1])){i++;continue;}

			if(c==='`'){inLiteral=!inLiteral;continue;}
			if(inLiteral)continue;

			if(c==='~'&&source.startsWith('~~~',i)){
				const fenceEnd=findICBFenceEnd(source,i);
				if(fenceEnd!==null){i=fenceEnd-1;continue;}
			}

			if(c!=='<')continue;

			if(/^<js\b[^>]*>/i.test(source.slice(i,i+200))){
				const opening=source.slice(i).match(/^<js\b[^>]*>/i);
				const closing=findJSClosingTag(source,i+opening[0].length);
				if(closing){i=closing.end-1;continue;}
			}

			EXT_TAG_PATTERN.lastIndex=i;
			const hit=EXT_TAG_PATTERN.exec(source);
			if(!hit)continue;
			const name=canonicalTag(hit[1]);
			const openEnd=findOpenTagEnd(source,i+hit[0].length);
			if(openEnd<0)continue;

			const open=source.slice(i,openEnd);
			const selfClosing=/\/\s*>$/.test(open);
			let record={name,index:i,open,openEnd,selfClosing,content:'',end:openEnd};

			if(name==='sgmlPaste'){
				if(!selfClosing){
					const tail=source.slice(openEnd).match(/^\s*<\/sgmlPaste\s*>/i);
					if(tail)record.end=openEnd+tail[0].length;
				}
			}else if(!selfClosing){
				let close=null;
				if(name==='sgmlCopy'||name==='sgmlHolder'){
					const token=new RegExp(`<(/?)${name}(?=[\\s/>])[^>]*>`,'ig');
					token.lastIndex=openEnd;
					let depth=1,m;
					while((m=token.exec(source))!==null){
						if(m[1]){if(--depth===0){close={index:m.index,end:token.lastIndex};break;}}
						else if(!/\/\s*>$/.test(m[0]))depth++;
					}
				}else{
					const token=new RegExp(`</${name}\\s*>`,'ig');
					token.lastIndex=openEnd;
					const m=token.exec(source);
					if(m)close={index:m.index,end:token.lastIndex};
				}
				if(!close){i=openEnd-1;continue;}
				record.content=source.slice(openEnd,close.index);
				record.end=close.end;
			}

			if(wanted.has(name.toLowerCase()))found.push(record);
			i=record.end-1;
		}
		return found;
	}

	function parseAttrs(openTag){
		const source=String(openTag||'').replace(/\/\s*>$/,'>');
		const attrs=parseNotebookTagAttributes(source);
		// These extension flags may be written as bare XML-style booleans.
		['runnable','addcode','allowinput','editable'].forEach(name=>{
			const bare=new RegExp('(?:^|\\s)'+name+'(?=\\s|/?>)','i');
			const assigned=new RegExp('(?:^|\\s)'+name+'\\s*(?:=|:)','i');
			if(bare.test(source)&&!assigned.test(source))attrs[name]=true;
		});
		return attrs;
	}

	function textAttr(value){
		return typeof value==='string'?value:(value===true?'true':'');
	}

	function dedent(text){
		const lines=String(text||'').replace(/\r\n?/g,'\n').split('\n');
		while(lines.length&&!lines[0].trim())lines.shift();
		while(lines.length&&!lines[lines.length-1].trim())lines.pop();
		let min=Infinity;
		lines.forEach(line=>{
			if(!line.trim())return;
			min=Math.min(min,line.match(/^[ \t]*/)[0].length);
		});
		if(!isFinite(min)||min===0)return lines.join('\n');
		return lines.map(line=>/^[ \t]*$/.test(line.slice(0,min))?line.slice(min):line.replace(/^[ \t]+/,'')).join('\n');
	}

	/* ------------------------------------------------------------------ *
	 * <sgmlCopy name=""> ... </sgmlCopy>   <sgmlPaste name=""/>
	 * ------------------------------------------------------------------ */

	let copyStore=new Map();

	function missingPaste(name,reason){
		return `<span class="sgml-paste-error">sgmlPaste "${escapeHTMLText(name)}": ${escapeHTMLText(reason)}</span>`;
	}

	function substituteSGMLHolders(source,pasteAttrs){
		const holders=findExtensionTags(String(source||''),['sgmlHolder']);
		if(!holders.length)return String(source||'');
		let out='';
		let cursor=0;
		holders.forEach(holder=>{
			out+=source.slice(cursor,holder.index);
			cursor=holder.end;
			const id=String(textAttr(parseAttrs(holder.open).id)).trim().toLowerCase();
			if(id&&Object.prototype.hasOwnProperty.call(pasteAttrs,id)){
				const replacement=pasteAttrs[id];
				out+=replacement===false?'false':replacement===true?'true':String(replacement??'');
			}
			else out+=holder.content;
		});
		return out+source.slice(cursor);
	}

	function expandCopyPaste(source,depth,stack){
		source=String(source||'');
		if(!/<sgml(?:Copy|Paste)/i.test(source))return source;
		const tags=findExtensionTags(source,EXT_TAGS);
		if(!tags.some(tag=>tag.name==='sgmlCopy'||tag.name==='sgmlPaste'))return source;

		// Pass 1: store every copy first, so a paste may appear before its copy.
		tags.forEach(tag=>{
			if(tag.name!=='sgmlCopy')return;
			const name=String(textAttr(parseAttrs(tag.open).name)).trim();
			if(name&&!copyStore.has(name))copyStore.set(name,dedent(tag.content));
		});

		// Pass 2: copies disappear, pastes are replaced by the stored source.
		let out='';
		let cursor=0;
		tags.forEach(tag=>{
			if(tag.name!=='sgmlCopy'&&tag.name!=='sgmlPaste')return;
			out+=source.slice(cursor,tag.index);
			cursor=tag.end;
			if(tag.name==='sgmlCopy')return;

			const pasteAttrs=parseAttrs(tag.open);
			const name=String(textAttr(pasteAttrs.name)).trim();
			if(!name){out+=missingPaste('','missing name attribute');return;}
			if(!copyStore.has(name)){out+=missingPaste(name,'no sgmlCopy with that name');return;}
			if(stack.includes(name)||depth>=MAX_PASTE_DEPTH){out+=missingPaste(name,'circular paste');return;}
			const substituted=substituteSGMLHolders(copyStore.get(name),pasteAttrs);
			out+=expandCopyPaste(substituted,depth+1,stack.concat(name));
		});
		return out+source.slice(cursor);
	}

	/* ------------------------------------------------------------------ *
	 * <terminalCode> / <terminalOutput>
	 * ------------------------------------------------------------------ */

	const terminalCodeRoots=new Map();
	const terminalOutputRoots=new Map();
	const terminalRuns=new Map();

	function isEnabledAttribute(value){
		return value===true||/^(?:true|1|yes|on)$/i.test(String(value??'').trim());
	}

	function stopTerminalWorkers(target){
		const records=terminalRuns.get(target)||[];
		records.forEach(record=>{
			const terminal=record.outputRoot&&record.outputRoot.__sgmlTerminal;
			if(terminal&&terminal.clearInput)terminal.clearInput();
			try{record.worker.terminate();}catch(_error){}
			try{URL.revokeObjectURL(record.url);}catch(_error){}
		});
		terminalRuns.delete(target);
	}

	function stopAllTerminalWorkers(){
		Array.from(terminalRuns.keys()).forEach(stopTerminalWorkers);
	}

	function terminalBlocks(){
		window.__sgmlTerminalBlocks=window.__sgmlTerminalBlocks||[];
		return window.__sgmlTerminalBlocks;
	}

	function extractOutCodes(text){
		const scripts=[];
		const source=String(text||'');
		const pattern=/<outCode\s*>([\s\S]*?)<\/outCode\s*>/gi;
		let visible='';
		let cursor=0;
		let match;
		while((match=pattern.exec(source))!==null){
			visible+=source.slice(cursor,match.index);
			scripts.push(match[1].replace(/^\r?\n|\r?\n$/g,''));
			cursor=pattern.lastIndex;
		}
		visible+=source.slice(cursor);
		return{text:visible,scripts};
	}

	function extractTerminals(source){
		source=String(source||'');
		if(!/<terminal(?:Code|Output)/i.test(source))return source;
		const tags=findExtensionTags(source,['terminalCode','terminalOutput']).filter(tag=>!tag.selfClosing);
		if(!tags.length)return source;
		const store=terminalBlocks();
		let out='';
		let cursor=0;
		tags.forEach(tag=>{
			out+=source.slice(cursor,tag.index);
			cursor=tag.end;
			const index=store.length;
			const attrs=parseAttrs(tag.open);
			const kind=tag.name==='terminalCode'?'code':'output';
			const extracted=kind==='output'?extractOutCodes(tag.content):{text:tag.content,scripts:[]};
			store.push({index,kind,attrs,text:extracted.text,outCodes:extracted.scripts});
			out+=`\n\n<div class="sgml-term-slot" data-term-index="${index}"></div>\n\n`;
		});
		return out+source.slice(cursor);
	}

	/* ---- style="#hex word word /regex/flags; #hex ..." ---- */

	/* ---- style="#hex word word /regex/flags; #hex ..." ---- */

	function isColorToken(token){
		if(/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(token))return true;
		return typeof CSS!=='undefined'&&!!CSS.supports&&CSS.supports('color',token);
	}

	function readRegexLiteral(text,start){
		let j=start+1;
		let inClass=false;
		for(;j<text.length;j++){
			const c=text[j];
			if(c==='\\'){j++;continue;}
			if(c==='[')inClass=true;
			else if(c===']')inClass=false;
			else if(c==='/'&&!inClass)break;
		}
		if(j>=text.length||j===start+1)return null;
		const flags=(text.slice(j+1).match(/^[a-z]*/i)||[''])[0];
		return{source:text.slice(start+1,j),flags,end:j+1+flags.length};
	}

	function wordMatcher(word){
		const left=/^[\w$]/.test(word)?'(?<![\\w$])':'';
		const right=/[\w$]$/.test(word)?'(?![\\w$])':'';
		return new RegExp(left+escapeRegExp(word)+right,'g');
	}

	function parseTerminalStyle(text){
		const rules=[];
		text=String(text||'');
		let rule=null;
		let skipping=false;
		const flush=()=>{if(rule&&rule.matchers.length)rules.push(rule);rule=null;skipping=false;};
		let i=0;
		while(i<text.length){
			const c=text[i];
			if(/\s/.test(c)){i++;continue;}
			if(c===';'){flush();i++;continue;}
			let token=null;
			if(c==='/'){
				const literal=readRegexLiteral(text,i);
				if(literal){
					token={regex:literal.source,flags:literal.flags};
					i=literal.end;
				}
			}
			if(!token){
				let j=i;
				while(j<text.length&&!/[\s;]/.test(text[j]))j++;
				token={word:text.slice(i,j)};
				i=j;
			}
			if(skipping)continue;
			if(!rule){
				if(!token.word||!isColorToken(token.word)){skipping=true;continue;}
				rule={color:token.word,matchers:[]};
				continue;
			}
			try{
				if(token.regex!==undefined){
					const flags=token.flags.replace(/[gy]/g,'')+'g';
					rule.matchers.push(new RegExp(token.regex,flags));
				}else if(token.word){
					rule.matchers.push(wordMatcher(token.word));
				}
			}catch(error){
				console.warn('SGML terminal style: invalid pattern ignored:',token,error);
			}
		}
		flush();
		return rules;
	}

	// Leftmost match wins; on a tie the earlier rule wins. This lets a string
	// or comment rule protect keywords inside it without ordering tricks.
	function highlightSpans(text,rules){
		const entries=[];
		rules.forEach((rule,ruleIndex)=>rule.matchers.forEach(re=>entries.push({re,color:rule.color,order:ruleIndex,next:undefined})));
		const spans=[];
		let pos=0;
		while(pos<text.length){
			let best=null;
			for(const entry of entries){
				if(entry.next===null)continue;
				if(entry.next===undefined||entry.next.index<pos){
					entry.re.lastIndex=pos;
					let match=null;
					while((match=entry.re.exec(text))!==null){
						if(match[0].length)break;
						entry.re.lastIndex=match.index+1;
						if(entry.re.lastIndex>text.length){match=null;break;}
					}
					entry.next=match||null;
				}
				if(!entry.next)continue;
				if(!best||entry.next.index<best.next.index||(entry.next.index===best.next.index&&entry.order<best.order))best=entry;
			}
			if(!best)break;
			const start=best.next.index;
			const end=start+best.next[0].length;
			spans.push({start,end,color:best.color});
			pos=end;
		}
		return spans;
	}

	/* ---- folding="start: regex; end: regex; ignore: strings, comments" ---- */

	const BRACKET_CLOSERS={'(':')','[':']','{':'}','<':'>'};
	const DEFAULT_FOLD_START='[\\[{(]';
	const DEFAULT_FOLD_END='[\\]})]';

	function toRegExp(value,fallback){
		let text=String(value||'').trim()||fallback;
		let flags='';
		if(text[0]==='/'){
			const literal=readRegexLiteral(text,0);
			if(literal&&literal.end===text.length){text=literal.source;flags=literal.flags;}
		}
		try{return new RegExp(text,flags.replace(/[gy]/g,'')+'g');}
		catch(error){
			console.warn('SGML terminal folding: invalid regex ignored:',value,error);
			return new RegExp(fallback,'g');
		}
	}

	function splitFoldingOptions(text){
		const parts=[];
		let current='';
		let inClass=false;
		for(let i=0;i<text.length;i++){
			const c=text[i];
			if(c==='\\'){current+=c+(text[i+1]||'');i++;continue;}
			if(c==='[')inClass=true;
			else if(c===']')inClass=false;
			if(c===';'&&!inClass){parts.push(current);current='';continue;}
			current+=c;
		}
		parts.push(current);
		return parts;
	}

	function parseTerminalFolding(value){
		if(value===undefined||value===false)return null;
		const text=value===true?'':String(value);
		if(/^\s*(?:false|off|none)\s*$/i.test(text))return null;
		const options={};
		splitFoldingOptions(text).forEach(part=>{
			const m=part.match(/^\s*(start|end|ignore|collapsed)\s*:\s*([\s\S]*?)\s*$/i);
			if(m)options[m[1].toLowerCase()]=m[2];
			else if(/^\s*collapsed\s*$/i.test(part))options.collapsed='all';
		});
		return{
			start:toRegExp(options.start,DEFAULT_FOLD_START),
			end:toRegExp(options.end,DEFAULT_FOLD_END),
			ignore:/^\s*none\s*$/i.test(options.ignore||'')?false:true,
			collapsed:parseCollapsedSpec(options.collapsed)
		};
	}

	/*
	 * collapsed: all | none | 3, 8-12 | /regex/flags
	 * Chooses which fold regions start closed. Line numbers are 1-based and
	 * refer to the line that carries the fold caret; a regex is tested against
	 * the text of that line. Returns null when nothing starts collapsed.
	 */
	function parseCollapsedSpec(value){
		const text=String(value||'').trim();
		if(!text||/^(?:none|no|false|off|0)$/i.test(text))return null;
		if(/^(?:all|yes|true|on|auto)$/i.test(text))return{all:true,ranges:[],regex:null};
		const spec={all:false,ranges:[],regex:null};
		if(text[0]==='/'){
			const literal=readRegexLiteral(text,0);
			if(literal&&literal.end===text.length){
				try{spec.regex=new RegExp(literal.source,literal.flags.replace(/[gy]/g,''));}
				catch(error){console.warn('SGML terminal folding: invalid collapsed regex ignored:',text,error);}
				return spec.regex?spec:null;
			}
		}
		text.split(/[\s,]+/).forEach(token=>{
			const m=token.match(/^(\d+)(?:-(\d+))?$/);
			if(!m)return;
			const a=Number(m[1]),b=m[2]?Number(m[2]):a;
			spec.ranges.push([Math.min(a,b),Math.max(a,b)]);
		});
		return spec.ranges.length?spec:null;
	}

	// Set of 0-based fold-start lines that begin collapsed.
	function initialCollapsedLines(folds,textLines,spec){
		const result=new Set();
		if(!spec)return result;
		Object.keys(folds).map(Number).forEach(line=>{
			if(spec.all)result.add(line);
			else if(spec.regex&&spec.regex.test(textLines[line]))result.add(line);
			else if(spec.ranges.some(range=>line+1>=range[0]&&line+1<=range[1]))result.add(line);
		});
		return result;
	}

	// Blank out strings, comments and regex literals (same length, newlines kept)
	// so brackets inside them never create folds.
	function maskNonCode(text){
		const out=text.split('');
		const blank=(from,to)=>{for(let k=from;k<to;k++)if(out[k]!=='\n')out[k]=' ';};
		const regexWords=new Set(['return','typeof','case','do','else','in','of','void','delete','throw','yield','await']);
		let canRegex=true;
		let i=0;
		while(i<text.length){
			const c=text[i],n=text[i+1];
			if(c==='/'&&n==='/'){let j=text.indexOf('\n',i);if(j<0)j=text.length;blank(i,j);i=j;continue;}
			if(c==='/'&&n==='*'){let j=text.indexOf('*/',i+2);j=j<0?text.length:j+2;blank(i,j);i=j;continue;}
			if(c==='"'||c==="'"||c==='`'){
				let j=i+1;
				while(j<text.length){
					if(text[j]==='\\'){j+=2;continue;}
					if(text[j]===c)break;
					if(text[j]==='\n'&&c!=='`')break;
					j++;
				}
				const end=Math.min(text.length,j+1);
				blank(i,end);i=end;canRegex=false;continue;
			}
			if(c==='/'&&canRegex){
				let j=i+1,inClass=false,ok=false;
				while(j<text.length&&text[j]!=='\n'){
					if(text[j]==='\\'){j+=2;continue;}
					if(text[j]==='[')inClass=true;
					else if(text[j]===']')inClass=false;
					else if(text[j]==='/'&&!inClass){ok=true;break;}
					j++;
				}
				if(ok){
					j++;
					while(/[a-z]/i.test(text[j]||''))j++;
					blank(i,j);i=j;canRegex=false;continue;
				}
			}
			if(/[A-Za-z_$]/.test(c)){
				const word=text.slice(i).match(/^[A-Za-z_$][\w$]*/)[0];
				canRegex=regexWords.has(word);i+=word.length;continue;
			}
			if(/[0-9]/.test(c)){while(/[\w.]/.test(text[i]||''))i++;canRegex=false;continue;}
			if(/\s/.test(c)){i++;continue;}
			canRegex=!(c===')'||c===']'||c==='}');
			i++;
		}
		return out.join('');
	}

	// Returns {startLine:{end}}; the closing line stays visible when folded.
	function computeFolds(text,folding){
		const code=folding.ignore?maskNonCode(text):text;
		const lineStarts=[0];
		for(let i=0;i<text.length;i++)if(text[i]==='\n')lineStarts.push(i+1);
		const lineOf=offset=>{
			let lo=0,hi=lineStarts.length-1;
			while(lo<hi){const mid=(lo+hi+1)>>1;if(lineStarts[mid]<=offset)lo=mid;else hi=mid-1;}
			return lo;
		};
		const collect=(re,kind)=>{
			const tokens=[];
			re.lastIndex=0;
			let m;
			while((m=re.exec(code))!==null){
				if(!m[0].length){re.lastIndex=m.index+1;continue;}
				tokens.push({index:m.index,end:m.index+m[0].length,kind,text:m[0]});
				re.lastIndex=m.index+m[0].length;
			}
			return tokens;
		};
		const starts=collect(folding.start,'S');
		const ends=collect(folding.end,'E');
		const byIndex=new Map();
		starts.forEach(t=>byIndex.set(t.index,t));
		const tokens=starts.slice();
		ends.forEach(t=>{
			const same=byIndex.get(t.index);
			if(same){same.kind='SE';return;} // same text opens or closes (fences, quotes)
			tokens.push(t);
		});
		tokens.sort((a,b)=>a.index-b.index);

		const stack=[];
		const folds={};
		const addRegion=(open,closeIndex)=>{
			const a=lineOf(open.index),b=lineOf(closeIndex);
			if(b-a<2)return;
			if(!folds[a]||folds[a].end<b)folds[a]={end:b};
		};
		tokens.forEach(token=>{
			let closing=token.kind==='E'||(token.kind==='SE'&&stack.length&&stack[stack.length-1].text===token.text);
			if(!closing){stack.push(token);return;}
			if(!stack.length)return;
			const closerChar=token.text[0];
			const isBracketPair=token.text.length===1&&Object.values(BRACKET_CLOSERS).includes(closerChar);
			let at=stack.length-1;
			if(isBracketPair){
				at=-1;
				for(let k=stack.length-1;k>=0;k--){
					const o=stack[k];
					if(o.text.length===1&&BRACKET_CLOSERS[o.text]===closerChar){at=k;break;}
				}
				if(at<0)return;
			}
			const open=stack[at];
			stack.length=at;
			addRegion(open,token.index);
		});
		return folds;
	}

	/* ---- DOM construction ---- */

	const CARET_SVG='<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

	function safeColor(value,fallback){
		const color=String(textAttr(value)).trim();
		if(!color)return fallback;
		if(/^[0-9a-f]{3,8}$/i.test(color)&&[3,4,6,8].includes(color.length))return '#'+color;
		return typeof sanitizeSGMLColor==='function'?(sanitizeSGMLColor(color)||fallback):fallback;
	}

	function copyText(text){
		if(navigator.clipboard&&navigator.clipboard.writeText&&window.isSecureContext){
			return navigator.clipboard.writeText(text);
		}
		return new Promise((resolve,reject)=>{
			const area=document.createElement('textarea');
			area.value=text;
			area.setAttribute('readonly','');
			area.style.cssText='position:fixed;left:-9999px;top:0;opacity:0';
			document.body.appendChild(area);
			area.select();
			try{document.execCommand('copy')?resolve():reject(new Error('copy command rejected'));}
			catch(error){reject(error);}
			finally{area.remove();}
		});
	}

	function renderTerminalOutputLines(lines,text,rules){
		lines.replaceChildren();
		const value=String(text??'');
		const spans=rules.length?highlightSpans(value,rules):[];
		const textLines=value.split('\n');
		let offset=0;
		let spanIndex=0;
		textLines.forEach(lineText=>{
			const lineStart=offset;
			const lineEnd=offset+lineText.length;
			offset=lineEnd+1;
			const row=document.createElement('div');
			row.className='sgml-term-row';
			const code=document.createElement('code');
			code.className='sgml-term-text';
			let cursor=lineStart;
			while(spanIndex<spans.length&&spans[spanIndex].end<=lineStart)spanIndex++;
			for(let k=spanIndex;k<spans.length&&spans[k].start<lineEnd;k++){
				const start=Math.max(spans[k].start,lineStart);
				const end=Math.min(spans[k].end,lineEnd);
				if(end<=start)continue;
				if(start>cursor)code.appendChild(document.createTextNode(value.slice(cursor,start)));
				const colored=document.createElement('span');
				colored.style.color=spans[k].color;
				colored.textContent=value.slice(start,end);
				code.appendChild(colored);
				cursor=end;
			}
			if(cursor<lineEnd)code.appendChild(document.createTextNode(value.slice(cursor,lineEnd)));
			if(!lineText.length)code.appendChild(document.createTextNode('\u200b'));
			row.appendChild(code);
			lines.appendChild(row);
		});
	}

	function parseTerminalSuggestions(value){
		if(value===undefined||value===null||value===true)return [];
		const raw=String(value).trim();
		if(!raw)return [];
		const normalizeItem=item=>{
			if(typeof item==='string'){
				const parts=item.split('|');
				return{text:(parts[0]||'').trim(),subtitle:(parts[1]||'').trim(),insert:parts.slice(2).join('|')};
			}
			if(!item||typeof item!=='object')return null;
			const text=String(item.text??item.label??item.name??'').trim();
			const subtitle=String(item.subtitle??item.description??item.detail??'').trim();
			const insert=String(item.insert??item.value??item.content??'');
			return text&&insert!==''?{text,subtitle,insert}:null;
		};
		try{
			const parsed=JSON.parse(raw);
			const list=Array.isArray(parsed)?parsed:(Array.isArray(parsed.suggestions)?parsed.suggestions:[]);
			return list.map(normalizeItem).filter(Boolean);
		}catch(_error){}
		// Readable shorthand: one suggestion per line, with three pipe-separated
		// fields: display text | subtitle | inserted source. JSON is recommended
		// whenever a suggestion contains line breaks or pipe characters.
		return raw.split(/\r?\n/).map(line=>line.trim()).filter(Boolean).map(normalizeItem).filter(item=>item&&item.text&&item.insert!=='');
	}

	function buildTerminal(block){
		const isCode=block.kind==='code';
		const attrs=block.attrs||{};
		const text=block.text;
		const title=textAttr(attrs.title)||(isCode?'Code':'Output');
		const accent=safeColor(attrs.accent,isCode?'#60a5fa':'#94a3b8');
		const rules=parseTerminalStyle(textAttr(attrs.style));
		const folding=isCode?parseTerminalFolding(attrs.folding):null;
		let folds=folding?computeFolds(text,folding):{};

		const root=document.createElement('figure');
		root.className='sgml-term tex2jax_ignore '+(isCode?'sgml-term-code':'sgml-term-output');
		root.style.setProperty('--term-accent',accent);

		const head=document.createElement('div');
		head.className='sgml-term-head';
		const dots=document.createElement('span');
		dots.className='sgml-term-dots';
		dots.setAttribute('aria-hidden','true');
		dots.innerHTML='<i></i><i></i><i></i>';
		const label=document.createElement('span');
		label.className='sgml-term-title';
		label.textContent=title;
		let currentText=text;
		const copy=document.createElement('button');
		copy.type='button';
		copy.className='sgml-term-copy';
		copy.textContent='Copy';
		copy.setAttribute('aria-label','Copy '+title+' to clipboard');
		let resetTimer=0;
		copy.addEventListener('click',()=>{
			copyText(currentText).then(()=>{copy.textContent='Copied';copy.classList.add('is-done');},()=>{copy.textContent='Copy failed';copy.classList.add('is-error');})
				.finally(()=>{clearTimeout(resetTimer);resetTimer=setTimeout(()=>{copy.textContent='Copy';copy.classList.remove('is-done','is-error');},1600);});
		});
		head.append(dots,label,copy);

		const target=String(textAttr(attrs.target)).trim();
		const connect=String(textAttr(attrs.connect)).trim();
		const runnable=isCode&&isEnabledAttribute(attrs.runnable);
		const hasConnect=!isCode&&Object.prototype.hasOwnProperty.call(attrs,'connect');
		const linkedOutput=hasConnect;
		if(isCode&&target)root.dataset.termTarget=target;
		if(isCode&&runnable){
			if(!root.dataset.termTarget)root.dataset.termTarget='__sgml_terminal_'+String(block.index??'auto');
			root.dataset.termRunnable='true';
			const run=document.createElement('button');
			run.type='button';
			run.className='sgml-term-run';
			run.textContent='Run';
			run.setAttribute('aria-label','Run '+title);
			head.appendChild(run);
		}
		if(linkedOutput){
			root.dataset.termHasConnect='true';
			root.dataset.termConnect=connect;
			root.hidden=true;
			const stop=document.createElement('button');
			stop.type='button';
			stop.className='sgml-term-stop';
			stop.textContent='Stop';
			stop.setAttribute('aria-label','Stop running code and return to source');
			head.appendChild(stop);
		}
		if(!isCode&&isEnabledAttribute(attrs.addcode))root.dataset.termAddCode='true';

		const body=document.createElement('div');
		body.className='sgml-term-body';
		body.tabIndex=0;
		body.setAttribute('role','region');
		body.setAttribute('aria-label',title);
		const maxHeight=textAttr(attrs.maxheight).trim();
		if(maxHeight){
			const cssValue=/^\d+(?:\.\d+)?$/.test(maxHeight)?maxHeight+'px':maxHeight;
			if(typeof CSS==='undefined'||!CSS.supports||CSS.supports('max-height',cssValue))body.style.maxHeight=cssValue;
		}
		const lines=document.createElement('div');
		lines.className='sgml-term-lines';
		body.appendChild(lines);

		let rows=[];
		const editableSource=isCode&&isEnabledAttribute(attrs.editable);
		const collapsed=initialCollapsedLines(folds,currentText.split('\n'),folding&&folding.collapsed);
		const terminalSuggestions=editableSource?parseTerminalSuggestions(attrs.suggestion):[];
		let suggestionMenu=null;
		let selectedTerminalSuggestion=0;
		const terminalUndo=[];
		const terminalRedo=[];
		const pushTerminalUndo=()=>{terminalUndo.push(currentText);if(terminalUndo.length>120)terminalUndo.shift();terminalRedo.length=0;};

		const applyFoldVisibility=()=>{
			const hidden=new Array(rows.length).fill(false);
			collapsed.forEach(start=>{
				if(!folds[start])return;
				for(let k=start+1;k<folds[start].end&&k<rows.length;k++)hidden[k]=true;
			});
			rows.forEach((row,index)=>{
				row.hidden=!!hidden[index];
				const folded=collapsed.has(index)&&!hidden[index];
				row.classList.toggle('is-folded',folded);
				const caret=row.querySelector('.sgml-term-fold');
				if(caret)caret.setAttribute('aria-expanded',String(!collapsed.has(index)));
			});
		};

		const renderCodeLines=(restoreOffset)=>{
			const sourceLines=currentText.split('\n');
			folds=folding?computeFolds(currentText,folding):{};
			Array.from(collapsed).forEach(line=>{if(!folds[line])collapsed.delete(line);});
			const spans=rules.length?highlightSpans(currentText,rules):[];
			const numberWidth=String(sourceLines.length).length;
			rows=[];
			lines.replaceChildren();
			let offset=0,spanIndex=0;
			sourceLines.forEach((lineText,lineIndex)=>{
				const lineStart=offset,lineEnd=offset+lineText.length;
				offset=lineEnd+1;
				const row=document.createElement('div');
				row.className='sgml-term-row';
				row.dataset.line=String(lineIndex);
				const gutter=document.createElement('span');
				gutter.className='sgml-term-gutter';
				gutter.setAttribute('contenteditable','false');
				if(folding){
					const slot=document.createElement('span');
					slot.className='sgml-term-fold-slot';
					if(folds[lineIndex]){
						const caret=document.createElement('button');
						caret.type='button';
						caret.className='sgml-term-fold';
						caret.setAttribute('aria-expanded','true');
						caret.setAttribute('aria-label','Fold lines '+(lineIndex+2)+' to '+folds[lineIndex].end);
						caret.dataset.line=String(lineIndex);
						caret.innerHTML=CARET_SVG;
						caret.setAttribute('contenteditable','false');
						slot.appendChild(caret);
					}
					gutter.appendChild(slot);
				}
				const number=document.createElement('span');
				number.className='sgml-term-num';
				number.style.minWidth='calc('+numberWidth+'ch + 10px)';
				number.textContent=String(lineIndex+1);
				gutter.appendChild(number);
				row.appendChild(gutter);
				const code=document.createElement('code');
				code.className='sgml-term-text';
				code.dataset.line=String(lineIndex);
				let cursor=lineStart;
				while(spanIndex<spans.length&&spans[spanIndex].end<=lineStart)spanIndex++;
				for(let k=spanIndex;k<spans.length&&spans[k].start<lineEnd;k++){
					const a=Math.max(spans[k].start,lineStart),b=Math.min(spans[k].end,lineEnd);
					if(b<=a)continue;
					if(a>cursor)code.appendChild(document.createTextNode(currentText.slice(cursor,a)));
					const piece=document.createElement('span');
					piece.style.color=spans[k].color;
					piece.textContent=currentText.slice(a,b);
					code.appendChild(piece);
					cursor=b;
				}
				if(cursor<lineEnd)code.appendChild(document.createTextNode(currentText.slice(cursor,lineEnd)));
				if(!lineText.length)code.appendChild(document.createTextNode('\u200b'));
				row.appendChild(code);
				if(folds[lineIndex]){
					const pill=document.createElement('button');
					pill.type='button';
					pill.className='sgml-term-pill';
					pill.dataset.line=String(lineIndex);
					pill.setAttribute('contenteditable','false');
					const hiddenCount=folds[lineIndex].end-lineIndex-1;
					pill.textContent='⋯ '+hiddenCount+(hiddenCount===1?' line':' lines');
					pill.setAttribute('aria-label','Unfold '+hiddenCount+(hiddenCount===1?' line':' lines'));
					row.appendChild(pill);
				}
				lines.appendChild(row);
				rows.push(row);
			});
			applyFoldVisibility();
			if(editableSource&&Number.isFinite(restoreOffset))setCaretAtOffset(restoreOffset);
		};

		function pointToSourceOffset(node,nodeOffset){
			if(!node)return 0;
			const element=node.nodeType===Node.ELEMENT_NODE?node:node.parentElement;
			const code=element&&element.closest?element.closest('.sgml-term-text'):null;
			if(!code||!lines.contains(code))return currentText.length;
			const row=code.closest('.sgml-term-row');
			const line=Number(row&&row.dataset.line)||0;
			let local=0;
			try{
				const range=document.createRange();
				range.selectNodeContents(code);
				range.setEnd(node,nodeOffset);
				local=range.toString().replace(/\u200b/g,'').length;
			}catch(_error){local=0;}
			let absolute=0;
			for(let i=0;i<line;i++){
				const previous=rows[i]&&rows[i].querySelector('.sgml-term-text');
				absolute+=String(previous?previous.innerText??previous.textContent:'').replace(/\u200b/g,'').length+1;
			}
			return absolute+local;
		}

		function selectionSourceOffsets(){
			const selection=window.getSelection&&window.getSelection();
			if(!selection||!selection.rangeCount)return{start:currentText.length,end:currentText.length,focus:currentText.length};
			const a=pointToSourceOffset(selection.anchorNode,selection.anchorOffset);
			const b=pointToSourceOffset(selection.focusNode,selection.focusOffset);
			return{start:Math.min(a,b),end:Math.max(a,b),focus:b};
		}

		function setCaretAtOffset(offset){
			if(!editableSource)return;
			const target=Math.max(0,Math.min(currentText.length,Number(offset)||0));
			const sourceLines=currentText.split('\n');
			let line=0,column=target;
			while(line<sourceLines.length-1&&column>sourceLines[line].length){column-=sourceLines[line].length+1;line++;}
			const code=rows[line]&&rows[line].querySelector('.sgml-term-text');
			if(!code)return;
			let remaining=column,last=null,chosen=null,chosenOffset=0;
			const walker=document.createTreeWalker(code,NodeFilter.SHOW_TEXT);
			let node;
			while((node=walker.nextNode())){
				const value=node.nodeValue||'';
				last=node;
				if(remaining<=value.length){chosen=node;chosenOffset=remaining;break;}
				remaining-=value.length;
			}
			if(!chosen){
				if(last){chosen=last;chosenOffset=(last.nodeValue||'').length;}
				else{chosen=document.createTextNode('');code.appendChild(chosen);chosenOffset=0;}
			}
			try{
				const range=document.createRange();
				range.setStart(chosen,Math.min(chosenOffset,(chosen.nodeValue||'').length));
				range.collapse(true);
				const selection=window.getSelection();
				selection.removeAllRanges();
				selection.addRange(range);
			}catch(_error){}
		}

		function readEditableText(){
			return rows.map(row=>{
				const code=row.querySelector('.sgml-term-text');
				return String(code?code.innerText??code.textContent:'').replace(/\u200b/g,'').replace(/\r\n?/g,'\n');
			}).join('\n');
		}

		function replaceEditableRange(start,end,insert,caret){
			const before=currentText;
			const next=before.slice(0,start)+insert+before.slice(end);
			if(next!==before)pushTerminalUndo();
			currentText=next;
			renderCodeLines(caret===undefined?start+insert.length:caret);
			if(lines.focus)lines.focus({preventScroll:true});
			updateTerminalSuggestions(false,caret===undefined?start+insert.length:caret);
		}

		function applyTerminalSuggestion(item){
			if(!item)return;
			const point=selectionSourceOffsets();
			const prefix=currentText.slice(0,point.focus);
			const match=prefix.match(/[\w$.-]+$/);
			const start=point.start!==point.end?point.start:(match?point.focus-match[0].length:point.focus);
			const end=point.start!==point.end?point.end:point.focus;
			let insert=String(item.insert??'');
			const marker=insert.indexOf('$0');
			if(marker>=0)insert=insert.slice(0,marker)+insert.slice(marker+2);
			const caret=start+(marker>=0?marker:insert.length);
			closeTerminalSuggestions();
			replaceEditableRange(start,end,insert,caret);
		}

		function closeTerminalSuggestions(){
			if(suggestionMenu){suggestionMenu.hidden=true;suggestionMenu.replaceChildren();}
		}

		function updateTerminalSuggestions(force,explicitCaret){
			if(!suggestionMenu||!terminalSuggestions.length)return closeTerminalSuggestions();
			const caret=Number.isFinite(explicitCaret)?explicitCaret:selectionSourceOffsets().focus;
			const before=currentText.slice(0,caret);
			const token=(before.match(/[\w$.-]+$/)||[''])[0];
			if(!force&&!token){closeTerminalSuggestions();return;}
			const query=token.toLowerCase();
			const matches=terminalSuggestions.filter(item=>force||item.text.toLowerCase().includes(query));
			if(!matches.length){closeTerminalSuggestions();return;}
			selectedTerminalSuggestion=0;
			suggestionMenu.replaceChildren();
			matches.slice(0,12).forEach((item,index)=>{
				const button=document.createElement('button');
				button.type='button';
				button.className='sgml-term-suggestion'+(index===0?' is-selected':'');
				button.setAttribute('contenteditable','false');
				button.dataset.index=String(index);
				const titleEl=document.createElement('strong');
				titleEl.textContent=item.text;
				const subtitleEl=document.createElement('span');
				subtitleEl.className='sgml-term-suggestion-subtitle';
				subtitleEl.textContent=item.subtitle;
				const preview=document.createElement('code');
				preview.className='sgml-term-suggestion-insert';
				preview.textContent=item.insert.replace(/\$0/g,'');
				button.append(titleEl,subtitleEl,preview);
				button.addEventListener('pointerdown',event=>event.preventDefault());
				button.addEventListener('click',()=>applyTerminalSuggestion(item));
				suggestionMenu.appendChild(button);
			});
			suggestionMenu.hidden=false;
			let anchorRect=null;
			try{
				const selection=window.getSelection();
				if(selection&&selection.rangeCount){
					const range=selection.getRangeAt(0).cloneRange();
					range.collapse(true);
					anchorRect=range.getBoundingClientRect();
				}
			}catch(_error){}
			if(!anchorRect||(!anchorRect.width&&!anchorRect.height)){
				const row=rows[Math.max(0,Math.min(rows.length-1,Number((currentText.slice(0,caret).match(/\n/g)||[]).length)))];
				const code=row&&row.querySelector('.sgml-term-text');
				if(code)anchorRect=code.getBoundingClientRect();
			}
			if(anchorRect){
				const width=suggestionMenu.offsetWidth||260;
				const height=Math.min(suggestionMenu.scrollHeight||200,220);
				const left=Math.max(8,Math.min(window.innerWidth-width-8,anchorRect.left));
				const below=anchorRect.bottom+6;
				const top=below+height<=window.innerHeight-8?below:Math.max(8,anchorRect.top-height-6);
				suggestionMenu.style.left=left+'px';
				suggestionMenu.style.top=top+'px';
			}
		}

		function moveTerminalSuggestion(direction){
			if(!suggestionMenu||suggestionMenu.hidden)return false;
			const options=Array.from(suggestionMenu.querySelectorAll('.sgml-term-suggestion'));
			if(!options.length)return false;
			selectedTerminalSuggestion=(selectedTerminalSuggestion+direction+options.length)%options.length;
			options.forEach((option,index)=>option.classList.toggle('is-selected',index===selectedTerminalSuggestion));
			options[selectedTerminalSuggestion].scrollIntoView({block:'nearest'});
			return true;
		}

		if(isCode){
			if(editableSource){
				lines.classList.add('sgml-term-editable');
				lines.setAttribute('contenteditable','true');
				lines.setAttribute('role','textbox');
				lines.setAttribute('aria-multiline','true');
				lines.setAttribute('aria-label',title+' source editor');
				lines.setAttribute('spellcheck','false');
				lines.setAttribute('autocapitalize','off');
				root.dataset.termEditable='true';
				suggestionMenu=document.createElement('div');
				suggestionMenu.className='sgml-term-suggestions';
				suggestionMenu.hidden=true;
				suggestionMenu.setAttribute('role','listbox');
				body.appendChild(suggestionMenu);
				lines.addEventListener('input',()=>{
					const caret=selectionSourceOffsets().focus;
					const nextText=readEditableText();
					if(nextText!==currentText)pushTerminalUndo();
					currentText=nextText;
					const safeCaret=Math.min(caret,currentText.length);
					renderCodeLines(safeCaret);
					updateTerminalSuggestions(false,safeCaret);
				});
				lines.addEventListener('keydown',event=>{
					if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){
						event.preventDefault();
						if(terminalUndo.length){terminalRedo.push(currentText);currentText=terminalUndo.pop();renderCodeLines(Math.min(selectionSourceOffsets().focus,currentText.length));}
						return;
					}
					if((event.ctrlKey||event.metaKey)&&(event.key.toLowerCase()==='y'||(event.shiftKey&&event.key.toLowerCase()==='z'))){
						event.preventDefault();
						if(terminalRedo.length){terminalUndo.push(currentText);currentText=terminalRedo.pop();renderCodeLines(Math.min(selectionSourceOffsets().focus,currentText.length));}
						return;
					}
					if(event.key==='Backspace'||event.key==='Delete'){
						const point=selectionSourceOffsets();
						if(point.start!==point.end){event.preventDefault();replaceEditableRange(point.start,point.end,'',point.start);return;}
						if(event.key==='Backspace'&&point.focus>0&&currentText[point.focus-1]==='\n'){
							event.preventDefault();replaceEditableRange(point.focus-1,point.focus,'',point.focus-1);return;
						}
						if(event.key==='Delete'&&currentText[point.focus]==='\n'){
							event.preventDefault();replaceEditableRange(point.focus,point.focus+1,'',point.focus);return;
						}
					}
					if((event.ctrlKey||event.metaKey)&&event.code==='Space'){
						event.preventDefault();updateTerminalSuggestions(true);return;
					}
					if(suggestionMenu&&!suggestionMenu.hidden){
						if(event.key==='ArrowDown'){event.preventDefault();moveTerminalSuggestion(1);return;}
						if(event.key==='ArrowUp'){event.preventDefault();moveTerminalSuggestion(-1);return;}
						if(event.key==='Escape'){event.preventDefault();closeTerminalSuggestions();return;}
						if(event.key==='Enter'||event.key==='Tab'){
							const item=terminalSuggestions.filter(candidate=>{
								const query=(currentText.slice(0,selectionSourceOffsets().focus).match(/[\w$.-]+$/)||[''])[0].toLowerCase();
								return query?candidate.text.toLowerCase().includes(query):true;
							})[selectedTerminalSuggestion];
							if(item){event.preventDefault();applyTerminalSuggestion(item);return;}
						}
					}
					if(event.key==='Enter'){
						event.preventDefault();const point=selectionSourceOffsets();replaceEditableRange(point.start,point.end,'\n',point.start+1);return;
					}
					if(event.key==='Tab'){
						event.preventDefault();const point=selectionSourceOffsets();replaceEditableRange(point.start,point.end,'    ',point.start+4);return;
					}
				});
				lines.addEventListener('beforeinput',event=>{
					if(event.inputType!=='insertParagraph'&&event.inputType!=='insertLineBreak')return;
					event.preventDefault();const point=selectionSourceOffsets();
					replaceEditableRange(point.start,point.end,'\n',point.start+1);
				});
				lines.addEventListener('cut',event=>{
					const point=selectionSourceOffsets();
					if(point.start===point.end)return;
					if(event.clipboardData)event.clipboardData.setData('text/plain',currentText.slice(point.start,point.end));
					event.preventDefault();replaceEditableRange(point.start,point.end,'',point.start);
				});
				lines.addEventListener('paste',event=>{
					const value=event.clipboardData&&event.clipboardData.getData('text/plain');
					if(value===undefined)return;
					event.preventDefault();const point=selectionSourceOffsets();
					replaceEditableRange(point.start,point.end,value.replace(/\r\n?/g,'\n'),point.start+value.replace(/\r\n?/g,'\n').length);
				});
			}
			renderCodeLines();
			if(editableSource&&suggestionMenu){
				suggestionMenu.addEventListener('keydown',event=>event.stopPropagation());
				suggestionMenu.addEventListener('click',event=>event.stopPropagation());
			}
		}else{
			renderTerminalOutputLines(lines,currentText,rules);
		}

		let activeInput=null;
		let activeInputRequest=null;
		const inputQueue=[];
		const attachActiveInput=()=>{
			if(!activeInput)return;
			const lastLine=lines.lastElementChild;
			const code=lastLine&&lastLine.querySelector('.sgml-term-text');
			if(code&&activeInput.parentNode!==code)code.appendChild(activeInput);
		};
		const scrollToBottom=()=>{body.scrollTop=body.scrollHeight;};
		const updateOutputText=nextText=>{
			const input=activeInput&&activeInput.querySelector('.sgml-term-input');
			const restoreFocus=!!input&&document.activeElement===input;
			const selection=restoreFocus?{start:input.selectionStart,end:input.selectionEnd,direction:input.selectionDirection}:null;
			currentText=String(nextText??'');
			if(!isCode){
				renderTerminalOutputLines(lines,currentText,rules);
				attachActiveInput();
				if(restoreFocus&&input.isConnected){
					input.focus({preventScroll:true});
					try{input.setSelectionRange(selection.start,selection.end,selection.direction||'none');}catch(_error){}
				}
				scrollToBottom();
			}
		};
		const clearInput=()=>{
			if(activeInput)activeInput.remove();
			activeInput=null;
			activeInputRequest=null;
			inputQueue.length=0;
		};
		const showNextInput=()=>{
			if(isCode||activeInputRequest||!inputQueue.length)return null;
			activeInputRequest=inputQueue.shift();
			currentText+=String(activeInputRequest.prompt??'');
			renderTerminalOutputLines(lines,currentText,rules);
			const wrap=document.createElement('span');
			wrap.className='sgml-term-input-wrap';
			const input=document.createElement('input');
			input.type='text';
			input.className='sgml-term-input';
			input.autocomplete='off';
			input.autocapitalize='off';
			input.autocorrect='off';
			input.inputMode='text';
			input.spellcheck=false;
			input.enterKeyHint='send';
			input.setAttribute('aria-label','Terminal input');
			input.setAttribute('placeholder','');
			input.style.width='8ch';
			wrap.appendChild(input);
			activeInput=wrap;
			attachActiveInput();
			const focusInput=()=>{
				if(!input.isConnected)return;
				input.focus({preventScroll:true});
				scrollToBottom();
			};
			input.addEventListener('input',()=>{
				input.style.width=Math.max(8,Math.min(64,input.value.length+1))+'ch';
				input.scrollLeft=input.scrollWidth;
			});
			input.addEventListener('keydown',event=>{
				if(event.key!=='Enter'||event.isComposing)return;
				event.preventDefault();
				const value=input.value;
				const completed=activeInputRequest;
				if(activeInput)activeInput.remove();
				activeInput=null;
				activeInputRequest=null;
				updateOutputText(currentText+value+'\n');
				if(completed&&typeof completed.onSubmit==='function')completed.onSubmit(value);
				showNextInput();
			});
			if(typeof requestAnimationFrame==='function')requestAnimationFrame(focusInput);
			else focusInput();
			return input;
		};
		const requestInput=(prompt,onSubmit)=>{
			if(isCode)return null;
			inputQueue.push({prompt,onSubmit});
			return activeInput||showNextInput();
		};
		root.__sgmlTerminal={block,body,updateText:updateOutputText,getText:()=>currentText,requestInput,clearInput};

		if(isCode&&folding){
			// Fold controls are delegated so the same behavior survives editable
			// rerenders after every keystroke or custom completion insertion.
			lines.addEventListener('click',event=>{
				const control=event.target.closest('.sgml-term-fold,.sgml-term-pill');
				if(!control||!lines.contains(control))return;
				event.preventDefault();event.stopPropagation();
				const line=Number(control.dataset.line||control.closest('.sgml-term-row').querySelector('.sgml-term-fold').dataset.line);
				const anchor=rows[line]&&rows[line].querySelector('.sgml-term-fold')||control;
				const before=anchor.getBoundingClientRect().top;
				if(collapsed.has(line))collapsed.delete(line);else collapsed.add(line);
				applyFoldVisibility();
				const delta=anchor.getBoundingClientRect().top-before;
				if(delta)window.scrollBy(0,delta);
				if(anchor.isConnected&&anchor.focus&&document.activeElement!==anchor)anchor.focus({preventScroll:true});
			});
		}


		root.append(head,body);
		return root;
	}

	const TERMINAL_WORKER_SOURCE=`const __pendingTerminalInputs=new Map();
let __nextTerminalInputId=0;
self.onmessage=async function(event){
	const data=event.data||{};
	if(data.type==='input-result'){
		const pending=__pendingTerminalInputs.get(data.id);
		if(!pending)return;
		__pendingTerminalInputs.delete(data.id);
		if(data.error)pending.reject(new Error(String(data.error)));
		else pending.resolve(String(data.value??''));
		return;
	}
	if(data.type!=='run')return;
	const getCode=String(data.getCode??'');
	const terminalPrint=(...values)=>{
		const text=values.map(value=>{
			if(typeof value==='string')return value;
			if(value===null)return 'null';
			if(value===undefined)return 'undefined';
			if(typeof value==='object'){try{return JSON.stringify(value);}catch(_error){return String(value);}}
			return String(value);
		}).join(' ');
		self.postMessage({type:'print',text});
	};
	const terminalInput=(prompt='')=>{
		if(!data.allowInput)return Promise.reject(new Error('terminalInput() requires allowInput on terminalOutput.'));
		const id=++__nextTerminalInputId;
		return new Promise((resolve,reject)=>{
			__pendingTerminalInputs.set(id,{resolve,reject});
			self.postMessage({type:'input',id,prompt:String(prompt??'')});
		});
	};
	try{
		for(const source of (Array.isArray(data.sources)?data.sources:[])){
			const body=[
				'"use strict";',
				'const terminalPrint=__terminalPrint;',
				'const terminalInput=__terminalInput;',
				'const getCode=__getCode;',
				'return (async function(){',
				String(source),
				'}).call(undefined);'
			].join(String.fromCharCode(10));
			const runner=new Function('__terminalPrint','__terminalInput','__getCode',body);
			await runner(terminalPrint,terminalInput,getCode);
		}
		self.postMessage({type:'done'});
	}catch(error){self.postMessage({type:'error',text:error&&error.stack?error.stack:String(error)});}
};`;

	function appendTerminalMessage(outputRoot,text,isError=false){
		const terminal=outputRoot&&outputRoot.__sgmlTerminal;
		if(!terminal)return;
		const previous=terminal.getText();
		const joiner=isError&&previous&&!previous.endsWith('\n')?'\n':'';
		terminal.updateText(previous+joiner+String(text??''));
	}

	function startTerminalWorker(target,outputRoot,codeText){
		const block=outputRoot.__sgmlTerminal&&outputRoot.__sgmlTerminal.block;
		if(!block||!block.outCodes||!block.outCodes.length)return;
		if(typeof Worker==='undefined'||typeof Blob==='undefined'||!URL.createObjectURL){
			appendTerminalMessage(outputRoot,'[Execution unavailable: Web Workers are not supported.]',true);
			return;
		}
		let url='';
		let worker;
		try{
			url=URL.createObjectURL(new Blob([TERMINAL_WORKER_SOURCE],{type:'text/javascript'}));
			worker=new Worker(url);
		}catch(error){
			if(url)URL.revokeObjectURL(url);
			appendTerminalMessage(outputRoot,'[Could not start isolated execution: '+String(error&&error.message||error)+']',true);
			return;
		}
		const record={worker,url,outputRoot};
		const records=terminalRuns.get(target)||[];
		records.push(record);
		terminalRuns.set(target,records);
		const release=()=>{
			const terminal=outputRoot&&outputRoot.__sgmlTerminal;
			if(terminal&&terminal.clearInput)terminal.clearInput();
			try{worker.terminate();}catch(_error){}
			try{URL.revokeObjectURL(url);}catch(_error){}
			const current=terminalRuns.get(target)||[];
			const remaining=current.filter(item=>item!==record);
			if(remaining.length)terminalRuns.set(target,remaining);else terminalRuns.delete(target);
		};
		worker.addEventListener('message',event=>{
			const message=event.data||{};
			if(message.type==='print')appendTerminalMessage(outputRoot,message.text,false);
			else if(message.type==='input'){
				const terminal=outputRoot.__sgmlTerminal;
				if(!terminal||!terminal.requestInput){
					worker.postMessage({type:'input-result',id:message.id,error:'This terminal cannot receive input.'});
					return;
				}
				terminal.requestInput(message.prompt,value=>{
					try{worker.postMessage({type:'input-result',id:message.id,value});}catch(_error){}
				});
			}else if(message.type==='error'){
				appendTerminalMessage(outputRoot,'[Error] '+message.text,true);
				release();
			}
			// Keep a completed worker alive so timer/event callbacks inside outCode
			// can still print or request input. The visible Stop button owns its lifetime.
			if(message.type==='done')record.finished=true;
		});
		worker.addEventListener('error',event=>{
			appendTerminalMessage(outputRoot,'[Worker error] '+String(event.message||'Execution failed.'),true);
			release();
		});
		worker.postMessage({type:'run',sources:block.outCodes,getCode:codeText,allowInput:isEnabledAttribute(block.attrs&&block.attrs.allowinput)});
	}

	function returnTerminalToCode(target){
		stopTerminalWorkers(target);
		const codeRoot=terminalCodeRoots.get(target);
		if(codeRoot)codeRoot.hidden=false;
		(terminalOutputRoots.get(target)||[]).forEach(outputRoot=>{
			outputRoot.hidden=true;
			const terminal=outputRoot.__sgmlTerminal;
			if(terminal)terminal.updateText(terminal.block.text);
		});
	}

	function runTerminal(target){
		const codeRoot=terminalCodeRoots.get(target);
		if(!codeRoot||!codeRoot.__sgmlTerminal)return;
		const outputs=terminalOutputRoots.get(target)||[];
		if(!outputs.length)return;
		stopTerminalWorkers(target);
		const codeText=typeof codeRoot.__sgmlTerminal.getText==='function'?codeRoot.__sgmlTerminal.getText():codeRoot.__sgmlTerminal.block.text;
		codeRoot.hidden=true;
		outputs.forEach(outputRoot=>{
			const terminal=outputRoot.__sgmlTerminal;
			if(!terminal)return;
			const block=terminal.block;
			let displayText=block.text;
			if(isEnabledAttribute(block.attrs&&block.attrs.addcode)){
				displayText=(codeText?'// Connected source code\n'+codeText+'\n\n':'')+displayText;
			}
			outputRoot.hidden=false;
			terminal.updateText(displayText);
			startTerminalWorker(target,outputRoot,codeText);
		});
	}

	function setupTerminals(root){
		const scope=root&&root.querySelectorAll?root:document;
		const slots=Array.from(scope.querySelectorAll('.sgml-term-slot'));
		if(scope.matches&&scope.matches('.sgml-term-slot'))slots.unshift(scope);
		slots.forEach(slot=>{
			const block=terminalBlocks()[Number(slot.dataset.termIndex)];
			if(!block)return;
			try{slot.replaceWith(buildTerminal(block));}
			catch(error){console.error('SGML terminal render failed:',error);}
		});

		terminalCodeRoots.clear();
		terminalOutputRoots.clear();
		const allTerminals=Array.from(document.querySelectorAll('.sgml-term-code,.sgml-term-output'));
		allTerminals.forEach(element=>{
			if(element.classList.contains('sgml-term-code')){
				const target=element.dataset.termTarget;
				if(target&&!terminalCodeRoots.has(target))terminalCodeRoots.set(target,element);
			}else{
				const hasConnect=element.dataset.termHasConnect==='true';
				const target=element.dataset.termConnect||'';
				if(hasConnect){
					if(!terminalOutputRoots.has(target))terminalOutputRoots.set(target,[]);
					terminalOutputRoots.get(target).push(element);
				}else{
					// An output without connect is visible immediately and its
					// outCode runs as soon as this terminal output is created.
					const block=element.__sgmlTerminal&&element.__sgmlTerminal.block;
					const runKey='__sgml_terminal_output_'+String(block ? block.index : 'unlinked');
					element.hidden=false;
					stopTerminalWorkers(runKey);
					startTerminalWorker(runKey,element,'');
				}
			}
		});

		terminalCodeRoots.forEach((codeRoot,target)=>{
			const run=codeRoot.querySelector('.sgml-term-run');
			if(run&&!run.dataset.bound){
				run.dataset.bound='true';
				run.addEventListener('click',()=>runTerminal(target));
			}
		});
		terminalOutputRoots.forEach((outputs,target)=>outputs.forEach(outputRoot=>{
			const stop=outputRoot.querySelector('.sgml-term-stop');
			if(stop&&!stop.dataset.bound){
				stop.dataset.bound='true';
				stop.addEventListener('click',()=>returnTerminalToCode(target));
			}
		}));
	}

	/* ------------------------------------------------------------------ *
	 * <procedure type="tutorial|wizard|solution"> <step title=""> ...
	 * ------------------------------------------------------------------ */

	const PROCEDURE_ICONS={
		// Open book: a guide you read through.
		tutorial:'<path d="M3.5 5.2c0-.4.3-.7.7-.7 2.8 0 5 .5 7.8 2.2 2.8-1.7 5-2.2 7.8-2.2.4 0 .7.3.7.7v12.3c0 .4-.3.7-.7.7-2.8 0-5 .5-7.8 2.2-2.8-1.7-5-2.2-7.8-2.2-.4 0-.7-.3-.7-.7z"/><path d="M12 6.7v13.3"/>',
		// Magic wand: you are led through one step at a time.
		wizard:'<path d="M4 20 14.5 9.5"/><path d="M13 8l3 3"/><path d="M17 3v3.5M15.25 4.75h3.5"/><path d="M20 10.5V13M18.75 11.75h2.5"/><path d="M8.5 4v2.2M7.4 5.1h2.2"/>',
		// Light bulb: the worked answer.
		solution:'<path d="M9.2 18h5.6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.7 10.7c.6.5 1 1.2 1 2v.3h5.4v-.3c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>'
	};

	const PROCEDURE_TYPES={
		tutorial:{label:'Tutorial',accent:'#2563eb'},
		wizard:{label:'Wizard',accent:'#7c3aed'},
		solution:{label:'Solution',accent:'#0f766e'}
	};

	// Below this many steps the outline buttons are noise, so tutorials skip them.
	const OUTLINE_MIN_STEPS=6;

	function procedureIcon(type){
		return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${PROCEDURE_ICONS[type]}</svg>`;
	}

	function buildProcedureHTML(component){
		const attrs=parseNotebookTagAttributes(component.open);
		const requested=String(textAttr(attrs.type)||'tutorial').trim().toLowerCase();
		const type=PROCEDURE_TYPES[requested]?requested:'tutorial';
		const meta=PROCEDURE_TYPES[type];
		const accent=safeColor(attrs.accent||attrs.color,meta.accent);
		const title=textAttr(attrs.title)||meta.label;
		const startCollapsed=type==='tutorial'&&/^(?:true|yes|all|1)$/i.test(textAttr(attrs.collapsed));

		const extracted=extractChildren(component.content||'','step',true);
		const steps=extracted.children;
		const intro=removeSpans(component.content||'',extracted.spans.map(span=>({...span}))).trim();
		const introHTML=intro?`<div class="sgml-proc-intro">${renderEmbeddedSGML(intro)}</div>`:'';

		const total=steps.length;
		const stepHTML=steps.map((step,index)=>{
			const stepAttrs=parseNotebookTagAttributes(step.open);
			const stepTitle=textAttr(stepAttrs.title)||`Step ${index+1}`;
			return{
				title:stepTitle,
				titleHTML:renderMarkdown(String(stepTitle),{inline:true}),
				body:renderEmbeddedSGML(step.content||'')
			};
		});

		const bar=(now,max,label)=>`<div class="sgml-proc-bar" role="progressbar" aria-label="${label}" aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="${now}"><span style="width:${max?now/max*100:0}%"></span></div>`;

		let inner='';
		if(!total){
			inner='<div class="sgml-notebook-empty">Add &lt;step&gt; elements to build this procedure.</div>';
		}else if(type==='tutorial'){
			// A guide to read through: collapsible steps, an outline to jump around
			// and a progress bar that follows where you are on the page.
			const outlineButton=total>=OUTLINE_MIN_STEPS?'<button type="button" class="sgml-proc-btn sgml-proc-small" data-act="outline" aria-expanded="false">Outline</button>':'';
			inner=`<div class="sgml-proc-toolbar"><div class="sgml-proc-progress">${bar(1,total,'Position in tutorial')}<span class="sgml-proc-count">Step 1 of ${total}</span></div><span class="sgml-proc-actions">${outlineButton}<button type="button" class="sgml-proc-btn sgml-proc-small" data-act="toggle-all">${startCollapsed?'Expand all':'Collapse all'}</button></span></div>`+
				(outlineButton?'<div class="sgml-proc-outline" hidden></div>':'')+
				`<ol class="sgml-proc-steps">`+
				stepHTML.map((step,index)=>`<li class="sgml-proc-step" data-step="${index}"><span class="sgml-proc-num" aria-hidden="true">${index+1}</span><div class="sgml-proc-main"><div class="sgml-proc-step-head"><h4>${step.titleHTML}</h4><button type="button" class="sgml-proc-fold" aria-expanded="true">${CARET_SVG}</button></div><div class="sgml-proc-body">${step.body}</div></div></li>`).join('')+
				'</ol>';
		}else if(type==='wizard'){
			// One step at a time. A progress bar and a scrollable outline replace
			// one-button-per-step, so 100+ steps stay compact. Back/Next are docked
			// under the step so long steps never need a scroll up.
			inner=`<div class="sgml-proc-status">${bar(0,total,'Wizard progress')}<div class="sgml-proc-status-row"><span class="sgml-proc-count" aria-live="polite">Step 1 of ${total}</span><button type="button" class="sgml-proc-btn sgml-proc-small" data-act="outline" aria-expanded="false">Steps</button></div><div class="sgml-proc-outline" hidden></div></div>`+
				`<div class="sgml-proc-panels">`+
				stepHTML.map((step,index)=>`<section class="sgml-proc-panel" data-step="${index}"${index?' hidden':''}><h4>${step.titleHTML}</h4><div class="sgml-proc-body">${step.body}</div></section>`).join('')+
				`<section class="sgml-proc-panel sgml-proc-finished" data-finished hidden><h4>All done</h4><p>You completed all ${total} step${total===1?'':'s'}.</p></section></div>`+
				`<div class="sgml-proc-dock"><button type="button" class="sgml-proc-btn" data-act="back" disabled>Back</button><button type="button" class="sgml-proc-btn sgml-proc-primary" data-act="next">${total===1?'Finish':'Next'}</button></div>`;
		}else{
			// Steps are revealed below the intro; the controls sit under the steps
			// (and stay on screen) so revealing a long step never needs a scroll up.
			inner=`<ol class="sgml-proc-steps">`+
				stepHTML.map((step,index)=>`<li class="sgml-proc-step" data-step="${index}" hidden><span class="sgml-proc-num" aria-hidden="true">${index+1}</span><div class="sgml-proc-main"><div class="sgml-proc-step-head"><h4>${step.titleHTML}</h4></div><div class="sgml-proc-body">${step.body}</div></div></li>`).join('')+
				`</ol><div class="sgml-proc-dock"><span class="sgml-proc-count" aria-live="polite">0 of ${total} steps shown</span><span class="sgml-proc-actions"><button type="button" class="sgml-proc-btn" data-act="reset" hidden>Hide all</button><button type="button" class="sgml-proc-btn" data-act="all">Show all</button><button type="button" class="sgml-proc-btn sgml-proc-primary" data-act="reveal">Show first step</button></span></div>`;
		}

		return `<section class="sgml-procedure sgml-procedure-${type}${startCollapsed?' is-start-collapsed':''}" data-procedure="${type}" data-total="${total}" style="--sgml-proc-accent:${escapeHTMLAttribute(accent)}"><header class="sgml-proc-header"><span class="sgml-proc-kind" role="img" aria-label="${meta.label}" title="${meta.label}">${procedureIcon(type)}</span><h3>${renderMarkdown(String(title),{inline:true})}</h3></header>${introHTML}${inner}</section>`;
	}

	// Scroll a step into view only when it starts off-screen, leaving room for
	// any fixed top bar.
	function bringIntoView(element){
		if(!element||!element.getBoundingClientRect)return;
		const rect=element.getBoundingClientRect();
		if(rect.top<64||rect.top>window.innerHeight*0.8){
			element.scrollIntoView({block:'start',behavior:'smooth'});
		}
	}

	function setupProcedure(section){
		if(section.dataset.bound==='true')return;
		section.dataset.bound='true';
		const type=section.dataset.procedure;
		const total=Number(section.dataset.total)||0;
		if(!total)return;
		// Nested procedures inside a step belong to their own section.
		const own=selector=>Array.from(section.querySelectorAll(selector)).filter(el=>el.closest('.sgml-procedure')===section);
		const count=own('.sgml-proc-count')[0];
		const bar=own('.sgml-proc-bar')[0];
		const fill=bar?bar.firstElementChild:null;
		const outline=own('.sgml-proc-outline')[0];
		const outlineButton=own('[data-act="outline"]')[0];

		const setProgress=(value)=>{
			if(fill)fill.style.width=(value/total*100)+'%';
			if(bar)bar.setAttribute('aria-valuenow',String(value));
		};
		const stepTitle=(element,index)=>{
			const heading=element.querySelector('h4');
			return (heading&&heading.textContent.trim())||`Step ${index+1}`;
		};

		// Scrollable list of every step: a compact stand-in for a row of numbered
		// buttons. Entries are plain text, built once from the rendered headings.
		const buildOutline=(titleSources)=>{
			if(!outline)return[];
			const list=document.createElement('ol');
			const buttons=titleSources.map((element,index)=>{
				const item=document.createElement('li');
				const button=document.createElement('button');
				button.type='button';
				button.dataset.goto=String(index);
				const num=document.createElement('span');
				num.textContent=String(index+1);
				const name=document.createElement('em');
				name.textContent=stepTitle(element,index);
				button.title=name.textContent;
				button.append(num,name);
				item.appendChild(button);
				list.appendChild(item);
				return button;
			});
			outline.appendChild(list);
			return buttons;
		};
		const setOutlineOpen=open=>{
			if(!outline||!outlineButton)return;
			outline.hidden=!open;
			outlineButton.setAttribute('aria-expanded',String(open));
			outlineButton.classList.toggle('is-open',open);
			if(open){
				const current=outline.querySelector('.is-current');
				if(current)outline.scrollTop=Math.max(0,current.offsetTop-outline.clientHeight/2+current.offsetHeight/2);
			}
		};
		if(outline&&outlineButton){
			outlineButton.addEventListener('click',()=>setOutlineOpen(outline.hidden));
			section.addEventListener('keydown',event=>{
				if(event.key==='Escape'&&!outline.hidden){setOutlineOpen(false);outlineButton.focus();}
			});
			document.addEventListener('click',event=>{
				if(!outline.hidden&&!section.contains(event.target))setOutlineOpen(false);
			});
		}

		if(type==='tutorial'){
			const steps=own('.sgml-proc-step');
			const bodies=steps.map(step=>step.querySelector(':scope > .sgml-proc-main > .sgml-proc-body'));
			const folds=steps.map(step=>step.querySelector(':scope > .sgml-proc-main > .sgml-proc-step-head > .sgml-proc-fold'));
			const toggleAll=own('[data-act="toggle-all"]')[0];
			const outlineButtons=buildOutline(steps);
			let active=-1;

			const isCollapsed=index=>bodies[index].hidden;
			const setCollapsed=(index,collapsed)=>{
				bodies[index].hidden=collapsed;
				steps[index].classList.toggle('is-collapsed',collapsed);
				folds[index].setAttribute('aria-expanded',String(!collapsed));
				folds[index].setAttribute('aria-label',(collapsed?'Expand step ':'Collapse step ')+(index+1)+': '+stepTitle(steps[index],index));
			};
			const syncToggleAll=()=>{
				if(toggleAll)toggleAll.textContent=steps.every((_,i)=>isCollapsed(i))?'Expand all':'Collapse all';
			};
			steps.forEach((_,index)=>setCollapsed(index,section.classList.contains('is-start-collapsed')));
			syncToggleAll();

			const setActive=index=>{
				if(index===active)return;
				active=index;
				steps.forEach((step,i)=>step.classList.toggle('is-current',i===index));
				outlineButtons.forEach((button,i)=>button.classList.toggle('is-current',i===index));
				setProgress(index+1);
				if(count)count.textContent=`Step ${index+1} of ${total}`;
			};
			setActive(0);

			// The reading position follows the scroll: it is the topmost step that
			// is still on screen below the top edge, which is also where a jump from
			// the outline lands. Once the last step is fully visible, it is the one.
			let frame=0;
			const measure=()=>{
				frame=0;
				let index=steps.length-1;
				for(let k=0;k<steps.length;k++){
					if(steps[k].getBoundingClientRect().bottom>72){index=k;break;}
				}
				if(steps[steps.length-1].getBoundingClientRect().bottom<=window.innerHeight)index=steps.length-1;
				setActive(index);
			};
			const schedule=()=>{if(!frame)frame=requestAnimationFrame(measure);};
			let listening=false;
			const listen=on=>{
				if(on===listening)return;
				listening=on;
				const method=on?'addEventListener':'removeEventListener';
				window[method]('scroll',schedule,true);
				window[method]('resize',schedule);
				if(on)schedule();
			};
			if('IntersectionObserver' in window){
				new IntersectionObserver(entries=>listen(entries[entries.length-1].isIntersecting)).observe(section);
			}else listen(true);

			section.addEventListener('click',event=>{
				const target=event.target;
				if(!target.closest)return;
				const button=target.closest('button');
				const head=target.closest('.sgml-proc-step-head');
				if(head&&head.closest('.sgml-procedure')===section&&!target.closest('a')){
					const step=head.closest('.sgml-proc-step');
					const index=steps.indexOf(step);
					if(index>=0){
						const anchor=head;
						const before=anchor.getBoundingClientRect().top;
						setCollapsed(index,!isCollapsed(index));
						syncToggleAll();
						const delta=anchor.getBoundingClientRect().top-before;
						if(delta)window.scrollBy(0,delta);
					}
					return;
				}
				if(!button||button.closest('.sgml-procedure')!==section)return;
				if(button===toggleAll){
					const collapse=toggleAll.textContent==='Collapse all';
					steps.forEach((_,index)=>setCollapsed(index,collapse));
					syncToggleAll();
				}else if(button.dataset.goto!==undefined){
					const index=Number(button.dataset.goto);
					setCollapsed(index,false);
					syncToggleAll();
					setOutlineOpen(false);
					setActive(index);
					steps[index].scrollIntoView({block:'start',behavior:'smooth'});
				}
			});
		}else if(type==='wizard'){
			const panels=own('.sgml-proc-panel[data-step]');
			const finished=own('[data-finished]')[0];
			const back=own('[data-act="back"]')[0];
			const next=own('[data-act="next"]')[0];
			const outlineButtons=buildOutline(panels);
			let current=0;
			let reached=0;
			const show=index=>{
				current=Math.max(0,Math.min(total,index));
				reached=Math.max(reached,Math.min(current,total-1));
				panels.forEach((panel,i)=>{panel.hidden=i!==current;});
				finished.hidden=current!==total;
				outlineButtons.forEach((button,i)=>{
					button.classList.toggle('is-current',i===current);
					button.classList.toggle('is-complete',i<current);
					button.disabled=i>reached;
					if(i===current)button.setAttribute('aria-current','step');else button.removeAttribute('aria-current');
				});
				back.disabled=current===0;
				back.textContent=current===total?'Start over':'Back';
				next.hidden=current===total;
				next.textContent=current===total-1?'Finish':'Next';
				setProgress(current);
				if(count)count.textContent=current===total?'Complete':`Step ${current+1} of ${total}`;
			};
			section.addEventListener('click',event=>{
				const el=event.target.closest&&event.target.closest('button');
				if(!el||el.closest('.sgml-procedure')!==section)return;
				if(el.dataset.goto!==undefined){show(Number(el.dataset.goto));setOutlineOpen(false);}
				else if(el===next)show(current+1);
				else if(el===back)show(current===total?0:current-1);
				else return;
				bringIntoView(current===total?finished:panels[current]);
			});
			show(0);
		}else if(type==='solution'){
			const steps=own('.sgml-proc-step');
			const reveal=own('[data-act="reveal"]')[0];
			const all=own('[data-act="all"]')[0];
			const reset=own('[data-act="reset"]')[0];
			let shown=0;
			const update=()=>{
				steps.forEach((step,i)=>{step.hidden=i>=shown;});
				if(count)count.textContent=`${shown} of ${total} steps shown`;
				reveal.hidden=shown>=total;
				all.hidden=shown>=total;
				reset.hidden=shown===0;
				reveal.textContent=shown===0?'Show first step':`Show step ${shown+1}`;
			};
			section.addEventListener('click',event=>{
				const el=event.target.closest&&event.target.closest('button[data-act]');
				if(!el||el.closest('.sgml-procedure')!==section)return;
				if(el===reveal)shown=Math.min(total,shown+1);
				else if(el===all)shown=total;
				else if(el===reset)shown=0;
				else return;
				update();
				if(el===reveal&&steps[shown-1])steps[shown-1].scrollIntoView({block:'nearest',behavior:'smooth'});
			});
			update();
		}
	}

	function setupProcedures(root){
		const scope=root&&root.querySelectorAll?root:document;
		const sections=Array.from(scope.querySelectorAll('.sgml-procedure'));
		if(scope.matches&&scope.matches('.sgml-procedure'))sections.unshift(scope);
		sections.forEach(setupProcedure);
	}

	/* ------------------------------------------------------------------ *
	 * Pipeline entry points
	 * ------------------------------------------------------------------ */

	function resetSGMLExtensionState(){
		stopAllTerminalWorkers();
		terminalCodeRoots.clear();
		terminalOutputRoots.clear();
		copyStore=new Map();
		window.__sgmlTerminalBlocks=[];
	}

	// Order matters: copies and terminal bodies are removed before <js> runs,
	// and again afterwards for anything a <js> block returned.
	function preprocessSGMLExtensions(source,expandJS){
		let text=String(source||'');
		text=expandCopyPaste(text,0,[]);
		text=extractTerminals(text);
		text=expandJS(text);
		text=expandCopyPaste(text,0,[]);
		text=extractTerminals(text);
		return text;
	}

	window.preprocessSGMLExtensions=preprocessSGMLExtensions;
	window.resetSGMLExtensionState=resetSGMLExtensionState;
	window.buildProcedureHTML=buildProcedureHTML;
	window.setupProcedures=setupProcedures;
	window.setupTerminals=setupTerminals;
	window.SGMLExtensions={parseTerminalStyle,parseTerminalSuggestions,highlightSpans,parseTerminalFolding,parseCollapsedSpec,initialCollapsedLines,computeFolds,maskNonCode,findExtensionTags};
})();
