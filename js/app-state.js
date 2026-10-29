
		const STORAGE_DOCS='sgml_viewer_documents';
		const STORAGE_CURRENT_ID='sgml_viewer_current_id';
		const STORAGE_CURRENT_CONTENT='sgml_viewer_current_sgml';

		let parsedQuestions={};
		let currentDocumentId=null;
		let sgmlToastTimer=null;
		let customComponentCounter=0;
		let sgmlSpoilerIdCounter=0;
		let questionCounter=0;
		let infoCounter=0;
		let openInfoWrap=null;

		function showToast(message,type='info',duration=3200){
			const card=document.getElementById('sgml-toast-card');
			const icon=document.getElementById('sgml-toast-icon');
			const messageEl=document.getElementById('sgml-toast-message');
			if(!card||!icon||!messageEl)return;

			if(sgmlToastTimer){clearTimeout(sgmlToastTimer);sgmlToastTimer=null;}
			const allowedTypes=['loading','success','error','info'];
			const safeType=allowedTypes.includes(type)?type:'info';
			card.className='visible is-'+safeType;
			messageEl.textContent=String(message||'');
			card.setAttribute('role',safeType==='error'?'alert':'status');
			icon.textContent=safeType==='success'?'✓':safeType==='error'?'!':safeType==='loading'?'':'i';
			card.dataset.toastType=safeType;
			if(Number(duration)>0){
				sgmlToastTimer=setTimeout(hideToast,Number(duration));
			}
		}

		function hideToast(){
			const card=document.getElementById('sgml-toast-card');
			if(card)card.classList.remove('visible');
			if(sgmlToastTimer){clearTimeout(sgmlToastTimer);sgmlToastTimer=null;}
		}

		document.addEventListener('DOMContentLoaded',()=>{
			const dismiss=document.getElementById('sgml-toast-dismiss');
			if(dismiss)dismiss.addEventListener('click',hideToast);
		});

		function makeId(){
			return 'sgml_'+Date.now()+'_'+Math.random().toString(36).slice(2,9);
		}

		function loadDocuments(){
			try{
				const raw=localStorage.getItem(STORAGE_DOCS);
				if(!raw)return[];
				const docs=JSON.parse(raw);
				return Array.isArray(docs)?docs:[];
			}catch(error){
				console.error('Could not load SGML library:',error);
				return[];
			}
		}

		function saveDocuments(docs){
			localStorage.setItem(STORAGE_DOCS,JSON.stringify(docs));
		}

		function getCurrentDocument(){
			return loadDocuments().find(doc=>doc.id===currentDocumentId)||null;
		}

		function setCurrentDocumentId(id){
			currentDocumentId=id;
			localStorage.setItem(STORAGE_CURRENT_ID,id);
		}

		function saveCurrentSGML(nameOverride=null){
			const content=Editor.getValue();
			let docs=loadDocuments();
			let doc=docs.find(item=>item.id===currentDocumentId);

			if(!doc){
				doc={
					id:makeId(),
					title:nameOverride||'Untitled SGML',
					content:'',
					createdAt:Date.now(),
					updatedAt:Date.now()
				};
				docs.push(doc);
				setCurrentDocumentId(doc.id);
			}

			if(nameOverride!==null)doc.title=nameOverride;
			doc.content=content;
			doc.updatedAt=Date.now();
			saveDocuments(docs);
			localStorage.setItem(STORAGE_CURRENT_CONTENT,content);
			updateCurrentName(doc);
		}

		function loadDocumentIntoEditor(doc){
			if(!doc)return;
			setCurrentDocumentId(doc.id);
			Editor.setValue(doc.content||'');
			localStorage.setItem(STORAGE_CURRENT_CONTENT,doc.content||'');
			updateCurrentName(doc);
			renderSGML(doc.content||'');
		}

		function updateCurrentName(doc=getCurrentDocument()){
			const el=document.getElementById('sgml-current-name');
			if(!el)return;
			el.textContent=doc?`Current SGML: ${doc.title}`:'';
			el.title=doc?doc.title:'';
		}

		let sgmlAutosaveTimer=null;
		function flushSGMLAutosave(){
			if(sgmlAutosaveTimer){clearTimeout(sgmlAutosaveTimer);sgmlAutosaveTimer=null;}
			try{saveCurrentSGML();}catch(error){console.warn('Could not autosave SGML:',error);}
		}
		function setupAutosave(){
			Editor.init({
				onRun:()=>loadSGMLFromEditor(),
				onChange:()=>{
					if(sgmlAutosaveTimer)clearTimeout(sgmlAutosaveTimer);
					sgmlAutosaveTimer=setTimeout(flushSGMLAutosave,250);
				}
			});
			window.addEventListener('pagehide',flushSGMLAutosave);
		}

		function confirmDialog(message,title='Confirm',confirmText='Confirm'){
			return new Promise(resolve=>{
				const backdrop=document.getElementById('confirm-modal');
				const titleEl=document.getElementById('confirm-title');
				const messageEl=document.getElementById('confirm-message');
				const okBtn=document.getElementById('confirm-ok');
				const cancelBtn=document.getElementById('confirm-cancel');

				titleEl.textContent=title;
				messageEl.textContent=message;
				okBtn.textContent=confirmText;
				backdrop.classList.add('open');
				backdrop.setAttribute('aria-hidden','false');

				let finished=false;
				const finish=value=>{
					if(finished)return;
					finished=true;
					backdrop.classList.remove('open');
					backdrop.setAttribute('aria-hidden','true');
					okBtn.removeEventListener('click',onOk);
					cancelBtn.removeEventListener('click',onCancel);
					backdrop.removeEventListener('click',onBackdrop);
					document.removeEventListener('keydown',onKeyDown);
					resolve(value);
				};
				const onOk=()=>finish(true);
				const onCancel=()=>finish(false);
				const onBackdrop=event=>{if(event.target===backdrop)finish(false)};
				const onKeyDown=event=>{if(event.key==='Escape')finish(false)};

				okBtn.addEventListener('click',onOk);
				cancelBtn.addEventListener('click',onCancel);
				backdrop.addEventListener('click',onBackdrop);
				document.addEventListener('keydown',onKeyDown);
			});
		}

		let deferredInstallPrompt=null;

		function hidePWAInstallUI(){
			const banner=document.getElementById('pwa-install-banner');
			if(banner)banner.classList.remove('show');
		}

		function showPWAInstallUI(){
			if(!deferredInstallPrompt)return;
			if(window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true){
				hidePWAInstallUI();
				return;
			}
			const banner=document.getElementById('pwa-install-banner');
			if(banner)banner.classList.add('show');
		}

		async function promptPWAInstall(){
			if(!deferredInstallPrompt)return;

			const promptEvent=deferredInstallPrompt;
			deferredInstallPrompt=null;
			hidePWAInstallUI();

			try{
				await promptEvent.prompt();
				await promptEvent.userChoice;
			}catch(error){
				console.warn('PWA install prompt failed:',error);
			}
		}

		function setupPWAInstallPrompt(){
			window.addEventListener('beforeinstallprompt',event=>{
				event.preventDefault();
				deferredInstallPrompt=event;
				showPWAInstallUI();
			});

			window.addEventListener('appinstalled',()=>{
				deferredInstallPrompt=null;
				hidePWAInstallUI();
			});

			const installButton=document.getElementById('pwa-install-button');
			if(installButton){
				installButton.addEventListener('click',promptPWAInstall);
			}

			const dismissButton=document.getElementById('pwa-install-dismiss');
			if(dismissButton){
				dismissButton.addEventListener('click',()=>hidePWAInstallUI());
			}
		}

		async function getServiceWorkerRegistration(){
			if(!('serviceWorker' in navigator))return null;
			try{return await navigator.serviceWorker.getRegistration('./')}
			catch(error){console.warn('Could not read Service Worker registration:',error);return null}
		}

		let swReloadScheduled=false;
		function watchServiceWorkerUpdates(registration){
			if(!registration||registration.__sgmlWatchingUpdates)return;
			registration.__sgmlWatchingUpdates=true;
			const activateWaiting=()=>{
				if(registration.waiting)registration.waiting.postMessage({type:'SKIP_WAITING'});
			};
			activateWaiting();
			registration.addEventListener('updatefound',()=>{
				const worker=registration.installing;
				if(!worker)return;
				worker.addEventListener('statechange',()=>{
					if(worker.state==='installed'&&navigator.serviceWorker.controller)activateWaiting();
				});
			});
			if(!navigator.serviceWorker.__sgmlControllerWatch){
				navigator.serviceWorker.__sgmlControllerWatch=true;
				let hasSeenController=!!navigator.serviceWorker.controller;
				navigator.serviceWorker.addEventListener('controllerchange',()=>{
					if(!hasSeenController){hasSeenController=true;return;}
					if(swReloadScheduled)return;
					swReloadScheduled=true;
					location.reload();
				});
			}
		}

		async function registerPWAServiceWorker(){
			if(!('serviceWorker' in navigator))return null;
			try{
				const registration=await navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'});
				watchServiceWorkerUpdates(registration);
				if(navigator.onLine)registration.update().catch(error=>console.info('Using cached resources while network is unavailable:',error));
				if(navigator.onLine&&registration.active){
					registration.active.postMessage({type:'REFRESH_APP_SHELL'});
					registration.active.postMessage({type:'CACHE_CONVERTER_LIBRARIES'});
				}else if(navigator.onLine){
					navigator.serviceWorker.ready.then(readyRegistration=>{
						if(readyRegistration.active)readyRegistration.active.postMessage({type:'CACHE_CONVERTER_LIBRARIES'});
					}).catch(()=>{});
				}
				return registration;
			}catch(error){
				console.warn('Automatic resource caching is unavailable:',error);
				return null;
			}
		}

		window.addEventListener('online',()=>{
			registerPWAServiceWorker().then(registration=>{
				if(!registration)return;
				registration.update().catch(()=>{});
				const worker=registration.active||registration.waiting||registration.installing;
				if(worker){
					worker.postMessage({type:'REFRESH_APP_SHELL'});
					worker.postMessage({type:'CACHE_CONVERTER_LIBRARIES'});
				}
			}).catch(error=>console.warn('Resource refresh failed:',error));
		});


