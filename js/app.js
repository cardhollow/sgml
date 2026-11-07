		window.addEventListener(
			'DOMContentLoaded',
			async()=>{
				const startupURL=new URL(location.href);
				if(startupURL.searchParams.has('gdrive'))showToast('Preparing Google Drive import…','loading',0);
				else if(['load','Queries','queries','query'].some(name=>startupURL.searchParams.has(name)))showToast('Loading file…','loading',0);
				else if(startupURL.searchParams.has('new'))showToast('Creating a new SGML document…','loading',0);
				setupPWAInstallPrompt();
				initializeLibrary();
				setupAutosave();

				if('serviceWorker' in navigator){
					await registerPWAServiceWorker();
				}

				await processURLCommands();
				await processSharedFile();

				try{
					const url=new URL(location.href);

					if(url.searchParams.has('__sgml_refresh')){
						url.searchParams.delete('__sgml_refresh');
						history.replaceState(
							null,
							'',
							url.href
						);
					}
				}catch(_){}
			}
		);

		window.addEventListener('resize',()=>{
			if(typeof openInfoPanels!=='undefined'){
				openInfoPanels.forEach(entry=>positionInfoPanel(entry.wrap,entry.panel));
			}

			document.querySelectorAll('.sgml-tree').forEach(treeEl=>{
				resizeTreeToContent(treeEl);
				updateTreeConnections(treeEl);
			});
		});
	