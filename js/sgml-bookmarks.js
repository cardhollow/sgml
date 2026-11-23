/*
 * SGML bookmarks and the custom selection menu.
 *
 *  - <bookmark .../> anchors (rendered by sgml-renderer.js) become fixed side
 *    tabs. A tab peeks in from the screen edge; pressing it opens
 *    [Icon][title / subtitle][X]; pressing the card scrolls to the anchor.
 *  - The native context menu inside #sgml-output is replaced by a small menu:
 *    Copy, Select all, a divider, Bookmark.
 *  - Bookmarks created from that menu are stored in localStorage under
 *    "sgmlBookmarks". Only created bookmarks are stored. Removing a bookmark
 *    that came from SGML source only removes it from the screen: it is never
 *    recorded as removed, so it returns on reload.
 */
(function(){
	'use strict';

	const STORAGE_KEY='sgmlBookmarks';
	const OUTPUT_ID='sgml-output';
	const MENU_ID='sgml-context-menu';
	const CHEVRON_RIGHT_SIDE='<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
	const CHEVRON_LEFT_SIDE='<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
	const DEFAULT_ACCENT='#2563eb';
	const ACCENT_PALETTE=['#2563eb','#c62828','#15803d','#b45309','#7c3aed','#0f766e','#be185d','#0369a1','#a21caf','#4d7c0f','#ea580c','#475569'];
	function randomAccent(){return ACCENT_PALETTE[Math.floor(Math.random()*ACCENT_PALETTE.length)];}

	let openItem=null;
	let eventsBound=false;
	let menuState=null;

	/* ---------------------------------------------------------------- *
	 * Storage
	 * ---------------------------------------------------------------- */

	function readStore(){
		try{
			const raw=localStorage.getItem(STORAGE_KEY);
			const list=raw?JSON.parse(raw):[];
			return Array.isArray(list)?list.filter(item=>item&&typeof item==='object'&&item.id):[];
		}catch(_){return [];}
	}

	function writeStore(list){
		try{localStorage.setItem(STORAGE_KEY,JSON.stringify(list));return true;}
		catch(_){return false;}
	}

	function documentKey(){
		try{
			if(typeof currentDocumentId!=='undefined'&&currentDocumentId)return String(currentDocumentId);
		}catch(_){}
		return 'default';
	}

	function newId(){
		return 'u'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
	}

	/* ---------------------------------------------------------------- *
	 * Text anchoring (used to re-place saved bookmarks after a render)
	 * ---------------------------------------------------------------- */

	function getOutput(){return document.getElementById(OUTPUT_ID);}

	function collapseWS(text){return String(text||'').replace(/\s+/g,' ');}

	// Whitespace-collapsed text of the output with a map back to DOM positions.
	function buildTextMap(root){
		const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{
			acceptNode(node){
				const parent=node.parentElement;
				if(!parent)return NodeFilter.FILTER_REJECT;
				if(parent.closest('script,style,template,.sgml-bookmark-anchor,.sgml-bm-dock'))return NodeFilter.FILTER_REJECT;
				return NodeFilter.FILTER_ACCEPT;
			}
		});
		let text='';
		const map=[];
		let prevSpace=false;
		let node;
		while((node=walker.nextNode())){
			const value=node.nodeValue;
			for(let i=0;i<value.length;i++){
				const isSpace=/\s/.test(value[i]);
				if(isSpace){
					if(prevSpace)continue;
					text+=' ';
					prevSpace=true;
				}else{
					text+=value[i];
					prevSpace=false;
				}
				map.push({node,offset:i});
			}
		}
		return{text,map};
	}

	function topLevelIndex(root,node){
		let cur=node.nodeType===1?node:node.parentElement;
		while(cur&&cur.parentElement!==root)cur=cur.parentElement;
		if(!cur)return -1;
		return [...root.children].filter(el=>!el.classList.contains('sgml-bookmark-anchor')).indexOf(cur);
	}

	function describeRange(range){
		const root=getOutput();
		if(!root)return null;
		const selected=collapseWS(range.toString()).trim();
		const pre=document.createRange();
		pre.selectNodeContents(root);
		try{pre.setEnd(range.startContainer,range.startOffset);}catch(_){return null;}
		const before=collapseWS(pre.toString());
		return{
			text:selected.slice(0,200),
			prefix:before.slice(-40),
			block:topLevelIndex(root,range.startContainer)
		};
	}

	function nearestHeadingText(range){
		const root=getOutput();
		if(!root)return '';
		let found='';
		root.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(heading=>{
			if(heading.compareDocumentPosition(range.startContainer)&Node.DOCUMENT_POSITION_FOLLOWING||heading.contains(range.startContainer)){
				found=collapseWS(heading.textContent).trim();
			}
		});
		return found.slice(0,80);
	}

	const BLOCK_SELECTOR='p,li,h1,h2,h3,h4,h5,h6,pre,blockquote,td,th,dt,dd,figure,table,ul,ol,aside,section';

	function makeAnchorFor(entry,root){
		const anchor=document.createElement('div');
		anchor.className='sgml-bookmark-anchor';
		anchor.id='sgml-bookmark-'+entry.id;
		anchor.dataset.sgmlBookmark='true';
		anchor.dataset.saved='true';
		anchor.dataset.title=entry.title||'Bookmark';
		anchor.dataset.subtitle=entry.subtitle||'';
		anchor.dataset.accent=entry.accent||DEFAULT_ACCENT;
		anchor.dataset.side=entry.side==='left'?'left':'right';
		anchor.dataset.userdefined='true';
		anchor.dataset.icon=entry.icon||'bookmark';
		anchor.dataset.entryId=entry.id;
		const tpl=document.createElement('template');
		tpl.className='sgml-bookmark-icon-src';
		tpl.innerHTML=buildIconHTML(entry.icon,anchor.dataset.accent);
		anchor.appendChild(tpl);
		return anchor;
	}

	function placeAnchor(entry,root){
		const target=entry.anchor||{};
		const{text,map}=buildTextMap(root);
		let startNode=null;
		if(target.text){
			const candidates=[
				(target.prefix||'')+target.text,
				String(target.prefix||'').replace(/\s+$/,'')+' '+target.text,
				target.text
			];
			for(const candidate of candidates){
				const at=text.indexOf(candidate);
				if(at<0)continue;
				const skip=candidate.length-target.text.length;
				const entryAt=map[Math.min(map.length-1,at+skip)];
				if(entryAt){startNode=entryAt.node;break;}
			}
		}
		let blockEl=null;
		if(startNode){
			blockEl=startNode.parentElement&&startNode.parentElement.closest(BLOCK_SELECTOR);
			if(blockEl&&!root.contains(blockEl))blockEl=null;
		}
		if(!blockEl&&Number.isInteger(target.block)&&target.block>=0){
			const kids=[...root.children].filter(el=>!el.classList.contains('sgml-bookmark-anchor'));
			blockEl=kids[target.block]||null;
		}
		if(!blockEl)return null;
		const anchor=makeAnchorFor(entry,root);
		// The anchor sits after the bookmarked text (v13.2); it used to sit above it.
		if(/^(LI|TD|TH|DT|DD)$/.test(blockEl.tagName))blockEl.append(anchor);
		else blockEl.after(anchor);
		return anchor;
	}

	/* ---------------------------------------------------------------- *
	 * Dock (the fixed side tabs)
	 * ---------------------------------------------------------------- */

	function buildIconHTML(name,accent){
		const key=String(name||'').trim().toLowerCase()||'bookmark';
		if(/^<svg\b/i.test(String(name||'')))return String(name);
		const known=window.SGMLICON&&window.SGMLICON[key]?key:'bookmark';
		return typeof window.renderSGMLIcon==='function'
			?window.renderSGMLIcon(known,`scale:[18] color:"${accent}"`)
			:'';
	}

	function getDock(side){
		let dock=document.querySelector(`.sgml-bm-dock[data-side="${side}"]`);
		if(!dock){
			dock=document.createElement('div');
			dock.className='sgml-bm-dock';
			dock.dataset.side=side;
			dock.setAttribute('role','navigation');
			dock.setAttribute('aria-label','Bookmarks');
			document.body.appendChild(dock);
		}
		return dock;
	}

	let zTop=900;

	function bringToFront(item){item.style.zIndex=String(++zTop);}

	function setSide(item,side){
		item.classList.toggle('sgml-bm-left',side==='left');
		item.classList.toggle('sgml-bm-right',side==='right');
		item.dataset.side=side;
		const peek=item.querySelector('.sgml-bm-peek');
		if(peek)peek.innerHTML=side==='right'?CHEVRON_RIGHT_SIDE:CHEVRON_LEFT_SIDE;
	}

	// Move an item out of its dock so it can sit anywhere on screen.
	function makeFree(item){
		if(item.classList.contains('is-free'))return;
		const rect=item.getBoundingClientRect();
		document.body.appendChild(item);
		item.classList.add('is-free');
		item.style.top=rect.top+'px';
		item.style.left=rect.left+'px';
		item.style.right='auto';
		document.querySelectorAll('.sgml-bm-dock').forEach(dock=>{dock.hidden=!dock.children.length;});
	}

	function clampTop(item,top){
		const height=item.offsetHeight||44;
		return Math.max(4,Math.min(top,window.innerHeight-height-4));
	}

	function savedEntryIdFor(item){
		const anchor=document.getElementById(item.dataset.anchorId||'');
		return anchor&&anchor.dataset.entryId||'';
	}

	// Only bookmarks created by the user are stored, so only their position is
	// remembered. Positions of source-authored bookmarks reset on render.
	function persistPosition(item){
		const entryId=savedEntryIdFor(item);
		if(!entryId)return;
		const list=readStore();
		const entry=list.find(candidate=>candidate.id===entryId);
		if(!entry)return;
		entry.pos={side:item.dataset.side==='left'?'left':'right',top:Math.round(parseFloat(item.style.top)||0)/Math.max(1,window.innerHeight)};
		entry.side=entry.pos.side;
		writeStore(list);
	}

	// A dragged bookmark docks to the nearest side edge when it is closed,
	// keeping the height where it was dropped.
	function snapToEdge(item){
		if(!item.classList.contains('is-free'))return;
		const rect=item.getBoundingClientRect();
		const side=rect.left+rect.width/2<window.innerWidth/2?'left':'right';
		setSide(item,side);
		item.style.top=clampTop(item,rect.top)+'px';
		item.style.left=side==='left'?'0px':'auto';
		item.style.right=side==='right'?'0px':'auto';
		persistPosition(item);
	}

	function closeOpenItem(){
		if(!openItem)return;
		snapToEdge(openItem);
		openItem.classList.remove('is-open');
		const peek=openItem.querySelector('.sgml-bm-peek');
		if(peek)peek.setAttribute('aria-expanded','false');
		openItem=null;
	}

	function openBookmarkItem(item){
		if(openItem===item)return;
		closeOpenItem();
		item.classList.add('is-open');
		bringToFront(item);
		const peek=item.querySelector('.sgml-bm-peek');
		if(peek)peek.setAttribute('aria-expanded','true');
		openItem=item;
		const go=item.querySelector('.sgml-bm-go');
		if(go)go.focus({preventScroll:true});
	}

	function flashAnchor(anchor){
		anchor.style.setProperty('--bm-flash',anchor.dataset.accent||DEFAULT_ACCENT);
		anchor.classList.remove('sgml-bookmark-flash');
		void anchor.offsetWidth;
		anchor.classList.add('sgml-bookmark-flash');
		setTimeout(()=>anchor.classList.remove('sgml-bookmark-flash'),1800);
	}

	function goToAnchor(anchor){
		if(!anchor||!anchor.isConnected)return;
		anchor.scrollIntoView({behavior:'smooth',block:'center'});
		flashAnchor(anchor);
	}

	function removeBookmark(item,anchor){
		const entryId=anchor&&anchor.dataset.entryId;
		// Saved bookmarks leave localStorage. Bookmarks that exist only in the
		// SGML source have nothing stored, so only the UI changes and they
		// reappear on the next render.
		if(entryId){
			const list=readStore();
			const next=list.filter(entry=>entry.id!==entryId);
			if(next.length!==list.length)writeStore(next);
			if(anchor&&anchor.isConnected)anchor.remove();
		}
		if(openItem===item)openItem=null;
		item.remove();
	}

	async function confirmRemove(item,anchor){
		const title=(anchor&&anchor.dataset.title)||'Bookmark';
		let ok=true;
		if(typeof confirmDialog==='function'){
			ok=await confirmDialog(`Remove the bookmark "${title}"?`,'Remove bookmark','Remove');
		}
		if(ok)removeBookmark(item,anchor);
	}

	/* ---------------------------------------------------------------- *
	 * Editing a bookmark (title, subtitle, accent)
	 * ---------------------------------------------------------------- */

	let editorEl=null;

	function closeEditor(){
		if(editorEl){editorEl.remove();editorEl=null;}
	}

	function recolorIcon(html,from,to){
		if(!from||!to||from.toLowerCase()===to.toLowerCase())return html;
		return String(html).split(from).join(to).split(from.toUpperCase()).join(to);
	}

	function applyBookmarkEdit(item,anchor,values){
		const oldAccent=anchor.dataset.accent||DEFAULT_ACCENT;
		anchor.dataset.title=values.title;
		anchor.dataset.subtitle=values.subtitle;
		anchor.dataset.accent=values.accent;
		const oldIcon=anchor.dataset.icon||'';
		const iconChanged=!!values.icon&&values.icon!==oldIcon;
		if(values.icon)anchor.dataset.icon=values.icon;
		const tpl=anchor.querySelector('template.sgml-bookmark-icon-src');
		if(tpl)tpl.innerHTML=iconChanged?buildIconHTML(values.icon,values.accent):recolorIcon(tpl.innerHTML,oldAccent,values.accent);
		item.style.setProperty('--bm-accent',values.accent);
		const icon=item.querySelector('.sgml-bm-icon');
		if(icon)icon.innerHTML=iconChanged?buildIconHTML(values.icon,values.accent):recolorIcon(icon.innerHTML,oldAccent,values.accent);
		const titleEl=item.querySelector('.sgml-bm-title');
		if(titleEl)titleEl.textContent=values.title;
		const text=item.querySelector('.sgml-bm-text');
		let sub=item.querySelector('.sgml-bm-subtitle');
		if(values.subtitle){
			if(!sub){sub=document.createElement('span');sub.className='sgml-bm-subtitle';text.appendChild(sub);}
			sub.textContent=values.subtitle;
		}else if(sub)sub.remove();
		const peek=item.querySelector('.sgml-bm-peek');
		if(peek){peek.title=values.title;peek.setAttribute('aria-label','Show bookmark: '+values.title);}
		const go=item.querySelector('.sgml-bm-go');
		if(go)go.setAttribute('aria-label','Go to bookmark: '+values.title);
		// Only created bookmarks are stored; edits to source bookmarks last
		// until the next render.
		const entryId=anchor.dataset.entryId;
		if(entryId){
			const list=readStore();
			const entry=list.find(candidate=>candidate.id===entryId);
			if(entry){
				entry.title=values.title;
				entry.subtitle=values.subtitle;
				entry.accent=values.accent;
				if(values.icon)entry.icon=values.icon;
				writeStore(list);
			}
		}
	}

	function openEditor(item){
		const anchor=document.getElementById(item.dataset.anchorId||'');
		if(!anchor)return;
		closeEditor();
		if(openItem!==item)openBookmarkItem(item);
		const rect=item.getBoundingClientRect();
		const accent=/^#[0-9a-f]{6}$/i.test(anchor.dataset.accent||'')?anchor.dataset.accent:DEFAULT_ACCENT;

		const box=document.createElement('form');
		box.className='sgml-bm-editor';
		box.setAttribute('role','dialog');
		box.setAttribute('aria-label','Edit bookmark');
		box.innerHTML=
			'<label>Title<input type="text" name="title" maxlength="120" autocomplete="off"></label>'+
			'<label>Subtitle<input type="text" name="subtitle" maxlength="160" autocomplete="off"></label>'+
			'<div class="sgml-bm-editor-row">'+
			'<label class="sgml-bm-editor-color">Accent color<input type="color" name="accent"></label>'+
			'<label class="sgml-bm-editor-icon">Icon<span class="sgml-bm-editor-icon-wrap"><span class="sgml-bm-editor-icon-preview" aria-hidden="true"></span><select name="icon"></select></span></label>'+
			'</div>'+
			'<div class="sgml-bm-editor-actions"><button type="button" data-act="cancel">Cancel</button><button type="submit" class="btn-submit">Save</button></div>';
		box.elements.title.value=anchor.dataset.title||'';
		box.elements.subtitle.value=anchor.dataset.subtitle||'';
		box.elements.accent.value=accent;
		const iconSelect=box.elements.icon;
		const currentIcon=String(anchor.dataset.icon||'').toLowerCase();
		const iconNames=Object.keys(window.SGMLICON||{}).sort((a,b)=>a.localeCompare(b));
		if(!currentIcon||!iconNames.includes(currentIcon)){
			const keep=document.createElement('option');
			keep.value='';
			keep.textContent='Custom (keep)';
			iconSelect.appendChild(keep);
		}
		iconNames.forEach(name=>{
			const option=document.createElement('option');
			option.value=name;
			option.textContent=name;
			iconSelect.appendChild(option);
		});
		iconSelect.value=iconNames.includes(currentIcon)?currentIcon:'';
		const preview=box.querySelector('.sgml-bm-editor-icon-preview');
		const refreshPreview=()=>{
			const tpl=anchor.querySelector('template.sgml-bookmark-icon-src');
			const chosen=iconSelect.value;
			preview.innerHTML=chosen?buildIconHTML(chosen,box.elements.accent.value||accent):(tpl?tpl.innerHTML:'');
		};
		iconSelect.addEventListener('change',refreshPreview);
		box.elements.accent.addEventListener('input',refreshPreview);
		refreshPreview();
		box.style.setProperty('--bm-accent',accent);
		box.style.zIndex=String(++zTop+1);
		box.addEventListener('submit',event=>{
			event.preventDefault();
			applyBookmarkEdit(item,anchor,{
				title:box.elements.title.value.trim()||'Bookmark',
				subtitle:box.elements.subtitle.value.trim(),
				accent:box.elements.accent.value||accent,
				icon:box.elements.icon.value
			});
			closeEditor();
		});
		box.querySelector('[data-act="cancel"]').addEventListener('click',closeEditor);
		box.addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();closeEditor();}});
		document.body.appendChild(box);

		// Appear where the bookmark is: beside the card, on the side facing the page.
		const width=box.offsetWidth;
		const height=box.offsetHeight;
		const onLeft=item.classList.contains('sgml-bm-left');
		let left=onLeft?rect.right+8:rect.left-width-8;
		left=Math.max(8,Math.min(left,window.innerWidth-width-8));
		const top=Math.max(8,Math.min(rect.top,window.innerHeight-height-8));
		box.style.left=left+'px';
		box.style.top=top+'px';
		editorEl=box;
		box.elements.title.focus();
		box.elements.title.select();
	}

	// Right-click and touch long-press both open the editor.
	function attachEditTriggers(el,item){
		let timer=null;
		let startX=0,startY=0;
		const cancel=()=>{if(timer){clearTimeout(timer);timer=null;}};
		el.addEventListener('contextmenu',event=>{
			event.preventDefault();
			event.stopPropagation();
			cancel();
			openEditor(item);
		});
		el.addEventListener('pointerdown',event=>{
			if(event.pointerType!=='touch')return;
			if(event.target.closest&&event.target.closest('.sgml-bm-x'))return;
			startX=event.clientX;startY=event.clientY;
			cancel();
			timer=setTimeout(()=>{
				timer=null;
				item.dataset.longPressed='1';
				setTimeout(()=>{delete item.dataset.longPressed;},400);
				openEditor(item);
			},550);
		});
		el.addEventListener('pointermove',event=>{
			if(timer&&Math.hypot(event.clientX-startX,event.clientY-startY)>8)cancel();
		});
		['pointerup','pointercancel','pointerleave'].forEach(name=>el.addEventListener(name,cancel));
		el.addEventListener('click',event=>{
			if(item.dataset.longPressed){event.stopPropagation();event.preventDefault();}
		},true);
	}

	function buildItem(anchor){
		const side=anchor.dataset.side==='left'?'left':'right';
		const accent=anchor.dataset.accent||DEFAULT_ACCENT;
		const title=anchor.dataset.title||'Bookmark';
		const subtitle=anchor.dataset.subtitle||'';
		const removable=anchor.dataset.userdefined==='true';
		const tpl=anchor.querySelector('template.sgml-bookmark-icon-src');
		const iconHTML=tpl?tpl.innerHTML:buildIconHTML('',accent);

		const item=document.createElement('div');
		item.className='sgml-bm sgml-bm-'+side;
		item.style.setProperty('--bm-accent',accent);
		item.dataset.anchorId=anchor.id;

		const peek=document.createElement('button');
		peek.type='button';
		peek.className='sgml-bm-peek';
		peek.setAttribute('aria-expanded','false');
		peek.setAttribute('aria-label','Show bookmark: '+title);
		peek.title=title;
		peek.innerHTML=side==='right'?CHEVRON_RIGHT_SIDE:CHEVRON_LEFT_SIDE;
		peek.addEventListener('click',event=>{
			event.stopPropagation();
			openBookmarkItem(item);
		});

		const card=document.createElement('div');
		card.className='sgml-bm-card';

		const go=document.createElement('button');
		go.type='button';
		go.className='sgml-bm-go';
		go.setAttribute('aria-label','Go to bookmark: '+title);
		const icon=document.createElement('span');
		icon.className='sgml-bm-icon';
		icon.innerHTML=iconHTML;
		const text=document.createElement('span');
		text.className='sgml-bm-text';
		const titleEl=document.createElement('span');
		titleEl.className='sgml-bm-title';
		titleEl.textContent=title;
		text.appendChild(titleEl);
		if(subtitle){
			const sub=document.createElement('span');
			sub.className='sgml-bm-subtitle';
			sub.textContent=subtitle;
			text.appendChild(sub);
		}
		go.append(icon,text);
		go.addEventListener('click',event=>{
			event.stopPropagation();
			goToAnchor(document.getElementById(anchor.id));
			closeOpenItem();
		});
		card.appendChild(go);

		// Drag the open card anywhere. The most recently dragged item gets the
		// highest z-index, so overlapping bookmarks stack in drag order.
		let drag=null;
		let suppressClick=false;
		card.addEventListener('pointerdown',event=>{
			if(event.button!==undefined&&event.button!==0)return;
			if(event.target.closest('.sgml-bm-x'))return;
			const rect=item.getBoundingClientRect();
			drag={id:event.pointerId,startX:event.clientX,startY:event.clientY,offX:event.clientX-rect.left,offY:event.clientY-rect.top,moving:false};
		});
		document.addEventListener('pointermove',event=>{
			if(!drag||event.pointerId!==drag.id)return;
			if(!drag.moving){
				if(Math.hypot(event.clientX-drag.startX,event.clientY-drag.startY)<5)return;
				drag.moving=true;
				makeFree(item);
				item.classList.add('is-dragging');
				bringToFront(item);
			}
			event.preventDefault();
			const width=item.offsetWidth;
			const left=Math.max(0,Math.min(event.clientX-drag.offX,window.innerWidth-width));
			item.style.left=left+'px';
			item.style.right='auto';
			item.style.top=clampTop(item,event.clientY-drag.offY)+'px';
		},{passive:false});
		const endDrag=event=>{
			if(!drag||event.pointerId!==drag.id)return;
			const moved=drag.moving;
			drag=null;
			if(moved){
				item.classList.remove('is-dragging');
				suppressClick=true;
				setTimeout(()=>{suppressClick=false;},0);
				// Snap to the nearest side edge as soon as the pointer is released.
				snapToEdge(item);
			}
		};
		document.addEventListener('pointerup',endDrag);
		document.addEventListener('pointercancel',endDrag);
		card.addEventListener('click',event=>{
			if(suppressClick){event.stopPropagation();event.preventDefault();}
		},true);

		if(removable){
			const x=document.createElement('button');
			x.type='button';
			x.className='sgml-bm-x';
			x.setAttribute('aria-label','Remove bookmark: '+title);
			x.title='Remove bookmark';
			x.textContent='×';
			x.addEventListener('click',event=>{
				event.stopPropagation();
				confirmRemove(item,document.getElementById(anchor.id)||anchor);
			});
			card.appendChild(x);
		}

		attachEditTriggers(peek,item);
		attachEditTriggers(card,item);
		item.append(peek,card);
		return item;
	}

	function removeInjectedAnchors(){
		document.querySelectorAll('.sgml-bookmark-anchor[data-saved="true"]').forEach(node=>node.remove());
	}

	// Rebuild the whole dock from the current document. Idempotent: safe to
	// call after every render, including fragment renders.
	function setupBookmarks(){
		const root=getOutput();
		closeOpenItem();
		document.querySelectorAll('.sgml-bm-dock').forEach(dock=>dock.replaceChildren());
		document.querySelectorAll('.sgml-bm.is-free').forEach(node=>node.remove());
		removeInjectedAnchors();
		if(!root)return;

		const docKey=documentKey();
		readStore().filter(entry=>(entry.doc||'default')===docKey).forEach(entry=>placeAnchor(entry,root));

		const anchors=[...root.querySelectorAll('.sgml-bookmark-anchor[data-sgml-bookmark="true"]')];
		anchors.forEach(anchor=>{
			const side=anchor.dataset.side==='left'?'left':'right';
			const item=buildItem(anchor);
			const saved=anchor.dataset.entryId?readStore().find(entry=>entry.id===anchor.dataset.entryId):null;
			if(saved&&saved.pos&&typeof saved.pos.top==='number'){
				const posSide=saved.pos.side==='left'?'left':'right';
				setSide(item,posSide);
				item.classList.add('is-free');
				document.body.appendChild(item);
				item.style.top=clampTop(item,saved.pos.top*window.innerHeight)+'px';
				item.style.left=posSide==='left'?'0px':'auto';
				item.style.right=posSide==='right'?'0px':'auto';
			}else getDock(side).appendChild(item);
		});
		document.querySelectorAll('.sgml-bm-dock').forEach(dock=>{dock.hidden=!dock.children.length;});
	}

	/* ---------------------------------------------------------------- *
	 * Creating a bookmark from the context menu
	 * ---------------------------------------------------------------- */

	function truncate(text,max){
		const clean=collapseWS(text).trim();
		return clean.length>max?clean.slice(0,max-1).trimEnd()+'…':clean;
	}

	function createBookmarkFromRange(range){
		const root=getOutput();
		if(!root||!range)return false;
		// With no selection (menu opened by a plain right-click), bookmark the
		// text from the click position to the end of its block.
		if(range.collapsed){
			const host=range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement;
			const block=host&&host.closest(BLOCK_SELECTOR);
			if(block&&root.contains(block)){
				const extended=range.cloneRange();
				extended.setEndAfter(block.lastChild||block);
				range=extended;
			}
		}
		const anchorInfo=describeRange(range);
		if(!anchorInfo)return false;
		const title=truncate(range.toString(),48)||'Bookmark';
		const docKey=documentKey();
		const list=readStore();
		const duplicate=list.find(entry=>(entry.doc||'default')===docKey&&entry.anchor&&entry.anchor.text===anchorInfo.text&&entry.anchor.prefix===anchorInfo.prefix);
		if(duplicate){
			const existing=document.getElementById('sgml-bookmark-'+duplicate.id);
			if(existing){goToAnchor(existing);}
			notify('Already bookmarked','info');
			return true;
		}

		const entry={
			id:newId(),
			doc:docKey,
			title,
			subtitle:nearestHeadingText(range),
			accent:randomAccent(),
			icon:'bookmark',
			side:'right',
			anchor:anchorInfo,
			created:Date.now()
		};
		list.push(entry);
		if(!writeStore(list)){
			notify('Could not save the bookmark (storage unavailable)','error');
			return false;
		}
		setupBookmarks();
		notify('Bookmark added','success');
		return true;
	}

	function notify(message,type){
		if(typeof showToast==='function')showToast(message,type,2200);
	}

	/* ---------------------------------------------------------------- *
	 * Selection menu: behaves like the native selection toolbar. It appears
	 * above the selection once the pointer is released, and hides as soon as
	 * the selection starts to change.
	 * ---------------------------------------------------------------- */

	let pointerIsDown=false;
	let showTimer=null;
	let menuPressed=false;
	let pressState=null;

	function ensureMenu(){
		let menu=document.getElementById(MENU_ID);
		if(menu)return menu;
		menu=document.createElement('div');
		menu.id=MENU_ID;
		menu.className='sgml-context-menu';
		menu.setAttribute('role','menu');
		menu.hidden=true;
		menu.innerHTML=
			'<button type="button" role="menuitem" data-action="copy">Copy</button>'+
			'<button type="button" role="menuitem" data-action="select-all">Select all</button>'+
			'<hr role="separator">'+
			'<button type="button" role="menuitem" data-action="bookmark">Bookmark</button>';
		// The menu is invisible to text selection and focus, so it never fights
		// with the page selection. Actions run on pointerup using the selection
		// captured when the press began (touch may collapse the live one).
		menu.setAttribute('contenteditable','false');
		menu.querySelectorAll('button').forEach(button=>button.tabIndex=-1);
		menu.addEventListener('mousedown',event=>event.preventDefault());
		menu.addEventListener('pointerdown',event=>{
			menuPressed=true;
			pressState=menuState;
			if(event.pointerType!=='touch')event.preventDefault();
		});
		menu.addEventListener('pointerup',event=>{
			const button=event.target.closest('button[data-action]');
			const state=pressState;
			menuPressed=false;
			pressState=null;
			if(!button||!state)return;
			event.preventDefault();
			runMenuAction(button.dataset.action,state);
		});
		menu.addEventListener('pointercancel',()=>{menuPressed=false;pressState=null;});
		menu.addEventListener('click',event=>event.preventDefault());
		menu.addEventListener('contextmenu',event=>event.preventDefault());
		menu.addEventListener('selectstart',event=>event.preventDefault());
		document.body.appendChild(menu);
		return menu;
	}

	function hideMenu(){
		const menu=document.getElementById(MENU_ID);
		if(menu)menu.hidden=true;
		menuState=null;
	}

	function currentSelection(){
		const root=getOutput();
		const selection=window.getSelection();
		if(!root||!selection||!selection.rangeCount||selection.isCollapsed)return null;
		const range=selection.getRangeAt(0);
		if(!root.contains(range.commonAncestorContainer))return null;
		const text=selection.toString();
		if(!text.trim())return null;
		return{range:range.cloneRange(),text};
	}

	function positionMenu(){
		const state=currentSelection();
		if(!state){hideMenu();return;}
		const menu=ensureMenu();
		const rects=[...state.range.getClientRects()].filter(rect=>rect.width||rect.height);
		const first=rects[0]||state.range.getBoundingClientRect();
		const last=rects[rects.length-1]||first;
		if(last.bottom<0||first.top>window.innerHeight){hideMenu();return;}
		menuState=state;
		menu.hidden=false;
		const width=menu.offsetWidth;
		const height=menu.offsetHeight;
		const bounds=state.range.getBoundingClientRect();
		const margin=8;
		let top=first.top-height-10;
		if(top<margin)top=last.bottom+10;
		top=Math.max(margin,Math.min(top,window.innerHeight-height-margin));
		const left=Math.max(margin,Math.min(bounds.left+bounds.width/2-width/2,window.innerWidth-width-margin));
		menu.style.left=left+'px';
		menu.style.top=top+'px';
	}

	function scheduleShow(delay){
		clearTimeout(showTimer);
		showTimer=setTimeout(()=>{
			if(pointerIsDown)return;
			if(currentSelection())positionMenu();
		},delay);
	}

	function copyText(text){
		if(!text)return;
		const fallback=()=>{try{document.execCommand('copy');}catch(_){}};
		if(navigator.clipboard&&navigator.clipboard.writeText){
			navigator.clipboard.writeText(text).catch(fallback);
		}else fallback();
	}

	function runMenuAction(action,pressed){
		const state=pressed||menuState;
		hideMenu();
		if(!state)return;
		if(action==='copy'){
			copyText(state.text);
		}else if(action==='select-all'){
			const root=getOutput();
			const selection=window.getSelection();
			if(root&&selection){
				const range=document.createRange();
				range.selectNodeContents(root);
				selection.removeAllRanges();
				selection.addRange(range);
			}
		}else if(action==='bookmark'){
			if(createBookmarkFromRange(state.range)){
				const selection=window.getSelection();
				if(selection)selection.removeAllRanges();
			}
		}
	}

	function bindEvents(){
		if(eventsBound)return;
		eventsBound=true;
		document.addEventListener('pointerdown',event=>{
			const inMenu=event.target.closest&&event.target.closest('.sgml-context-menu');
			if(!inMenu){
				pointerIsDown=true;
				hideMenu();
			}
			if(event.target.closest&&event.target.closest('.sgml-modal-backdrop'))return;
			const inEditor=editorEl&&editorEl.contains(event.target);
			if(editorEl&&!inEditor&&!(openItem&&openItem.contains(event.target)))closeEditor();
			if(openItem&&!openItem.contains(event.target)&&!inEditor)closeOpenItem();
		},true);
		const released=()=>{
			if(!pointerIsDown)return;
			pointerIsDown=false;
			scheduleShow(30);
		};
		document.addEventListener('pointerup',released,true);
		document.addEventListener('pointercancel',released,true);
		// While the selection is changing (dragging, handles, shift+arrows) the
		// menu is hidden; it returns once the selection settles.
		document.addEventListener('selectionchange',()=>{
			if(menuPressed)return;
			hideMenu();
			if(!pointerIsDown)scheduleShow(300);
		});
		document.addEventListener('contextmenu',event=>{
			const root=getOutput();
			if(!root||!root.contains(event.target))return;
			if(event.target.closest('input,textarea,select,[contenteditable="true"],#editor-drawer'))return;
			if(!currentSelection())return;
			event.preventDefault();
			positionMenu();
		});
		document.addEventListener('keydown',event=>{
			if(event.key==='Escape'){hideMenu();closeOpenItem();closeEditor();}
		});
		const reposition=()=>{const menu=document.getElementById(MENU_ID);if(menu&&!menu.hidden)requestAnimationFrame(positionMenu);};
		window.addEventListener('resize',reposition);
		document.addEventListener('scroll',reposition,{passive:true,capture:true});
		window.addEventListener('resize',()=>document.querySelectorAll('.sgml-bm.is-free').forEach(item=>{item.style.top=clampTop(item,parseFloat(item.style.top)||0)+'px';}));
	}

	window.setupBookmarks=setupBookmarks;
	window.createSGMLBookmarkFromSelection=()=>{
		const selection=window.getSelection();
		if(!selection||!selection.rangeCount)return false;
		return createBookmarkFromRange(selection.getRangeAt(0));
	};

	bindEvents();
})();
