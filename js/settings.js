/*
 * Settings modal (v13.2). Opens from the toolbar; nothing changes until
 * Apply is pressed, and Cancel (or Escape / tapping outside) discards edits.
 *
 * Fields:
 *  - SGML file name: renames the current document. It is the name shown under
 *    the toolbar, in the library, and used as <name>.sgml by Download SGML.
 */
(function(){
	'use strict';

	const MODAL_ID='settings-modal';
	const NAME_ID='settings-file-name';
	const HINT_ID='settings-file-hint';

	function cleanName(value){
		return String(value||'')
			.replace(/\.(sgml|txt|md|markdown)$/i,'')
			.replace(/[\\/:*?"<>|]+/g,'_')
			.replace(/\s+/g,' ')
			.trim();
	}

	function currentTitle(){
		try{
			const doc=typeof getCurrentDocument==='function'?getCurrentDocument():null;
			return doc&&doc.title?String(doc.title):'';
		}catch(_){return '';}
	}

	function isOpen(){
		const modal=document.getElementById(MODAL_ID);
		return !!modal&&modal.classList.contains('open');
	}

	function updateHint(){
		const input=document.getElementById(NAME_ID);
		const hint=document.getElementById(HINT_ID);
		if(!input||!hint)return;
		const name=cleanName(input.value);
		hint.textContent=name?`Download as: ${name}.sgml`:'Enter a file name.';
	}

	function openSettings(){
		const modal=document.getElementById(MODAL_ID);
		const input=document.getElementById(NAME_ID);
		if(!modal||!input)return;
		input.value=currentTitle()||'Untitled SGML';
		updateHint();
		modal.classList.add('open');
		modal.setAttribute('aria-hidden','false');
		setTimeout(()=>{try{input.focus({preventScroll:true});input.select();}catch(_){}},30);
	}

	function closeSettings(){
		const modal=document.getElementById(MODAL_ID);
		if(!modal)return;
		modal.classList.remove('open');
		modal.setAttribute('aria-hidden','true');
		const input=document.getElementById(NAME_ID);
		if(input)input.blur();
	}

	function applySettings(){
		const input=document.getElementById(NAME_ID);
		if(!input)return;
		const name=cleanName(input.value);
		if(!name){
			if(typeof showToast==='function')showToast('Enter a file name first','error',2200);
			input.focus();
			return;
		}
		try{
			if(typeof getCurrentDocument==='function'&&getCurrentDocument()){
				const docs=loadDocuments();
				const doc=docs.find(item=>item.id===currentDocumentId);
				if(doc){
					doc.title=name;
					doc.updatedAt=Date.now();
					saveDocuments(docs);
					updateCurrentName(doc);
				}
			}else if(typeof saveCurrentSGML==='function'){
				saveCurrentSGML(name);
			}
			closeSettings();
			if(typeof showToast==='function')showToast('Settings applied','success',1800);
		}catch(error){
			console.error('Could not apply settings:',error);
			if(typeof showToast==='function')showToast('Could not apply settings','error',3000);
		}
	}

	function bind(){
		const modal=document.getElementById(MODAL_ID);
		const input=document.getElementById(NAME_ID);
		const cancel=document.getElementById('settings-cancel');
		const apply=document.getElementById('settings-apply');
		if(!modal||!input||!cancel||!apply)return;
		cancel.addEventListener('click',closeSettings);
		apply.addEventListener('click',applySettings);
		input.addEventListener('input',updateHint);
		input.addEventListener('keydown',event=>{
			if(event.key==='Enter'){event.preventDefault();applySettings();}
		});
		modal.addEventListener('pointerdown',event=>{
			if(event.target===modal)closeSettings();
		});
		document.addEventListener('keydown',event=>{
			if(event.key==='Escape'&&isOpen()){event.stopPropagation();closeSettings();}
		},true);
	}

	window.openSettings=openSettings;
	window.closeSettings=closeSettings;
	if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind);
	else bind();
})();
