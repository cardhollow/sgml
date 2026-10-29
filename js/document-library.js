		function getUploadTitle(fileName){
			const base=String(fileName||'Upload')
				.replace(/\.[^.]+$/,'')
				.trim();
			return base||'Upload';
		}

		function importFileContent(content,fileName='Upload'){
			const text=String(content||'');
			const title=getUploadTitle(fileName);
			const current=getCurrentDocument();

			if(!current||!(current.content||'').trim()){
				if(!current){
					const docs=loadDocuments();

					const doc={
						id:makeId(),
						title,
						content:text,
						createdAt:Date.now(),
						updatedAt:Date.now()
					};

					docs.push(doc);
					saveDocuments(docs);
					setCurrentDocumentId(doc.id);
					loadDocumentIntoEditor(doc);
				}else{
					current.title=title;
					current.content=text;
					current.updatedAt=Date.now();

					const docs=loadDocuments().map(
						doc=>doc.id===current.id?current:doc
					);

					saveDocuments(docs);
					localStorage.setItem(
						STORAGE_CURRENT_CONTENT,
						text
					);

					Editor.setValue(text);

					updateCurrentName(current);
					renderSGML(text);
				}
			}else{
				const docs=loadDocuments();

				const doc={
					id:makeId(),
					title,
					content:text,
					createdAt:Date.now(),
					updatedAt:Date.now()
				};

				docs.push(doc);
				saveDocuments(docs);
				loadDocumentIntoEditor(doc);
			}
		}

		function createDocument(title,content='',sourceUrl=null){
			const now=Date.now();
			const doc={
				id:makeId(),
				title:String(title||'Untitled SGML').trim()||'Untitled SGML',
				content:String(content||''),
				createdAt:now,
				updatedAt:now
			};
			if(sourceUrl)doc.sourceUrl=sourceUrl;
			const docs=loadDocuments();
			docs.push(doc);
			saveDocuments(docs);
			loadDocumentIntoEditor(doc);
			return doc;
		}

		function cleanProcessedURLCommands(url,removeDriveId=false){
			url.searchParams.delete('load');
			url.searchParams.delete('Queries');
			url.searchParams.delete('queries');
			url.searchParams.delete('query');
			url.searchParams.delete('gdrive');
			url.searchParams.delete('new');
			// A pasted Drive uc?export=download&id=... URL can leave its raw &id
			// parameter in the viewer URL when it was not URL-encoded first.
			if(removeDriveId)url.searchParams.delete('id');
			history.replaceState(null,'',url.href);
		}

		function getGoogleDriveFileId(input,pageUrl){
			let value=String(input||'').trim();
			if(!value)return '';

			// If a raw uc?export=download&id=... link was pasted directly into
			// ?gdrive=, the outer URL parser may treat &id=... as a viewer param.
			if(/drive\.google\.com\/(?:uc|uc\?)/i.test(value)&&!/[?&]id=/i.test(value)){
				const outerId=pageUrl&&pageUrl.searchParams.get('id');
				if(outerId)value+='&id='+outerId;
			}

			const patterns=[
				/\/(?:file|document|spreadsheets|presentation|forms)\/d\/([a-zA-Z0-9_-]+)/i,
				/\/d\/([a-zA-Z0-9_-]+)/i,
				/[?&]id=([a-zA-Z0-9_-]+)/i
			];
			for(const pattern of patterns){
				const match=value.match(pattern);
				if(match&&match[1])return match[1];
			}

			// A file ID pasted by itself, rather than a full Drive URL.
			if(/^[a-zA-Z0-9_-]{10,}$/.test(value))return value;
			return '';
		}

		function updateImportedDocument(existing,title,content,sourceUrl){
			const updated={...existing,title:String(title||existing.title||'Imported document'),content:String(content||''),updatedAt:Date.now(),sourceUrl:sourceUrl||existing.sourceUrl};
			saveDocuments(loadDocuments().map(doc=>doc.id===existing.id?updated:doc));
			loadDocumentIntoEditor(updated);
			return updated;
		}

		function isLikelyCorruptBinaryImport(content){
			const text=String(content||'');
			if(text.startsWith('%PDF-')||text.startsWith('PK\u0003\u0004'))return true;
			const sample=text.slice(0,10000);
			if(!sample)return false;
			let odd=0;
			for(let i=0;i<sample.length;i++)if(sample.charCodeAt(i)===0||sample.charCodeAt(i)===0xfffd||(sample.charCodeAt(i)<9)||(sample.charCodeAt(i)>13&&sample.charCodeAt(i)<32))odd++;
			return odd>Math.max(2,sample.length*0.005);
		}

		async function processURLCommands(){
			const url=new URL(location.href);
			const wantsNew=url.searchParams.has('new');
			const loadParamName=['load','Queries','queries','query'].find(name=>url.searchParams.has(name))||'';
			const wantsLoad=!!loadParamName;
			const wantsGoogleDrive=url.searchParams.has('gdrive');
			if(!wantsNew&&!wantsLoad&&!wantsGoogleDrive)return;
			let processed=false;

			const initialLoadValue=String(loadParamName?url.searchParams.get(loadParamName)||'':'').trim();
			showToast(
				wantsNew?'Creating a new SGML document…':
				wantsGoogleDrive?'Preparing Google Drive import…':
				initialLoadValue.startsWith('local:')?'Loading saved SGML…':'Loading file from URL…',
				'loading',
				0
			);

			try{
				if(wantsNew){
					const title=url.searchParams.get('new')||'Untitled SGML';
					createDocument(title,'');
					setSGMLEditorOpen(true);
					showToast('New SGML document created','success');
					processed=true;
				}else{
					let source='';
					let googleDriveId='';
					if(wantsGoogleDrive){
						googleDriveId=getGoogleDriveFileId(url.searchParams.get('gdrive'),url);
						if(!googleDriveId){
							throw new Error('Paste a Google Drive file ID or a Google Drive file URL after ?gdrive=. The file must be shared as Anyone with the link.');
						}
						source='https://proxy.cors.dev/https://drive.google.com/uc?export=download&id='+encodeURIComponent(googleDriveId);
					}else{
						source=String(url.searchParams.get(loadParamName)||'').trim();
						if(!source){
							throw new Error('Use ?load=URL, ?Queries=URL, ?load=local:DOCUMENT_ID, or ?gdrive=FILE_ID_OR_URL.');
						}
					}

					if(source.startsWith('local:')){
						showToast('Loading saved SGML document…','loading',0);
						const localId=source.slice(6);
						const doc=loadDocuments().find(item=>item.id===localId||String(item.title||'').toLowerCase()===localId.toLowerCase());
						if(!doc)throw new Error('No saved local document matches this ID or title.');
						loadDocumentIntoEditor(doc);
						showToast('Loaded: '+(doc.title||'Untitled SGML'),'success');
						processed=true;
					}else{
						const target=new URL(source,location.href);
						target.hash='';
						const sourceUrl=target.href;
						const pathName=decodeURIComponent(target.pathname.split('/').pop()||'Imported file');
						const existing=loadDocuments().find(item=>item.sourceUrl===sourceUrl);
						const extension=(pathName.match(/\.([a-z0-9]+)$/i)||[])[1]?.toLowerCase()||'';
						const expectsBinaryConversion=['docx','pdf'].includes(extension);
						const existingIsConverted=!!(existing&&/data-sgml-imported-from=["'](?:docx|pdf)["']/i.test(existing.content||''));
						const canReuse=!!(existing&&(!expectsBinaryConversion||existingIsConverted)&&!isLikelyCorruptBinaryImport(existing.content));

						if(canReuse){
							showToast('Opening previously imported copy…','loading',0);
							loadDocumentIntoEditor(existing);
							showToast('Loaded: '+(existing.title||'Imported document'),'success');
							processed=true;
						}else{
							if(!navigator.onLine)throw new Error('This file has not been converted on this device yet. Reconnect once to import it.');
							showToast('Fetching and converting file…','loading',0);
							const response=await fetch(sourceUrl,{cache:'no-cache'});
							if(!response.ok)throw new Error('Could not load file from URL (HTTP '+response.status+').');
							if(!window.SGMLFileConverter)throw new Error('The SGML file converter is unavailable. Refresh the viewer and try again.');
							const converted=await window.SGMLFileConverter.convertResponse(response,pathName||'Imported file');
							const effectiveName=converted.fileName||pathName||'Imported file';
							const title=googleDriveId?getUploadTitle(effectiveName)||('Google Drive '+googleDriveId):getUploadTitle(effectiveName);
							if(existing)updateImportedDocument(existing,title,converted.content,sourceUrl);
							else createDocument(title,converted.content,sourceUrl);
							const kindLabel=converted.kind==='docx'?'DOCX converted to HTML':converted.kind==='pdf'?'PDF text converted to HTML':converted.kind==='html'?'HTML imported':'text file imported';
							const warning=converted.warnings&&converted.warnings.length?' ('+converted.warnings.length+' conversion note'+(converted.warnings.length===1?'':'s')+')':'';
							showToast(kindLabel+' successfully: '+effectiveName+warning,'success',5500);
							processed=true;
						}
					}
				}
			}catch(error){
				console.error('URL command failed:',error);
				showToast('File load failed: '+String(error&&error.message||error),'error',8500);
			}finally{
				// Keep a failed command intact so it can be retried after reconnecting.
				if(processed)cleanProcessedURLCommands(url,wantsGoogleDrive);
			}
		}

		async function handleFileUpload(event){
			const file=event.target.files&&event.target.files[0];
			event.target.value='';
			if(!file)return;
			showToast('Reading file: '+(file.name||'Upload')+'…','loading',0);
			try{
				if(!window.SGMLFileConverter)throw new Error('The SGML file converter is unavailable. Refresh the viewer and try again.');
				const converted=await window.SGMLFileConverter.convertFile(file);
				importFileContent(converted.content,file.name||converted.fileName||'Upload');
				const kindLabel=converted.kind==='docx'?'DOCX converted to HTML':converted.kind==='pdf'?'PDF text converted to HTML':converted.kind==='html'?'HTML loaded':'text file loaded';
				const warning=converted.warnings&&converted.warnings.length?' ('+converted.warnings.length+' conversion note'+(converted.warnings.length===1?'':'s')+')':'';
				showToast(kindLabel+': '+(file.name||'Upload')+warning,'success',5000);
			}catch(error){
				console.error('Could not import uploaded file:',error);
				showToast('Could not import file: '+String(error&&error.message||error),'error',8500);
			}
		}

		async function processSharedFile(){
			const url=new URL(location.href);
			const token=url.searchParams.get('__sgml_shared');
			if(!token)return;

			showToast('Loading shared file…','loading',0);
			const dataURL=new URL('./__sgml_shared_file?token='+encodeURIComponent(token),location.href);
			try{
				const response=await fetch(dataURL.href,{cache:'no-store'});
				if(!response.ok)throw new Error('Shared file could not be retrieved.');

				let fileName='Shared File';
				let converted;
				if((response.headers.get('content-type')||'').toLowerCase().includes('application/json')){
					// Backward compatibility for shared files saved by older viewer versions.
					const data=await response.json();
					if(!data||typeof data.content!=='string')throw new Error('Shared file data was invalid.');
					fileName=data.name||fileName;
					const bytes=new TextEncoder().encode(data.content);
					converted=await window.SGMLFileConverter.convertBytes(bytes.buffer,fileName,data.type||'text/plain');
				}else{
					try{fileName=decodeURIComponent(response.headers.get('x-sgml-file-name')||'Shared%20File');}catch(_){fileName=response.headers.get('x-sgml-file-name')||fileName;}
					converted=await window.SGMLFileConverter.convertBytes(await response.arrayBuffer(),fileName,response.headers.get('content-type')||'application/octet-stream');
				}

				importFileContent(converted.content,fileName);
				const label=converted.kind==='docx'?'DOCX converted to HTML':converted.kind==='pdf'?'PDF text converted to HTML':'Shared file loaded';
				showToast(label+': '+fileName,'success',5000);

				const worker=navigator.serviceWorker&&navigator.serviceWorker.controller;
				if(worker)worker.postMessage({type:'DELETE_SHARED_FILE',url:dataURL.href});
				url.searchParams.delete('__sgml_shared');
				history.replaceState(null,'',url.href);
			}catch(error){
				console.error('Could not import shared file:',error);
				showToast('Shared file could not be imported: '+String(error&&error.message||error),'error',8500);
				url.searchParams.delete('__sgml_shared');
				history.replaceState(null,'',url.href);
			}
		}

		function downloadSGML(){
			const doc=getCurrentDocument();
			const content=String(
				Editor.getValue()
			);

			const base=String(
				doc&&doc.title||'Untitled SGML'
			)
				.replace(/\.[^.]+$/,'')
				.replace(/[\\/:*?"<>|]+/g,'_')
				.trim()||'Untitled SGML';

			const blob=new Blob([content],{
				type:'text/plain;charset=utf-8'
			});

			const url=URL.createObjectURL(blob);
			const a=document.createElement('a');

			a.href=url;
			a.download=base+'.sgml';
			a.setAttribute('download',base+'.sgml');

			document.body.appendChild(a);
			a.click();
			a.remove();

			setTimeout(
				()=>URL.revokeObjectURL(url),
				1000
			);
		}

		function syncEditorViewport(){
			const drawer=document.getElementById('editor-drawer');
			if(!drawer||!drawer.classList.contains('open'))return;
			const toolbar=document.querySelector('.sgml-toolbar');
			const toolbarBottom=toolbar?toolbar.getBoundingClientRect().bottom:0;
			// Keep the editor below the toolbar when it is visible; after the page is
			// scrolled, let it use almost the full viewport instead.
			const top=Math.max(4,Math.min(window.innerHeight-120,toolbarBottom+6));
			drawer.style.setProperty('--editor-top',Math.ceil(top)+'px');
		}

		let editorBackGuardActive=false;
		const editorGuardState={sgmlEditorBackGuard:true};

		function setSGMLEditorOpen(open){
			const drawer=document.getElementById('editor-drawer');
			if(!drawer)return;
			if(open){
				if(!drawer.classList.contains('open'))drawer.classList.add('open');
				document.body.classList.add('sgml-editor-active');
				if(!editorBackGuardActive){
					try{history.pushState(editorGuardState,'',location.href);editorBackGuardActive=true;}catch(error){console.warn('Could not activate editor back guard:',error);}
				}
				syncEditorViewport();
				Editor.focus();
			}else{
				if(drawer.classList.contains('open'))drawer.classList.remove('open');
				document.body.classList.remove('sgml-editor-active');
				drawer.style.removeProperty('--editor-top');
				if(editorBackGuardActive){
					editorBackGuardActive=false;
					// Remove only the history entry created for this open editor.
					try{history.back();}catch(error){console.warn('Could not release editor back guard:',error);}
				}
			}
		}

		function toggleEditor(){
			const drawer=document.getElementById('editor-drawer');
			setSGMLEditorOpen(!drawer.classList.contains('open'));
		}

		// Mobile browser and Android system-back navigation emit popstate when
		// moving through the page history. While the editor is open, immediately
		// restore its guard entry so Back cannot leave or navigate away from it.
		window.addEventListener('popstate',()=>{
			const drawer=document.getElementById('editor-drawer');
			if(!editorBackGuardActive||!drawer||!drawer.classList.contains('open'))return;
			try{history.pushState(editorGuardState,'',location.href);}catch(error){console.warn('Could not restore editor back guard:',error);}
		});

		function openDocumentation(){
			const modal=document.getElementById('documentation-modal');
			const frame=document.getElementById('documentation-frame');
			if(!modal||!frame)return;
			if(!frame.getAttribute('src'))frame.src='./Documentation/index.html';
			modal.classList.add('open');
			modal.setAttribute('aria-hidden','false');
		}

		function closeDocumentation(){
			const modal=document.getElementById('documentation-modal');
			if(!modal)return;
			modal.classList.remove('open');
			modal.setAttribute('aria-hidden','true');
		}

		function openDocumentationInNewTab(){
			window.open('./Documentation/index.html','_blank','noopener');
		}

		window.addEventListener('resize',syncEditorViewport);
		window.addEventListener('scroll',syncEditorViewport,{passive:true});
		document.addEventListener('keydown',event=>{
			if(event.key==='Escape')closeDocumentation();
		});
		document.addEventListener('click',event=>{
			const backdrop=document.getElementById('documentation-modal');
			if(backdrop&&event.target===backdrop)closeDocumentation();
		});

		function loadSGMLFromEditor(){
			const code=Editor.getValue();
			const current=getCurrentDocument();
			if(current){
				current.content=code;
				current.updatedAt=Date.now();
				saveDocuments(loadDocuments().map(doc=>doc.id===current.id?current:doc));
				localStorage.setItem(STORAGE_CURRENT_CONTENT,code);
			}
			renderSGML(code);
			showToast('SGML rendered from editor','success');
		}

		async function createNewSGML(){
			showToast('Creating a new SGML document…','loading',0);
			const docs=loadDocuments();

			const doc={
				id:makeId(),
				title:'Untitled SGML',
				content:'',
				createdAt:Date.now(),
				updatedAt:Date.now()
			};

			docs.push(doc);
			saveDocuments(docs);
			loadDocumentIntoEditor(doc);

			setSGMLEditorOpen(true);
			showToast('New SGML document ready','success');
		}

		function openLibrary(){
			renderLibraryList();
			showToast('SGML library opened','info',1800);

			document
				.getElementById('library-modal')
				.classList.add('open');

			document
				.getElementById('library-modal')
				.setAttribute('aria-hidden','false');
		}

		function closeLibrary(){
			document
				.getElementById('library-modal')
				.classList.remove('open');

			document
				.getElementById('library-modal')
				.setAttribute('aria-hidden','true');
		}

		function renderLibraryList(){
			const list=document.getElementById('library-list');

			const docs=loadDocuments().sort(
				(a,b)=>(b.updatedAt||0)-(a.updatedAt||0)
			);

			list.innerHTML='';

			if(!docs.length){
				list.innerHTML=
					'<div class="sgml-library-empty">No saved SGML documents yet.</div>';
				return;
			}

			docs.forEach(doc=>{
				const row=document.createElement('div');
				row.className='sgml-library-item';

				const loadButton=document.createElement('button');
				loadButton.className='sgml-library-load';
				loadButton.type='button';

				const title=document.createElement('div');
				title.className='sgml-library-item-title';
				title.textContent=doc.title||'Untitled SGML';

				const preview=document.createElement('div');
				preview.className='sgml-library-item-preview';

				const firstLine=String(doc.content||'')
					.split(/\r?\n/,1)[0]||'(empty)';

				preview.textContent=firstLine;
				preview.title=firstLine;

				loadButton.appendChild(title);
				loadButton.appendChild(preview);

				loadButton.addEventListener(
					'click',
					async()=>{
						const current=getCurrentDocument();
						const currentIsSame=
							current&&current.id===doc.id;

						if(!currentIsSame){
							const ok=await confirmDialog(
								`Load "${doc.title||'Untitled SGML'}"?\n\nThis will replace the SGML currently open in the editor.`,
								'Load SGML',
								'Load'
							);

							if(!ok)return;
						}

						closeLibrary();
						showToast('Loading SGML: '+(doc.title||'Untitled SGML')+'…','loading',0);
						loadDocumentIntoEditor(doc);
						showToast('Loaded SGML: '+(doc.title||'Untitled SGML'),'success');
					}
				);

				const deleteButton=document.createElement('button');
				deleteButton.className='sgml-library-delete';
				deleteButton.type='button';
				deleteButton.textContent='X';
				deleteButton.setAttribute(
					'aria-label',
					`Delete ${doc.title||'Untitled SGML'}`
				);

				deleteButton.addEventListener(
					'click',
					async event=>{
						event.stopPropagation();

						const ok=await confirmDialog(
							`Delete "${doc.title||'Untitled SGML'}"?\n\nThis saved SGML will be permanently removed from local storage.`,
							'Delete SGML',
							'Delete'
						);

						if(!ok)return;

						const docsNow=loadDocuments();
						const remaining=docsNow.filter(
							item=>item.id!==doc.id
						);

						saveDocuments(remaining);

						if(currentDocumentId===doc.id){
							if(remaining.length){
								const next=remaining.slice().sort(
									(a,b)=>(b.updatedAt||0)-(a.updatedAt||0)
								)[0];

								loadDocumentIntoEditor(next);
							}else{
								const next={
									id:makeId(),
									title:'Untitled SGML',
									content:'',
									createdAt:Date.now(),
									updatedAt:Date.now()
								};

								saveDocuments([next]);
								loadDocumentIntoEditor(next);
							}
						}

						renderLibraryList();
					}
				);

				row.appendChild(loadButton);
				row.appendChild(deleteButton);
				list.appendChild(row);
			});
		}

