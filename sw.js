const CACHE_NAME='sgml-viewer-offline-v3';
const STATE_CACHE_NAME='sgml-viewer-offline-state-v1';
const STATE_URL='/__sgml_offline_enabled';
const SHARE_CACHE_NAME='sgml-viewer-share-v1';

const APP_SHELL=[
	'./',
	'./index.html',
	'./manifest.json',
	'./marked.js',
	'./tex-chtml.js',
	'./icon.svg',
	'./icon-192.png',
	'./icon-512.png'
];

function getStateURL(){
	return new URL(STATE_URL,self.registration.scope);
}

async function isOfflineEnabled(){
	const cache=await caches.open(STATE_CACHE_NAME);
	return !!(await cache.match(getStateURL()));
}

async function setOfflineEnabled(enabled){
	const stateCache=await caches.open(STATE_CACHE_NAME);
	if(enabled){
		await stateCache.put(
			getStateURL(),
			new Response('1',{headers:{'Content-Type':'text/plain'}})
		);
		return;
	}
	await stateCache.delete(getStateURL());
	await caches.delete(CACHE_NAME);
}

async function cacheAppShell(){
	const cache=await caches.open(CACHE_NAME);
	const urls=APP_SHELL.map(path=>new URL(path,self.registration.scope).href);
	const results=await Promise.allSettled(
		urls.map(async url=>{
			const request=new Request(url,{cache:'reload'});
			const response=await fetch(request);
			if(!response.ok)throw new Error(`Could not cache ${url}: HTTP ${response.status}`);
			await cache.put(url,response.clone());
		})
	);
	const failed=results.find(result=>result.status==='rejected');
	if(failed)throw failed.reason;
}

self.addEventListener('install',event=>{
	event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate',event=>{
	event.waitUntil(
		caches.keys().then(keys=>
			Promise.all(
				keys
					.filter(key=>
						key.startsWith('sgml-viewer-offline-')&&
						key!==CACHE_NAME&&
						key!==STATE_CACHE_NAME
					)
					.map(key=>caches.delete(key))
			)
		).then(()=>self.clients.claim())
	);
});

function getShareActionURL(){
	return new URL('./share/',self.registration.scope);
}

function getShareDataBaseURL(){
	return new URL('./__sgml_shared_file',self.registration.scope);
}

function isShareAction(request){
	const requestURL=new URL(request.url);
	return requestURL.origin===self.location.origin &&
		requestURL.pathname===getShareActionURL().pathname;
}
function isShareDataRequest(request){
	const requestURL=new URL(request.url);
	const baseURL=getShareDataBaseURL();
	return requestURL.origin===baseURL.origin &&
		requestURL.pathname===baseURL.pathname &&
		requestURL.searchParams.has('token');
}

async function storeSharedFile(request){
	const formData=await request.formData();

	let file=null;

	for(const value of formData.values()){
		if(
			typeof File!=='undefined'&&
			value instanceof File
		){
			file=value;
			break;
		}
	}
	if(!file){
		return Response.redirect(
			new URL(
				'./?__sgml_share_error=no-file',
				self.registration.scope
			).href,
			303
		);
	}

	const content=await file.text();
	const token=
		Date.now().toString(36)+
		'-'+
		Math.random().toString(36).slice(2);

	const dataURL=new URL(
		'./__sgml_shared_file?token='+
		encodeURIComponent(token),
		self.registration.scope
	);

	const payload={
		name:file.name||'Shared File',
		type:file.type||'text/plain',
		content,
		receivedAt:Date.now()
	};
	const cache=await caches.open(SHARE_CACHE_NAME);

	await cache.put(
		new Request(dataURL.href),
		new Response(
			JSON.stringify(payload),
			{
				headers:{
					'Content-Type':'application/json; charset=utf-8',
					'Cache-Control':'no-store'
				}
			}
		)
	);

	return Response.redirect(
		new URL(
			'./?__sgml_shared='+
			encodeURIComponent(token),
			self.registration.scope
		).href,
		303
	);
}

