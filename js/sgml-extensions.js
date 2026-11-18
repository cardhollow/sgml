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

	const EXT_TAGS=['sgmlCopy','sgmlPaste','terminalCode','terminalOutput'];
	const EXT_TAG_PATTERN=/<(sgmlCopy|sgmlPaste|terminalCode|terminalOutput)(?=[\s/>])/iy;
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
				if(name==='sgmlCopy'){
					const token=/<(\/?)sgmlCopy(?=[\s/>])[^>]*>/gi;
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
		return parseNotebookTagAttributes(String(openTag||'').replace(/\/\s*>$/,'>'));
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

			const name=String(textAttr(parseAttrs(tag.open).name)).trim();
			if(!name){out+=missingPaste('','missing name attribute');return;}
			if(!copyStore.has(name)){out+=missingPaste(name,'no sgmlCopy with that name');return;}
			if(stack.includes(name)||depth>=MAX_PASTE_DEPTH){out+=missingPaste(name,'circular paste');return;}
			out+=expandCopyPaste(copyStore.get(name),depth+1,stack.concat(name));
		});
		return out+source.slice(cursor);
	}

	/* ------------------------------------------------------------------ *
	 * <terminalCode> / <terminalOutput>
	 * ------------------------------------------------------------------ */

	function terminalBlocks(){
		window.__sgmlTerminalBlocks=window.__sgmlTerminalBlocks||[];
		return window.__sgmlTerminalBlocks;
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
			store.push({kind:tag.name==='terminalCode'?'code':'output',attrs:parseAttrs(tag.open),text:dedent(tag.content)});
			out+=`\n\n<div class="sgml-term-slot" data-term-index="${index}"></div>\n\n`;
		});
		return out+source.slice(cursor);
	}

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

	function buildTerminal(block){
		const isCode=block.kind==='code';
		const attrs=block.attrs||{};
		const text=block.text;
		const title=textAttr(attrs.title)||(isCode?'Code':'Output');
		const accent=safeColor(attrs.accent,isCode?'#60a5fa':'#94a3b8');
		const rules=parseTerminalStyle(textAttr(attrs.style));
		const folding=isCode?parseTerminalFolding(attrs.folding):null;
		const folds=folding?computeFolds(text,folding):{};
		const foldStarts=Object.keys(folds).map(Number);

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
		const copy=document.createElement('button');
		copy.type='button';
		copy.className='sgml-term-copy';
		copy.textContent='Copy';
		copy.setAttribute('aria-label','Copy '+title+' to clipboard');
		let resetTimer=0;
		copy.addEventListener('click',()=>{
			copyText(text).then(()=>{copy.textContent='Copied';copy.classList.add('is-done');},()=>{copy.textContent='Copy failed';copy.classList.add('is-error');})
				.finally(()=>{clearTimeout(resetTimer);resetTimer=setTimeout(()=>{copy.textContent='Copy';copy.classList.remove('is-done','is-error');},1600);});
		});
		head.append(dots,label,copy);

		const body=document.createElement('div');
		body.className='sgml-term-body';
		body.tabIndex=0;
		body.setAttribute('role','region');
		body.setAttribute('aria-label',title);
		const lines=document.createElement('div');
		lines.className='sgml-term-lines';
		body.appendChild(lines);

		// Highlight spans over the whole text, then clip them to each line.
		const spans=rules.length?highlightSpans(text,rules):[];
		const textLines=text.split('\n');
		const numberWidth=String(textLines.length).length;
		const rows=[];
		let offset=0;
		let spanIndex=0;

		textLines.forEach((lineText,lineIndex)=>{
			const lineStart=offset,lineEnd=offset+lineText.length;
			offset=lineEnd+1;

			const row=document.createElement('div');
			row.className='sgml-term-row';
			if(isCode){
				const gutter=document.createElement('span');
				gutter.className='sgml-term-gutter';
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
			}

			const code=document.createElement('code');
			code.className='sgml-term-text';
			let cursor=lineStart;
			while(spanIndex<spans.length&&spans[spanIndex].end<=lineStart)spanIndex++;
			for(let k=spanIndex;k<spans.length&&spans[k].start<lineEnd;k++){
				const s=Math.max(spans[k].start,lineStart),e=Math.min(spans[k].end,lineEnd);
				if(e<=s)continue;
				if(s>cursor)code.appendChild(document.createTextNode(text.slice(cursor,s)));
				const piece=document.createElement('span');
				piece.style.color=spans[k].color;
				piece.textContent=text.slice(s,e);
				code.appendChild(piece);
				cursor=e;
			}
			if(cursor<lineEnd)code.appendChild(document.createTextNode(text.slice(cursor,lineEnd)));
			if(!lineText.length)code.appendChild(document.createTextNode('​'));
			row.appendChild(code);

			if(folds[lineIndex]){
				const pill=document.createElement('button');
				pill.type='button';
				pill.className='sgml-term-pill';
				pill.dataset.line=String(lineIndex);
				const hiddenCount=folds[lineIndex].end-lineIndex-1;
					pill.textContent='⋯ '+hiddenCount+(hiddenCount===1?' line':' lines');
				pill.setAttribute('aria-label','Unfold '+hiddenCount+(hiddenCount===1?' line':' lines'));
				row.appendChild(pill);
			}

			lines.appendChild(row);
			rows.push(row);
		});

		if(foldStarts.length){
			const collapsed=initialCollapsedLines(folds,textLines,folding&&folding.collapsed);
			const apply=()=>{
				const hidden=new Array(rows.length).fill(false);
				collapsed.forEach(start=>{for(let k=start+1;k<folds[start].end;k++)hidden[k]=true;});
				rows.forEach((row,index)=>{
					row.hidden=hidden[index];
					const folded=collapsed.has(index)&&!hidden[index];
					row.classList.toggle('is-folded',folded);
					const caret=row.querySelector('.sgml-term-fold');
					if(caret)caret.setAttribute('aria-expanded',collapsed.has(index)?'false':'true');
				});
			};
			apply();
			// Toggling must not move what the reader is looking at: keep the
			// clicked row at the same viewport position after the layout changes.
			const toggle=(line,anchor)=>{
				const before=anchor.getBoundingClientRect().top;
				if(collapsed.has(line))collapsed.delete(line);else collapsed.add(line);
				apply();
				const delta=anchor.getBoundingClientRect().top-before;
				if(delta)window.scrollBy(0,delta);
				if(anchor.isConnected&&anchor.focus&&document.activeElement!==anchor)anchor.focus({preventScroll:true});
			};
			lines.addEventListener('click',event=>{
				const control=event.target.closest('.sgml-term-fold,.sgml-term-pill');
				if(!control||!lines.contains(control))return;
				event.preventDefault();
				const line=Number(control.dataset.line||control.closest('.sgml-term-row').querySelector('.sgml-term-fold').dataset.line);
				const caret=rows[line].querySelector('.sgml-term-fold');
				toggle(line,caret||control);
			});
		}

		root.append(head,body);
		return root;
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
	window.SGMLExtensions={parseTerminalStyle,highlightSpans,parseTerminalFolding,parseCollapsedSpec,initialCollapsedLines,computeFolds,maskNonCode,findExtensionTags};
})();
