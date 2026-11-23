/*
 * Keyboard-aware focus centering (v13.2).
 *
 * When a typable field inside the rendered document gets focus, the page is
 * scrolled so the field sits in the middle of the *visible* area (the visual
 * viewport, i.e. what remains above the mobile virtual keyboard). When focus
 * leaves the field, the page scrolls back to where it was, unless the reader
 * scrolled by hand in the meantime.
 */
(function(){
	'use strict';

	const SCOPE='#sgml-output';
	const TYPABLE='textarea,[contenteditable="true"],input:not([type]),input[type="text"],input[type="search"],input[type="email"],input[type="url"],input[type="tel"],input[type="number"],input[type="password"]';
	const vv=window.visualViewport||null;

	let active=null;
	let originY=null;
	let userScrolled=false;
	let settleTimer=null;
	let blurTimer=null;

	function isTypable(el){
		return !!(el&&el.matches&&el.matches(TYPABLE)&&el.closest&&el.closest(SCOPE)&&!el.readOnly&&!el.disabled);
	}

	function keyboardHeight(){
		if(!vv)return 0;
		return Math.max(0,Math.round(window.innerHeight-vv.height-vv.offsetTop));
	}

	function syncKeyboardPadding(){
		const kb=keyboardHeight();
		document.documentElement.style.setProperty('--sgml-kb',kb+'px');
		document.body.classList.toggle('sgml-kb-open',kb>80&&!!active);
	}

	function centerActive(smooth){
		if(!active||!active.isConnected)return;
		syncKeyboardPadding();
		const viewTop=vv?vv.offsetTop:0;
		const viewHeight=vv?vv.height:window.innerHeight;
		const rect=active.getBoundingClientRect();
		const delta=rect.top+rect.height/2-(viewTop+viewHeight/2);
		if(Math.abs(delta)<2)return;
		window.scrollBy({top:delta,left:0,behavior:smooth?'smooth':'auto'});
	}

	function scheduleRecenter(){
		clearTimeout(settleTimer);
		// The keyboard animates in over a few hundred ms; re-centre as it settles.
		settleTimer=setTimeout(()=>centerActive(true),120);
	}

	function onFocusIn(event){
		const el=event.target;
		if(!isTypable(el))return;
		clearTimeout(blurTimer);
		if(!active){
			originY=window.scrollY;
			userScrolled=false;
		}
		active=el;
		centerActive(true);
		scheduleRecenter();
		setTimeout(()=>{if(active===el)centerActive(true);},420);
	}

	function onFocusOut(event){
		if(event.target!==active)return;
		clearTimeout(blurTimer);
		blurTimer=setTimeout(()=>{
			const next=document.activeElement;
			if(isTypable(next)){active=next;return;}
			const y=originY;
			active=null;
			originY=null;
			clearTimeout(settleTimer);
			syncKeyboardPadding();
			document.body.classList.remove('sgml-kb-open');
			if(y!==null&&!userScrolled){
				window.scrollTo({top:y,left:0,behavior:'smooth'});
			}
			userScrolled=false;
		},180);
	}

	function markUserScroll(){if(active)userScrolled=true;}

	document.addEventListener('focusin',onFocusIn);
	document.addEventListener('focusout',onFocusOut);
	// Real finger / wheel / key scrolling cancels the "go back" step.
	window.addEventListener('touchmove',markUserScroll,{passive:true});
	window.addEventListener('wheel',markUserScroll,{passive:true});
	if(vv){
		vv.addEventListener('resize',()=>{if(active){syncKeyboardPadding();scheduleRecenter();}});
	}
})();
