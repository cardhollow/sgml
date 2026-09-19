const CACHE_NAME='sgml-viewer-offline-v2';
const SHARE_CACHE_NAME='sgml-viewer-share-v1';

let offlineDisabled=true;

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
						key!==CACHE_NAME
					)
					.map(key=>caches.delete(key))
			)
		).then(()=>{
			return self.clients.claim();
		})
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
		offlineDisabled=!data.enabled;

		if(event.ports&&event.ports[0]){
			event.ports[0].postMessage({
				ok:true
			});
		}
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
		offlineDisabled=true;

		event.waitUntil(
			caches.delete(CACHE_NAME).then(()=>{
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
		offlineDisabled=true;

		event.waitUntil(
			caches.delete(CACHE_NAME).then(()=>{
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

	if(offlineDisabled){
		return;
	}

	event.respondWith(
		(async()=>{
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
							self.registration.scope
						);

					if(fallback)return fallback;
				}

				throw error;
			}
		})()
	);
});