self.addEventListener('message',event=>{
	const data=event.data||{};
	if(data.type==='SKIP_WAITING'){
		event.waitUntil(self.skipWaiting());
		return;
	}

	if(data.type==='SET_OFFLINE_ENABLED'){
		event.waitUntil(
			(async()=>{
				await setOfflineEnabled(!!data.enabled);
				if(data.enabled)await cacheAppShell();
				if(event.ports&&event.ports[0]){
					event.ports[0].postMessage({ok:true});
				}
			})().catch(error=>{
				if(event.ports&&event.ports[0]){
					event.ports[0].postMessage({
						ok:false,
						error:String(error&&error.message?error.message:error)
					});
				}
			})
		);
		return;
	}
	if(data.type==='DELETE_SHARED_FILE'&&data.url){
		event.waitUntil(
			caches.open(SHARE_CACHE_NAME)
				.then(cache=>
					cache.delete(
						new Request(data.url)
					)
				)
				.then(()=>{
					if(event.ports&&event.ports[0]){
						event.ports[0].postMessage({
							ok:true
						});
					}
				})
		);
		return;
	}

	if(data.type==='DISABLE_OFFLINE'){
		event.waitUntil(
			setOfflineEnabled(false).then(()=>{
				if(event.ports&&event.ports[0]){
					event.ports[0].postMessage({
						ok:true
					});
				}
			})
		);
		return;
	}

	if(data.type==='CACHE_URL'&&data.url){
		event.waitUntil(
			(async()=>{
				try{
					const cache=await caches.open(CACHE_NAME);
					const request=new Request(
						data.url,
						{cache:'reload'}
					);
					const response=await fetch(request);
					if(!response.ok){
						throw new Error(
							`Could not cache ${data.url}: HTTP ${response.status}`
						);
					}

					await cache.put(
						data.url,
						response.clone()
					);
					await cacheAppShell();
					if(event.ports&&event.ports[0]){
						event.ports[0].postMessage({
							ok:true
						});
					}
				}catch(error){
					if(event.ports&&event.ports[0]){
						event.ports[0].postMessage({
							ok:false,
							error:String(
								error&&error.message
									?error.message
									:error
							)
						});
					}
				}
			})()
		);
		return;
	}

	if(data.type==='CLEAR_CACHE'){
		event.waitUntil(
			setOfflineEnabled(false).then(()=>{
				if(event.ports&&event.ports[0]){
					event.ports[0].postMessage({
						ok:true
					});
				}
			})
		);
	}
});

self.addEventListener('fetch',event=>{
	const request=event.request;

	if(request.method==='POST'&&isShareAction(request)){
		event.respondWith(
			storeSharedFile(request).catch(error=>{
				console.error(
					'Share target handling failed:',
					error
				);
				return Response.redirect(
					new URL(
						'./?__sgml_share_error=failed',
						self.registration.scope
					).href,
					303
				);
			})
		);
		return;
	}

	if(request.method==='GET'&&isShareDataRequest(request)){
		event.respondWith(
			caches.open(SHARE_CACHE_NAME).then(async cache=>{
				const cached=await cache.match(request);

				if(cached){
					return cached;
				}
				return new Response(
					'Shared file not found.',
					{
						status:404,
						headers:{
							'Content-Type':'text/plain; charset=utf-8'
						}
					}
				);
			})
		);
		return;
	}

	if(request.method!=='GET')return;

	event.respondWith(
		(async()=>{
			const enabled=await isOfflineEnabled();
			if(!enabled)return fetch(request);

			const cache=await caches.open(CACHE_NAME);
			const cached=await cache.match(request);

			if(cached){
				return cached;
			}

			try{
				const response=await fetch(request);
				if(
					response&&
					(
						response.ok||
						response.type==='opaque'
					)
				){
					await cache.put(
						request,
						response.clone()
					);
				}

				return response;
			}catch(error){
				if(request.mode==='navigate'){
					const fallback=
						await cache.match(
							new URL('./',self.registration.scope).href
						);

					if(fallback)return fallback;
				}

				throw error;
			}
		})()
	);
});
