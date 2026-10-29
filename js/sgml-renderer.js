        function isSGMLEscapable(char){
            return "\\`,|[](){}<>".includes(char);
        }

        function decodeSGMLEscapes(str){
            if(!str)return'';
            let result='';

            for(let i=0;i<str.length;i++){
                const c=str[i];

                if(c==='\\'&&i+1<str.length&&isSGMLEscapable(str[i+1])){
                    result+=str[i+1];
                    i++;
                    continue;
                }

                result+=c;
            }

            return result;
        }

        let sgmlLiteralStore=[];
        let sgmlEscapedStore=[];

        function maskLiteralStrings(source){
            const text=String(source||'');
            let result='';
            let literal='';
            let inLiteral=false;

            const finishLiteral=()=>{
                const index=sgmlLiteralStore.length;
                sgmlLiteralStore.push(literal);
                result+=`\uE500SGMLLIT${index}\uE501`;
                literal='';
            };

            const maskEscaped=char=>{
                const index=sgmlEscapedStore.length;
                sgmlEscapedStore.push(char);
                result+=`\uE700SGMLESC${index}\uE701`;
            };

            for(let i=0;i<text.length;i++){
                const c=text[i];

                if(inLiteral){
                    if(c==='\\'&&i+1<text.length&&isSGMLEscapable(text[i+1])){
                        literal+=c+text[i+1];
                        i++;
                        continue;
                    }

                    if(c==='`'){
                        finishLiteral();
                        inLiteral=false;
                        continue;
                    }

                    literal+=c;
                    continue;
                }

                if(c==='\\'&&i+1<text.length&&isSGMLEscapable(text[i+1])){
                    maskEscaped(text[i+1]);
                    i++;
                    continue;
                }

                if(c==='`'){
                    inLiteral=true;
                    continue;
                }

                result+=c;
            }

            if(inLiteral)finishLiteral();
            return result;
        }

        function restoreLiteralHTML(str){
            return String(str||'').replace(
                /\uE500SGMLLIT(\d+)\uE501/g,
                (_,i)=>`<span class="sgml-question-literal">${escapeHTMLText(decodeSGMLEscapes(sgmlLiteralStore[Number(i)]||''))}</span>`
            );
        }

        function restoreEscapedHTML(str){
            return String(str||'').replace(
                /\uE700SGMLESC(\d+)\uE701/g,
                (_,i)=>escapeHTMLText(sgmlEscapedStore[Number(i)]||'')
            );
        }

        function extractTrueText(rawStr,{stripMarkup=true}={}){
            if(rawStr===undefined||rawStr===null)return'';

            const literalTokens=[];
            const escapedTokens=[];
            let str=String(rawStr);

            str=str.replace(
                /\uE500SGMLLIT(\d+)\uE501/g,
                (_,i)=>{
                    const token=`\uE600SGMLCMP${literalTokens.length}\uE601`;
                    literalTokens.push(sgmlLiteralStore[Number(i)]||'');
                    return token;
                }
            );

            str=str.replace(
                /\uE700SGMLESC(\d+)\uE701/g,
                (_,i)=>{
                    const token=`\uE800SGMLCMP${escapedTokens.length}\uE801`;
                    escapedTokens.push(sgmlEscapedStore[Number(i)]||'');
                    return token;
                }
            );

            if(stripMarkup){
                str=str
                    .replace(/<st\b[^>]*>/gi,'')
                    .replace(/<\/st>/gi,'')
                    .replace(/<([a-z][a-z0-9:-]*)\b[^>]*>([\s\S]*?)<\/\1>/gi,'$2')
                    .replace(/<\/?[a-z][a-z0-9:-]*\s*\/?>/gi,match=>{
                        const name=(match.match(/^<\/?([a-z][a-z0-9:-]*)/i)||[])[1]||'';
                        return /^br$/i.test(name)||/^hr$/i.test(name)?'':match;
                    });
            }

            str=str.replace(
                /\uE600SGMLCMP(\d+)\uE601/g,
                (_,i)=>decodeSGMLEscapes(literalTokens[Number(i)]||'')
            );

            str=str.replace(
                /\uE800SGMLCMP(\d+)\uE801/g,
                (_,i)=>escapedTokens[Number(i)]||''
            );

            str=decodeSGMLEscapes(str);
            str=str.replace(/[*_~`#]/g,'');
            return str.trim();
        }

		function splitByChar(str,charToSplit){
			if(!str)return[];

			const result=[];
			let current='';
			let depth=0;
			let inBackticks=false;

			for(let i=0;i<str.length;i++){
				const c=str[i];

				if(c==='\\'&&i+1<str.length&&isSGMLEscapable(str[i+1])){
					current+=c+str[i+1];
					i++;
					continue;
				}

				if(c==='`'){
					inBackticks=!inBackticks;
					current+=c;
					continue;
				}

				if(!inBackticks){
					if(c==='<'||c==='['||c==='('||c==='{')depth++;
					else if(c==='>'||c===']'||c===')'||c==='}')depth--;

					if(c===charToSplit&&depth===0){
						result.push(current.trim());
						current='';
						continue;
					}
				}

				current+=c;
			}

			if(current.trim())result.push(current.trim());
			return result;
		}

		function extractBalanced(text,startIdx,openChar,closeChar){
			let count=0;
			let content='';
			let inBackticks=false;

			for(let i=startIdx;i<text.length;i++){
				const c=text[i];

				if(c==='\\'&&i+1<text.length&&isSGMLEscapable(text[i+1])){
					content+=c+text[i+1];
					i++;
					continue;
				}

				if(c==='`'){
					inBackticks=!inBackticks;
					content+=c;
					continue;
				}

				if(inBackticks){
					content+=c;
					continue;
				}

				if(c===openChar){
					count++;
					if(count===1)continue;
				}

				if(c===closeChar){
					count--;
					if(count===0)return{content,nextIdx:i+1};
				}

				if(count>0)content+=c;
			}

			return null;
		}

		function findTagStart(source,tag,from=0){
			const re=new RegExp(`<${tag}\\b[^>]*>`,`gi`);
			re.lastIndex=from;
			const match=re.exec(source);
			return match?{index:match.index,end:re.lastIndex,open:match[0]}:null;
		}

		function findMatchingTag(source,tag,startIndex,allowNested=true){
			const tokenRegex=new RegExp(`</?${tag}\\b[^>]*>`,`gi`);
			tokenRegex.lastIndex=startIndex;

			let depth=1;
			let match;

			while((match=tokenRegex.exec(source))!==null){
				const token=match[0];

				if(/^<\//.test(token)){
					depth--;

					if(depth===0){
						return{
							content:source.slice(startIndex,match.index),
							end:tokenRegex.lastIndex
						};
					}
				}else if(allowNested){
					depth++;
				}
			}

			return null;
		}

		function extractChildren(source,tag,allowNested=false){
			const children=[];
			const spans=[];
			let pos=0;

			while(pos<source.length){
				const found=findTagStart(source,tag,pos);

				if(!found)break;

				const matched=findMatchingTag(
					source,
					tag,
					found.end,
					allowNested
				);

				if(!matched)break;

				children.push({
					open:found.open,
					content:matched.content,
					start:found.index,
					end:matched.end
				});

				spans.push({
					start:found.index,
					end:matched.end
				});

				pos=matched.end;
			}

			return{children,spans};
		}

		function removeSpans(source,spans){
			if(!spans.length)return source;

			let result='';
			let cursor=0;

			spans
				.sort((a,b)=>a.start-b.start)
				.forEach(span=>{
					result+=source.slice(cursor,span.start);
					result+='\n';
					cursor=span.end;
				});

			result+=source.slice(cursor);
			return result;
		}

		function extractICBBlocks(inputStr){
			const blocks=[];

			if(!inputStr){
				return{processedText:'',blocks};
			}

			const regex=/^~~~([^\r\n~][^\r\n]*)\r?\n([\s\S]*?)^~~~[ 	]*(?=\r?$|\n)/gm;

			const processedText=String(inputStr).replace(
				regex,
				(match,name,content)=>{
					const index=blocks.length;

					blocks.push({
						name:String(name||'ICB').trim()||'ICB',
						content:String(content||'')
					});

					return`\uE100SGMLICB${index}\uE101`;
				}
			);

			return{processedText,blocks};
		}

		function buildICBDocument(content){
			const baseHref=escapeHTMLAttribute(location.href);
			const source=String(content||'');
			const trimmed=source.trim();

			if(/^<!doctype\s+html/i.test(trimmed)||/<html\b/i.test(trimmed)){
				return source;
			}

			return`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<base href="${baseHref}">
<style>
html,body{margin:0;padding:0;min-width:0;min-height:100%;width:100%;box-sizing:border-box}
body{overflow:auto;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
*,*::before,*::after{box-sizing:border-box}
img,video,canvas,svg{max-width:none}
table{max-width:none}
</style>
</head>
<body>${source}</body>
</html>`;
		}

		function setupICB(){
			const slots=document.querySelectorAll('.sgml-icb-slot');

			slots.forEach(slot=>{
				const index=Number(slot.dataset.icbIndex);
				const block=window.__sgmlICBBlocks&&window.__sgmlICBBlocks[index];

				if(!block)return;

				const container=document.createElement('div');
				container.className='sgml-icb';
				container.style.height='320px';

				const header=document.createElement('div');
				header.className='sgml-icb-header';
				header.textContent=block.name;
				header.title=block.name;

				const content=document.createElement('div');
				content.className='sgml-icb-content';

				const iframe=document.createElement('iframe');
				iframe.setAttribute('sandbox','allow-scripts');
				iframe.setAttribute('title',`${block.name} isolated container`);
				iframe.setAttribute('loading','lazy');
				iframe.srcdoc=buildICBDocument(block.content);

				content.appendChild(iframe);

				const footer=document.createElement('div');
				footer.className='sgml-icb-footer';
				footer.setAttribute('aria-label','Resize isolated container');
				footer.title='Drag to resize';

				container.appendChild(header);
				container.appendChild(content);
				container.appendChild(footer);
				slot.replaceWith(container);

				let dragging=false;
				let startY=0;
				let startHeight=320;
				let pointerId=null;

				const getMaxHeight=()=>Math.max(160,window.innerHeight-32);

				const onPointerMove=event=>{
					if(!dragging)return;
					if(pointerId!==null&&event.pointerId!==pointerId)return;

					const delta=event.clientY-startY;
					const newHeight=Math.max(
						160,
						Math.min(getMaxHeight(),startHeight+delta)
					);

					container.style.height=`${newHeight}px`;
				};

				const endDrag=event=>{
					if(pointerId!==null&&event.pointerId!==pointerId)return;

					dragging=false;
					footer.classList.remove('dragging');

					if(footer.hasPointerCapture&&pointerId!==null&&footer.hasPointerCapture(pointerId)){
						footer.releasePointerCapture(pointerId);
					}

					pointerId=null;

					window.removeEventListener('pointermove',onPointerMove);
					window.removeEventListener('pointerup',endDrag);
					window.removeEventListener('pointercancel',endDrag);
				};

				footer.addEventListener('pointerdown',event=>{
					event.preventDefault();

					dragging=true;
					startY=event.clientY;
					startHeight=container.getBoundingClientRect().height;
					pointerId=event.pointerId;
					footer.classList.add('dragging');

					if(footer.setPointerCapture){
						try{footer.setPointerCapture(event.pointerId)}catch(_){}
					}

					window.addEventListener('pointermove',onPointerMove);
					window.addEventListener('pointerup',endDrag);
					window.addEventListener('pointercancel',endDrag);
				});
			});
		}

		function renderST(str){
			if(!str)return'';

			return String(str)
				.replace(/<st\s+([^>]*?)>/gi,(m,a)=>{
					const rules=[];

					a.trim().split(/\s+/).forEach(p=>{
						const i=p.indexOf(':');
						if(i<0)return;

						let k=p.slice(0,i).trim();
						let v=p.slice(i+1).trim();

						if(k==='col')k='color';
						else if(k==='bg')k='background-color';
						else if(k==='fontSize')k='font-size';
						else if(k==='fontFamily')k='font-family';

						rules.push(`${k}:${v}`);
					});

					return`<span style="${rules.join(';')}">`;
				})
				.replace(/<\/st>/gi,'</span>');
		}

		function escapeHTMLAttribute(str){
			return String(str)
				.replace(/&/g,'&amp;')
				.replace(/"/g,'&quot;')
				.replace(/</g,'&lt;')
				.replace(/>/g,'&gt;');
		}

		function escapeHTMLText(str){
			return String(str)
				.replace(/&/g,'&amp;')
				.replace(/</g,'&lt;')
				.replace(/>/g,'&gt;')
				.replace(/"/g,'&quot;');
		}

		function renderMarkdown(mdText){
			if(!mdText)return'';

			const savedRefs=[];
			const saved=[];
			let source=String(mdText);

			source=maskLiteralStrings(source);

			source=source
				.replace(
					/<ref\s+id\s*:\s*"([^"]*)"\s*\/>/gi,
					(match,id)=>{
						const index=savedRefs.length;
						savedRefs.push({type:'target',id});
						return`\uE000SGMLREF${index}\uE001`;
					}
				)
				.replace(
					/<ref\s+id\s*:\s*"([^"]*)"\s*>([\s\S]*?)<\/ref>/gi,
					(match,id,content)=>{
						const index=savedRefs.length;
						savedRefs.push({type:'link',id,content});
						return`\uE000SGMLREF${index}\uE001`;
					}
				)
				.replace(
					/<st\b[^>]*>|<\/st>/gi,
					tag=>{
						const id=saved.length;
						saved.push(tag);
						return`\uE000SGMLST${id}\uE001`;
					}
				);

			let result=marked.parse(source,{gfm:true,breaks:true});

			result=result.replace(
				/\uE000SGMLST(\d+)\uE001/g,
				(_,i)=>saved[Number(i)]||''
			);

			result=result.replace(
				/\uE000SGMLREF(\d+)\uE001/g,
				(_,i)=>{
					const ref=savedRefs[Number(i)];
					if(!ref)return'';

					const id=escapeHTMLAttribute(ref.id);
					if(ref.type==='target')return`<a id="${id}" class="sgml-ref"></a>`;
					return`<a href="#${id}" class="sgml-ref">${renderMarkdown(ref.content)}</a>`;
				}
			);

			result=restoreLiteralHTML(result);
			result=restoreEscapedHTML(result);
			return renderST(result);
		}

		function buildQuestionUI(q){
			if(q.type==='choices')return buildChoicesHTML(q);
			if(q.type==='fillin')return buildFillinHTML(q);
			if(q.type==='enumeration')return buildEnumerationHTML(q);
			if(q.type==='connect')return buildConnectHTML(q);
			if(q.type==='flashcard')return buildFlashcardHTML(q);
			return'';
		}

		function parseQuestionBlocks(inputStr){
			const questions=[];
			let i=0;
			let output='';

			while(i<inputStr.length){
				const connectMatch=inputStr.slice(i).match(/^<connect\s*:\s*/i);
				const flashMatch=inputStr.slice(i).match(/^<flashcard\s*:?\s*/i);
				const normalMatch=inputStr.slice(i).match(/^<(Choices|Fillin|Enumeration):/i);

				if(connectMatch){
					try{
						const parsed=parseConnectAt(inputStr,i);
						if(parsed){
							const qId='sgmlq'+questionCounter++;
							questions.push({
								id:qId,
								type:'connect',
								questionRaw:parsed.question,
								left:parsed.left,
								right:parsed.right,
								answers:parsed.answers,
								attrs:parsed.attrs
							});
							output+=`\n\n%%QBLOCKTOKEN${qId}%%\n\n`;
							i=parsed.end;
							continue;
						}
					}catch(error){
						console.error('Connect parse error:',error);
					}
				}

				if(flashMatch){
					try{
						const parsed=parseFlashcardAt(inputStr,i);
						if(parsed){
							const qId='sgmlq'+questionCounter++;
							questions.push({
								id:qId,
								type:'flashcard',
								title:parsed.title,
								questions:parsed.questions,
								answers:parsed.answers,
								attrs:parsed.attrs
							});
							output+=`\n\n%%QBLOCKTOKEN${qId}%%\n\n`;
							i=parsed.end;
							continue;
						}
					}catch(error){
						console.error('Flashcard parse error:',error);
					}
				}

				if(normalMatch){
					const type=normalMatch[1];
					let cur=i+normalMatch[0].length;
					while(cur<inputStr.length&&/\s/.test(inputStr[cur]))cur++;

					if(inputStr[cur]==='('){
						const qRes=extractBalanced(inputStr,cur,'(',')');
						if(qRes){
							cur=qRes.nextIdx;
							while(cur<inputStr.length&&/\s/.test(inputStr[cur]))cur++;

							if(inputStr[cur]==='['){
								const aRes=extractBalanced(inputStr,cur,'[',']');
								if(aRes){
									cur=aRes.nextIdx;
									while(cur<inputStr.length&&/\s/.test(inputStr[cur]))cur++;

									if(inputStr[cur]==='{'){
										const cRes=extractBalanced(inputStr,cur,'{','}');
										if(cRes){
											cur=cRes.nextIdx;
											while(cur<inputStr.length&&/\s/.test(inputStr[cur]))cur++;

											if(inputStr[cur]==='>'){
												cur++;
												const qId='sgmlq'+questionCounter++;
												questions.push({
													id:qId,
													type:type.toLowerCase(),
													questionRaw:qRes.content,
													answersRaw:aRes.content,
													correctAndPropsRaw:cRes.content
												});
												output+=`\n\n%%QBLOCKTOKEN${qId}%%\n\n`;
												i=cur;
												continue;
											}
										}
									}
								}
							}
						}
					}
				}

				output+=inputStr[i];
				i++;
			}

			return{processedText:output,questions};
		}

		function parsePropsAndAnswers(correctAndPropsRaw,answersList){
			const result={
				props:{
					case:false,
					inorder:false,
					count:null,
					type:null
				},
				correctAnswers:[]
			};

			const segments=splitByChar(correctAndPropsRaw,'|');

			segments.forEach(seg=>{
				const propMatch=seg.match(/^([a-zA-Z]+)\s*:\s*(.+)$/);

				if(propMatch){
					const key=propMatch[1].toLowerCase();
					const val=propMatch[2].trim().toLowerCase();

					if(key==='case')result.props.case=val==='true';
					else if(key==='inorder')result.props.inorder=val==='true';
					else if(key==='count')result.props.count=parseInt(val,10);
					else if(key==='type')result.props.type=val;
					else if(key==='order'&&val==='true')result.props.type='order';
				}else{
					const idxMatches=[...seg.matchAll(/\[idx:(\d+)\]/gi)];

					if(idxMatches.length){
						idxMatches.forEach(m=>{
							const idx=parseInt(m[1],10);
							if(answersList[idx]!==undefined)result.correctAnswers.push(answersList[idx]);
						});
					}else if(seg){
						result.correctAnswers.push(...splitByChar(seg,','));
					}
				}
			});

			if(result.correctAnswers.length===0&&answersList.length){
				result.correctAnswers=[...answersList];
			}

			return result;
		}

		function renderQuestionText(source){
			return renderEmbeddedSGML(String(source||''));
		}


		function splitTopLevelListFlexible(raw,char=','){
			return splitByChar(String(raw||''),char).filter(v=>v.trim()!=='');
		}

		function decodeInteractiveValue(raw){
			let value=String(raw===undefined||raw===null?'':raw).trim();
			if(value.length>=2&&value[0]==='`'&&value[value.length-1]==='`'){
				value=value.slice(1,-1);
			}
			return decodeSGMLEscapes(value);
		}

		function parseSimpleAttributeMap(raw){
			const attrs={};
			for(const part of splitByChar(String(raw||''),',')){
				if(!part)continue;
				const i=part.indexOf(':');
				if(i<0)continue;
				const key=part.slice(0,i).trim().toLowerCase();
				let value=part.slice(i+1).trim();
				if(/^true$/i.test(value))value=true;
				else if(/^false$/i.test(value))value=false;
				else if(/^[-+]?\d+(?:\.\d+)?$/.test(value))value=Number(value);
				attrs[key]=value;
			}
			return attrs;
		}

		function parseNestedBracketItems(raw){
			const text=String(raw||'').trim();
			const values=[];
			let pos=0;
			while(pos<text.length){
				while(pos<text.length&&/[\s,]/.test(text[pos]))pos++;
				if(pos>=text.length)break;
				if(text[pos]!=='[')return null;
				const part=extractBalanced(text,pos,'[',']');
				if(!part)return null;
				values.push(decodeInteractiveValue(part.content));
				pos=part.nextIdx;
			}
			return values.length?values:null;
		}

		function parseConnectColumnsIntegrated(raw){
			const first=extractBalanced(raw.trim(),0,'[',']');
			if(!first)throw new Error('Could not parse Connect column 1.');
			const rest=raw.slice(first.nextIdx).trim();
			const second=extractBalanced(rest,0,'[',']');
			if(!second)throw new Error('Could not parse Connect column 2.');

			const parseList=part=>splitByChar(part,',').map(decodeInteractiveValue);
			return{left:parseList(first.content),right:parseList(second.content)};
		}

		function parseConnectAnswersIntegrated(raw){
			const answers=[];
			let pos=0;
			while(pos<String(raw||'').length){
				const text=String(raw||'');
				while(pos<text.length&&/[\s,]/.test(text[pos]))pos++;
				if(pos>=text.length)break;
				if(text[pos]!=='['||text[pos+1]!=='['){
					throw new Error('Connect answers must use [[idx:n][idx:n]].');
				}
				const outer=extractBalanced(text,pos,'[',']');
				if(!outer)throw new Error('Unclosed Connect answer pair.');
				const inner=outer.content.trim();
				const a=extractBalanced(inner,0,'[',']');
				if(!a)throw new Error('Invalid first Connect answer index.');
				const b=extractBalanced(inner.slice(a.nextIdx).trim(),0,'[',']');
				if(!b)throw new Error('Invalid second Connect answer index.');
				const m1=a.content.match(/^\s*idx\s*:\s*(\d+)\s*$/i);
				const m2=b.content.match(/^\s*idx\s*:\s*(\d+)\s*$/i);
				if(!m1||!m2)throw new Error('Connect answers must use [idx:n][idx:n].');
				answers.push({left:Number(m1[1]),right:Number(m2[1])});
				pos=outer.nextIdx;
			}
			return answers;
		}

		function parseConnectAt(text,startIndex){
			const source=String(text||'');
			const head=source.slice(startIndex).match(/^<connect\s*:\s*/i);
			if(!head)return null;
			let cur=startIndex+head[0].length;

			while(/\s/.test(source[cur]||''))cur++;
			if(source[cur]!=='(')throw new Error('Connect is missing question (...).');
			const q=extractBalanced(source,cur,'(',')');
			if(!q)throw new Error('Unclosed Connect question.');
			cur=q.nextIdx;

			while(/\s/.test(source[cur]||''))cur++;
			if(source[cur]!=='[')throw new Error('Connect is missing columns [[...][...]].');
			const cols=extractBalanced(source,cur,'[',']');
			if(!cols)throw new Error('Unclosed Connect columns.');
			cur=cols.nextIdx;

			while(/\s/.test(source[cur]||''))cur++;
			if(source[cur]!=='{')throw new Error('Connect is missing attributes {...}.');
			const body=extractBalanced(source,cur,'{','}');
			if(!body)throw new Error('Unclosed Connect {...}.');
			cur=body.nextIdx;

			while(/\s/.test(source[cur]||''))cur++;
			if(source[cur]!=='>' )throw new Error('Connect is missing closing >.');
			cur++;

			const parts=splitByChar(body.content,'|');
			const answersPart=(parts.shift()||'').trim();
			const attrsRaw=parts.join('|').trim();
			const answersText=answersPart.replace(/^answers\s*:\s*/i,'').trim();
			const columns=parseConnectColumnsIntegrated(cols.content);
			const answers=parseConnectAnswersIntegrated(answersText);
			for(const pair of answers){
				if(pair.left<0||pair.left>=columns.left.length||pair.right<0||pair.right>=columns.right.length){
					throw new Error(`Connect answer index out of range: [${pair.left}] -> [${pair.right}]`);
				}
			}

			return{
				end:cur,
				question:decodeInteractiveValue(q.content),
				left:columns.left.map((value,index)=>({text:value,index})),
				right:columns.right.map((value,index)=>({text:value,index})),
				answers,
				attrs:parseSimpleAttributeMap(attrsRaw)
			};
		}

		function shuffleArrayCopy(array){
			const a=array.slice();
			for(let i=a.length-1;i>0;i--){
				const j=Math.floor(Math.random()*(i+1));
				[a[i],a[j]]=[a[j],a[i]];
			}
			return a;
		}

		function getConnectState(qId){
			const q=parsedQuestions[qId];
			return q&&q.type==='connect'?q:null;
		}

		function getConnectConnection(qId,side,index){
			const q=getConnectState(qId);
			if(!q)return null;
			return q.connections.find(pair=>pair[side]===index)||null;
		}

		function removeConnectConnection(qId,leftIdx,rightIdx){
			const q=getConnectState(qId);
			if(!q)return;
			q.connections=q.connections.filter(pair=>!(pair[0]===leftIdx&&pair[1]===rightIdx));
		}

		function toggleConnectLeft(qId,index){
			const q=getConnectState(qId);
			if(!q)return;
			const existing=getConnectConnection(qId,0,index);
			if(existing){
				removeConnectConnection(qId,existing[0],existing[1]);
				q.selectedLeft=null;
				q.selectedRight=null;
				drawConnectLines(qId);
				updateConnectItemClasses(qId);
				return;
			}
			q.selectedLeft=index;
			q.selectedRight=null;
			updateConnectItemClasses(qId);
		}

		function toggleConnectRight(qId,index){
			const q=getConnectState(qId);
			if(!q)return;
			const existing=getConnectConnection(qId,1,index);
			if(existing){
				removeConnectConnection(qId,existing[0],existing[1]);
				q.selectedLeft=null;
				q.selectedRight=null;
				drawConnectLines(qId);
				updateConnectItemClasses(qId);
				return;
			}
			if(q.selectedLeft===null)return;
			const old=getConnectConnection(qId,1,index);
			if(old)removeConnectConnection(qId,old[0],old[1]);
			removeConnectConnection(qId,q.selectedLeft,index);
			q.connections.push([q.selectedLeft,index]);
			q.selectedLeft=null;
			q.selectedRight=null;
			drawConnectLines(qId);
			updateConnectItemClasses(qId);
		}

		function updateConnectItemClasses(qId){
			const q=getConnectState(qId);
			const box=document.getElementById(qId);
			if(!q||!box)return;
			box.querySelectorAll('.sgml-connect-item.left').forEach(el=>{
				const idx=Number(el.dataset.idx);
				el.classList.toggle('selected',q.selectedLeft===idx);
				el.classList.toggle('matched',!!getConnectConnection(qId,0,idx));
			});
			box.querySelectorAll('.sgml-connect-item.right').forEach(el=>{
				const idx=Number(el.dataset.idx);
				el.classList.toggle('selected',q.selectedRight===idx);
				el.classList.toggle('matched',!!getConnectConnection(qId,1,idx));
			});
		}

		function drawConnectLines(qId){
			const q=getConnectState(qId);
			const box=document.getElementById(qId);
			if(!q||!box)return;
			const board=box.querySelector('.sgml-connect-board');
			const svg=box.querySelector('.sgml-connect-lines');
			if(!board||!svg)return;
			const rect=board.getBoundingClientRect();
			svg.setAttribute('viewBox',`0 0 ${rect.width} ${rect.height}`);
			svg.innerHTML='';
			for(const [li,ri] of q.connections){
				const left=box.querySelector(`.sgml-connect-item.left[data-idx="${li}"]`);
				const right=box.querySelector(`.sgml-connect-item.right[data-idx="${ri}"]`);
				if(!left||!right)continue;
				const a=left.getBoundingClientRect();
				const b=right.getBoundingClientRect();
				const x1=a.right-rect.left;
				const y1=a.top+a.height/2-rect.top;
				const x2=b.left-rect.left;
				const y2=b.top+b.height/2-rect.top;
				const bend=Math.max(24,(x2-x1)*0.45);
				const path=document.createElementNS('http://www.w3.org/2000/svg','path');
				path.setAttribute('d',`M ${x1} ${y1} C ${x1+bend} ${y1}, ${x2-bend} ${y2}, ${x2} ${y2}`);
				path.setAttribute('fill','none');
				path.setAttribute('stroke','#2563eb');
				path.setAttribute('stroke-width','3');
				path.setAttribute('stroke-linecap','round');
				svg.appendChild(path);
			}
			const status=box.querySelector('.sgml-connect-status');
			if(status)status.textContent=`${q.connections.length} connection${q.connections.length===1?'':'s'} made.`;
		}

		function flashWrongConnectPair(qId,leftIdx,rightIdx){
			const box=document.getElementById(qId);
			if(!box)return;
			const left=box.querySelector(`.sgml-connect-item.left[data-idx="${leftIdx}"]`);
			const right=box.querySelector(`.sgml-connect-item.right[data-idx="${rightIdx}"]`);
			[left,right].forEach(el=>{
				if(!el)return;
				el.classList.remove('flash-wrong');
				void el.offsetWidth;
				el.classList.add('flash-wrong');
				setTimeout(()=>el.classList.remove('flash-wrong'),700);
			});
		}

		function checkConnectAnswer(qId){
			const q=getConnectState(qId);
			if(!q)return;
			const box=document.getElementById(qId);
			const feedback=box?box.querySelector('.sgml-feedback'):null;
			box&&box.querySelectorAll('.sgml-connect-item').forEach(el=>el.classList.remove('flash-wrong'));
			const expected=new Set(q.answers.map(pair=>`${pair.left}:${pair.right}`));
			const actual=new Set(q.connections.map(pair=>`${pair[0]}:${pair[1]}`));

			if(actual.size<expected.size||q.connections.length<q.left.length){
				if(feedback){feedback.className='sgml-feedback incorrect';feedback.textContent='Connect all items first.';}
				return;
			}

			let correct=0;
			for(const key of actual){if(expected.has(key))correct++;}
			const allCorrect=correct===expected.size&&actual.size===expected.size;
			if(!allCorrect){
				for(const [left,right] of q.connections){
					if(!expected.has(`${left}:${right}`))flashWrongConnectPair(qId,left,right);
				}
			}
			if(feedback){
				feedback.className='sgml-feedback '+(allCorrect?'correct':'incorrect');
				feedback.textContent=allCorrect?'Correct!':'Incorrect!';
			}
		}

		function resetConnect(qId){
			const q=getConnectState(qId);
			const old=document.getElementById(qId);
			if(!q||!old)return;
			const wrapper=document.createElement('div');
			wrapper.innerHTML=buildConnectHTML({
				id:qId,
				questionRaw:q.questionRaw,
				left:q.left,
				right:q.right,
				answers:q.answers,
				attrs:q.attrs
			});
			const replacement=wrapper.firstElementChild;
			if(!replacement)return;
			old.replaceWith(replacement);
			setupConnectComponents();
			requestAnimationFrame(()=>drawConnectLines(qId));
		}

		function buildConnectHTML(q){
			const attrs=q.attrs||{};
			const displayLeft=attrs.shuffle===true?shuffleArrayCopy(q.left):q.left.slice();
			const displayRight=attrs.shuffle===true?shuffleArrayCopy(q.right):q.right.slice();
			parsedQuestions[q.id]={
				type:'connect',
				questionRaw:q.questionRaw,
				left:q.left,
				right:q.right,
				answers:q.answers,
				attrs,
				displayLeft,
				displayRight,
				connections:[],
				selectedLeft:null,
				selectedRight:null
			};

			const leftHTML=displayLeft.map(item=>`<div class="sgml-connect-item left" data-idx="${item.index}"><span class="idx">${item.index}</span><span>${renderQuestionText(item.text)}</span></div>`).join('');
			const rightHTML=displayRight.map(item=>`<div class="sgml-connect-item right" data-idx="${item.index}"><span class="idx">${item.index}</span><span>${renderQuestionText(item.text)}</span></div>`).join('');

			return`\
				<div class="sgml-qblock sgml-connect" id="${q.id}">\
					<div class="sgml-qtitle">${renderQuestionText(q.questionRaw)}</div>\
					<div class="sgml-connect-board">\
						<svg class="sgml-connect-lines" aria-hidden="true"></svg>\
						<div class="sgml-connect-column">\
							<div class="sgml-connect-heading">Column 1</div>\
							${leftHTML}\
						</div>\
						<div class="sgml-connect-column">\
							<div class="sgml-connect-heading">Column 2</div>\
							${rightHTML}\
						</div>\
					</div>\
					<div class="sgml-connect-status">0 connections made.</div>\
					<div class="sgml-controls">\
						<button type="button" onclick="checkConnectAnswer('${q.id}')">Check Answer</button>\
						<button type="button" onclick="resetConnect('${q.id}')">Reset</button>\
						<span class="sgml-feedback" id="fb_${q.id}"></span>\
					</div>\
				</div>`;
		}

		function setupConnectComponents(){
			document.querySelectorAll('.sgml-connect').forEach(box=>{
				const qId=box.id;
				box.querySelectorAll('.sgml-connect-item.left').forEach(item=>{
					if(item.dataset.bound==='true')return;
					item.dataset.bound='true';
					item.addEventListener('click',()=>toggleConnectLeft(qId,Number(item.dataset.idx)));
				});
				box.querySelectorAll('.sgml-connect-item.right').forEach(item=>{
					if(item.dataset.bound==='true')return;
					item.dataset.bound='true';
					item.addEventListener('click',()=>toggleConnectRight(qId,Number(item.dataset.idx)));
				});
				requestAnimationFrame(()=>drawConnectLines(qId));
			});
			if(!window.__sgmlConnectResizeBound){
				window.__sgmlConnectResizeBound=true;
				window.addEventListener('resize',()=>{
					document.querySelectorAll('.sgml-connect').forEach(box=>drawConnectLines(box.id));
				});
			}
		}

		function parseFlashcardListIntegrated(raw){
			const text=String(raw||'').trim();
			if(!text)return[];

			// Supports: [a,b,c], [a][b][c], and [[a][b][c]].
			if(text[0]==='['){
				const outer=extractBalanced(text,0,'[',']');
				if(outer&&outer.nextIdx===text.length){
					const inner=outer.content.trim();
					const grouped=parseNestedBracketItems(inner);
					if(grouped)return grouped;
					return splitByChar(inner,',').map(decodeInteractiveValue);
				}

				const grouped=parseNestedBracketItems(text);
				if(grouped)return grouped;
			}

			return splitByChar(text,',').map(decodeInteractiveValue);
		}

		function parseFlashcardAnswersIntegrated(raw){
			return parseFlashcardListIntegrated(raw);
		}

		function parseFlashcardQuestionsIntegrated(raw){
			return parseFlashcardListIntegrated(raw);
		}

		function parseFlashcardAt(text,startIndex){
			const source=String(text||'');
			const head=source.slice(startIndex).match(/^<flashcard\s*:?\s*/i);
			if(!head)return null;
			let cur=startIndex+head[0].length;
			while(/\s/.test(source[cur]||''))cur++;
			if(source[cur]!=='(')throw new Error('Flashcard is missing title (...).');
			const title=extractBalanced(source,cur,'(',')');
			if(!title)throw new Error('Unclosed Flashcard title.');
			cur=title.nextIdx;
			while(/\s/.test(source[cur]||''))cur++;
			if(source[cur]!=='[')throw new Error('Flashcard is missing questions [...].');
			const questions=extractBalanced(source,cur,'[',']');
			if(!questions)throw new Error('Unclosed Flashcard questions.');
			cur=questions.nextIdx;
			while(/\s/.test(source[cur]||''))cur++;
			if(source[cur]!=='{')throw new Error('Flashcard is missing answers {...}.');
			const body=extractBalanced(source,cur,'{','}');
			if(!body)throw new Error('Unclosed Flashcard answers.');
			cur=body.nextIdx;
			while(/\s/.test(source[cur]||''))cur++;
			if(source[cur]!=='>')throw new Error('Flashcard is missing closing >.');
			cur++;

			const parts=splitByChar(body.content,'|');
			const answersPart=(parts.shift()||'').trim();
			const attrsRaw=parts.join('|').trim();
			const answersText=answersPart.replace(/^answers\s*:\s*/i,'').trim();
			const questionList=parseFlashcardQuestionsIntegrated(questions.content);
			const answerList=parseFlashcardAnswersIntegrated(answersText);
			if(questionList.length!==answerList.length){
				throw new Error(`Flashcard needs the same number of questions and answers (${questionList.length} questions, ${answerList.length} answers).`);
			}

			return{
				end:cur,
				title:decodeInteractiveValue(title.content),
				questions:questionList.map((value,index)=>({text:value,index})),
				answers:answerList.map((value,index)=>({text:value,index})),
				attrs:parseSimpleAttributeMap(attrsRaw)
			};
		}

		function getFlashcardState(qId){
			const q=parsedQuestions[qId];
			return q&&q.type==='flashcard'?q:null;
		}

		function renderFlashcardCurrent(qId){
			const q=getFlashcardState(qId);
			const box=document.getElementById(qId);
			if(!q||!box)return;
			const progress=box.querySelector('.sgml-flashcard-progress');
			const card=box.querySelector('.sgml-flashcard-card');
			const front=box.querySelector('.sgml-flashcard-front');
			const back=box.querySelector('.sgml-flashcard-back');
			const summary=box.querySelector('.sgml-flashcard-summary');
			const controls=box.querySelector('.sgml-flashcard-controls');
			const navigation=box.querySelector('.sgml-flashcard-navigation');
			const previousButton=box.querySelector('.sgml-flashcard-prev');
			const nextButton=box.querySelector('.sgml-flashcard-next');
			const shuffleButton=box.querySelector('.sgml-flashcard-shuffle');
			if(!q.deck.length){
				if(progress)progress.textContent='No flashcards.';
				if(card)card.style.display='none';
				if(controls)controls.style.display='none';
				if(navigation)navigation.style.display='none';
				return;
			}
			if(navigation)navigation.style.display='flex';
			if(previousButton)previousButton.disabled=q.position<=0;
			if(nextButton)nextButton.disabled=q.position>=q.deck.length;
			if(shuffleButton)shuffleButton.style.display=q.attrs.shuffle===true?'inline-block':'none';
			if(q.position>=q.deck.length){
				if(progress)progress.textContent='Finished.';
				if(card)card.style.display='none';
				if(controls)controls.style.display='none';
				if(summary){
					summary.style.display='block';
					summary.innerHTML=`Finished. <strong>${q.correct}</strong> Correct, <strong>${q.wrong}</strong> Wrong, <strong>${q.skipped}</strong> Skipped.`+
						` <button type="button" onclick="restartFlashcards('${qId}')">Restart</button>`;
				}
				return;
			}
			const pair=q.deck[q.position];
			if(progress)progress.textContent=`Card ${q.position+1} of ${q.deck.length}`;
			if(front)front.innerHTML=renderQuestionText(pair.front);
			if(back)back.innerHTML=renderQuestionText(pair.back);
			if(card){
				card.style.display='flex';
				card.classList.remove('flashcard-anim-correct','flashcard-anim-wrong','flashcard-anim-skip','flashcard-anim-next','flashcard-anim-prev');
				card.classList.toggle('revealed',q.revealed);
				card.setAttribute('aria-expanded',q.revealed?'true':'false');
			}
			if(summary)summary.style.display='none';
			if(controls)controls.style.display='flex';
		}

		function animateFlashcard(qId,animationClass,callback){
			const q=getFlashcardState(qId);
			const box=document.getElementById(qId);
			const card=box&&box.querySelector('.sgml-flashcard-card');
			if(!q||!box||!card||q.animating)return;
			q.animating=true;
			card.classList.remove('flashcard-anim-correct','flashcard-anim-wrong','flashcard-anim-skip','flashcard-anim-next','flashcard-anim-prev');
			void card.offsetWidth;
			card.classList.add(animationClass);
			setTimeout(()=>{
				card.classList.remove(animationClass);
				q.animating=false;
				callback();
			},animationClass==='flashcard-anim-next'||animationClass==='flashcard-anim-prev'?300:animationClass==='flashcard-anim-wrong'?560:animationClass==='flashcard-anim-correct'?500:420);
		}

		function previousFlashcard(qId){
			const q=getFlashcardState(qId);
			if(!q||q.position<=0||q.animating)return;
			animateFlashcard(qId,'flashcard-anim-prev',()=>{
				q.position--;
				q.revealed=false;
				renderFlashcardCurrent(qId);
			});
		}

		function nextFlashcard(qId){
			const q=getFlashcardState(qId);
			if(!q||q.position>=q.deck.length||q.animating)return;
			animateFlashcard(qId,'flashcard-anim-next',()=>{
				q.position++;
				q.revealed=false;
				renderFlashcardCurrent(qId);
			});
		}

		function shuffleFlashcards(qId){
			const q=getFlashcardState(qId);
			if(!q||q.attrs.shuffle!==true||q.animating)return;
			q.deck=shuffleArrayCopy(q.baseDeck);
			q.position=0;
			q.revealed=false;
			renderFlashcardCurrent(qId);
		}

		function toggleFlashcard(qId){
			const q=getFlashcardState(qId);
			if(!q||q.position>=q.deck.length||q.animating)return;
			q.revealed=!q.revealed;
			renderFlashcardCurrent(qId);
		}

		function revealFlashcard(qId){
			const q=getFlashcardState(qId);
			if(!q||q.position>=q.deck.length||q.animating)return;
			q.revealed=true;
			renderFlashcardCurrent(qId);
		}

		function rateFlashcard(qId,rating){
			const q=getFlashcardState(qId);
			if(!q||q.position>=q.deck.length||q.animating)return;
			const animationClass=
				rating==='correct'?'flashcard-anim-correct':
				rating==='wrong'?'flashcard-anim-wrong':
				rating==='skip'?'flashcard-anim-skip':'';
			if(!animationClass)return;
			animateFlashcard(qId,animationClass,()=>{
				if(rating==='correct')q.correct++;
				else if(rating==='wrong')q.wrong++;
				else if(rating==='skip')q.skipped++;
				q.position++;
				q.revealed=false;
				renderFlashcardCurrent(qId);
			});
		}

		function restartFlashcards(qId){
			const q=getFlashcardState(qId);
			if(!q||q.animating)return;
			q.position=0;
			q.correct=0;
			q.wrong=0;
			q.skipped=0;
			q.revealed=false;
			if(q.attrs.shuffle===true)q.deck=shuffleArrayCopy(q.baseDeck);
			else q.deck=q.baseDeck.slice();
			renderFlashcardCurrent(qId);
		}

		function buildFlashcardHTML(q){
			const attrs=q.attrs||{};
			const baseDeck=q.questions.map((question,index)=>({front:question.text,back:q.answers[index].text,index}));
			const deck=attrs.shuffle===true?shuffleArrayCopy(baseDeck):baseDeck.slice();
			parsedQuestions[q.id]={
				type:'flashcard',
				title:q.title,
				baseDeck,
				deck,
				attrs,
				position:0,
				correct:0,
				wrong:0,
				skipped:0,
				revealed:false,
				animating:false
			};
			const card=deck[0];
			return`\
				<div class="sgml-qblock sgml-flashcard" id="${q.id}">\
					<div class="sgml-flashcard-title">${renderQuestionText(q.title)}</div>\
					<div class="sgml-flashcard-progress">Card 1 of ${deck.length}</div>\
					<div class="sgml-flashcard-card" role="button" tabindex="0" aria-expanded="false" onclick="toggleFlashcard('${q.id}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleFlashcard('${q.id}');}">\
						<div class="sgml-flashcard-inner">\
							<div class="sgml-flashcard-face sgml-flashcard-front-face">\
								<div class="sgml-flashcard-front">${renderQuestionText(card?card.front:'')}</div>\
								<div class="sgml-flashcard-hint">Tap the card to reveal the answer.</div>\
							</div>\
							<div class="sgml-flashcard-face sgml-flashcard-back-face">\
								<div class="sgml-flashcard-back"><div class="sgml-flashcard-label">Answer</div>${renderQuestionText(card?card.back:'')}</div>\
							</div>\
						</div>\
					</div>\
					<div class="sgml-flashcard-action-row">\
						<div class="sgml-controls sgml-flashcard-controls">\
							<button type="button" onclick="event.stopPropagation();rateFlashcard('${q.id}','correct')">Correct</button>\
							<button type="button" onclick="event.stopPropagation();rateFlashcard('${q.id}','wrong')">Wrong</button>\
							<button type="button" onclick="event.stopPropagation();rateFlashcard('${q.id}','skip')">Skip</button>\
						</div>\
						<div class="sgml-flashcard-navigation">\
							<button class="sgml-flashcard-prev" type="button" aria-label="Previous card" onclick="event.stopPropagation();previousFlashcard('${q.id}')">&lt;</button>\
							<button class="sgml-flashcard-shuffle" type="button" aria-label="Shuffle flashcards" onclick="event.stopPropagation();shuffleFlashcards('${q.id}')" style="display:${attrs.shuffle===true?'inline-block':'none'}">Shuffle</button>\
							<button class="sgml-flashcard-next" type="button" aria-label="Next card" onclick="event.stopPropagation();nextFlashcard('${q.id}')">&gt;</button>\
						</div>\
					</div>\
					<div class="sgml-flashcard-summary" style="display:none"></div>\
				</div>`;
		}

		function buildSpoilerHTML(component){
			const id=`sgml-spoiler-${sgmlSpoilerIdCounter++}`;
			let content=renderEmbeddedSGML(component.content||'');

			// A spoiler behaves like an inline element. If the content rendered
			// as one normal Markdown paragraph, remove only that generated
			// paragraph wrapper so text stays in the surrounding line flow.
			content=content.replace(/^\s*<p>([\s\S]*?)<\/p>\s*$/i,'$1');

			return`<span class="sgml-spoiler" id="${id}"><span class="sgml-spoiler-content">${content}</span><span class="sgml-spoiler-overlay" role="button" tabindex="0" aria-label="Reveal spoiler" onclick="revealSpoiler('${id}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();revealSpoiler('${id}');}"></span></span>`;
		}

		function buildEncircleHTML(component){
			const attrs=parseComponentAttributes(component.open||'');
			const candidate=String(attrs.col||'#c62828').trim();
			const color=/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(candidate)?candidate:'#c62828';
			let content=renderEmbeddedSGML(component.content||'');
			content=content.replace(/^\s*<p>([\s\S]*?)<\/p>\s*$/i,'$1');
			return `<span class="sgml-encircle" style="--sgml-encircle-color:${escapeHTMLAttribute(color)}"><span class="sgml-encircle-content">${content}</span><svg class="sgml-encircle-mark" viewBox="0 0 100 42" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path d="M 7 22 C 2 11, 22 4, 47 6 C 71 2, 98 8, 95 21 C 98 31, 77 37, 52 34 C 27 38, 5 32, 7 22 Z"></path><path class="sgml-encircle-second" d="M 5 20 C 8 7, 29 7, 51 4 C 76 3, 96 10, 97 22 C 96 32, 72 36, 48 36 C 23 35, 3 30, 5 20 Z"></path></svg></span>`;
		}

		function revealSpoiler(id){
			const wrap=document.getElementById(id);
			if(!wrap)return;
			wrap.classList.add('sgml-spoiler-revealed');
			const overlay=wrap.querySelector('.sgml-spoiler-overlay');
			if(overlay)overlay.remove();
		}

		function buildChoicesHTML(q){
			const qHTML=renderQuestionText(q.questionRaw);
			const options=splitByChar(q.answersRaw,',');
			const parsed=parsePropsAndAnswers(q.correctAndPropsRaw,options);

			parsedQuestions[q.id]={
				type:'choices',
				options,
				correctAnswers:parsed.correctAnswers,
				props:parsed.props
			};

			let optionsHTML='';

			options.forEach((opt,idx)=>{
				optionsHTML+=`
					<label class="sgml-option">
						<input type="radio" name="radio_${q.id}" value="${idx}">
						<span>${renderQuestionText(opt)}</span>
					</label>`;
			});

			return`
				<div class="sgml-qblock" id="${q.id}">
					<div class="sgml-qtitle">${qHTML}</div>
					<div class="sgml-options">${optionsHTML}</div>
					<div class="sgml-controls">
						<button onclick="checkChoicesAnswer('${q.id}')">Check Answer</button>
						<span class="sgml-feedback" id="fb_${q.id}"></span>
					</div>
				</div>`;
		}

		function buildFillinHTML(q){
			const qHTML=renderQuestionText(q.questionRaw);
			const answersList=splitByChar(q.answersRaw,',');
			const parsed=parsePropsAndAnswers(q.correctAndPropsRaw,answersList);

			parsedQuestions[q.id]={
				type:'fillin',
				correctAnswers:parsed.correctAnswers,
				props:parsed.props
			};

			return`
				<div class="sgml-qblock" id="${q.id}">
					<div class="sgml-qtitle">${qHTML}</div>
					<div class="sgml-inputs">
						<input type="text" class="sgml-text-input" id="input_${q.id}" placeholder="Type answer..." autocomplete="off">
					</div>
					<div class="sgml-controls">
						<button onclick="checkFillinAnswer('${q.id}')">Check Answer</button>
						<span class="sgml-feedback" id="fb_${q.id}"></span>
					</div>
				</div>`;
		}

		function buildEnumerationHTML(q){
			const qHTML=renderQuestionText(q.questionRaw);
			const answersList=splitByChar(q.answersRaw,',');
			const parsed=parsePropsAndAnswers(q.correctAndPropsRaw,answersList);

			if(parsed.props.type==='order'){
				const items=answersList.length?answersList:parsed.correctAnswers;

				parsedQuestions[q.id]={
					type:'enum_order',
					correctAnswers:parsed.correctAnswers,
					props:parsed.props
				};

				let listItemsHTML='';

				items.forEach(item=>{
					listItemsHTML+=`
						<li class="sgml-order-item" draggable="true" data-raw="${encodeURIComponent(item)}">
							<span>${renderQuestionText(item)}</span>
							<div class="sgml-item-actions">
								<button type="button" onclick="moveOrderItem('${q.id}',this,-1)">▲</button>
								<button type="button" onclick="moveOrderItem('${q.id}',this,1)">▼</button>
							</div>
						</li>`;
				});

				return`
					<div class="sgml-qblock" id="${q.id}">
						<div class="sgml-qtitle">${qHTML}</div>
						<ul class="sgml-order-list" id="order_list_${q.id}">${listItemsHTML}</ul>
						<div class="sgml-controls">
							<button onclick="checkEnumOrderAnswer('${q.id}')">Check Order</button>
							<span class="sgml-feedback" id="fb_${q.id}"></span>
						</div>
					</div>`;
			}

			const count=parsed.props.count||parsed.correctAnswers.length||1;

			parsedQuestions[q.id]={
				type:'enum_written',
				count,
				correctAnswers:parsed.correctAnswers,
				props:parsed.props
			};

			let inputsHTML='';

			for(let i=0;i<count;i++){
				inputsHTML+=`
					<div class="sgml-enum-row">
						<span>${i+1}.</span>
						<input type="text" class="sgml-text-input input_${q.id}" placeholder="Answer ${i+1}" autocomplete="off">
					</div>`;
			}

			return`
				<div class="sgml-qblock" id="${q.id}">
					<div class="sgml-qtitle">${qHTML}</div>
					<div class="sgml-inputs">${inputsHTML}</div>
					<div class="sgml-controls">
						<button onclick="checkEnumWrittenAnswer('${q.id}')">Check Answers</button>
						<span class="sgml-feedback" id="fb_${q.id}"></span>
					</div>
				</div>`;
		}

		function normalizeComponentSource(source){
			let text=String(source||'').replace(/\r\n?/g,'\n');
			const lines=text.split('\n');
			while(lines.length&&lines[0].trim()==='')lines.shift();
			while(lines.length&&lines[lines.length-1].trim()==='')lines.pop();
			const indents=lines
				.filter(line=>line.trim())
				.map(line=>{
					const match=line.match(/^[ 	]*/);
					return match?match[0].replace(/	/g,'    ').length:0;
				});
			const minIndent=indents.length?Math.min(...indents):0;
			if(!minIndent)return lines.join('\n');
			return lines.map(line=>{
				let spaces=0;
				let i=0;
				while(i<line.length&&spaces<minIndent){
					if(line[i]==='	')spaces+=4;
					else if(line[i]===' ')spaces++;
					else break;
					i++;
				}
				return line.slice(i);
			}).join('\n');
		}

		window.__sgmlInfoStore={};
		let sgmlInfoIdCounter=0;

		function getInfoStore(){
			if(!window.__sgmlInfoStore)window.__sgmlInfoStore={};
			return window.__sgmlInfoStore;
		}

		function parseComponentAttributes(tag){
			const attrs={};
			if(!tag)return attrs;

			const names=['title','bg','col'];

			names.forEach(name=>{
				const quoted=tag.match(
					new RegExp(`${name}\\s*:\\s*"([^"]*)"`,'i')
				);

				if(quoted){
					attrs[name]=quoted[1];
					return;
				}

				const single=tag.match(
					new RegExp(`${name}\\s*:\\s*'([^']*)'`,'i')
				);

				if(single){
					attrs[name]=single[1];
					return;
				}

				const plain=tag.match(
					new RegExp(`${name}\\s*:\\s*([^\\s>]*)`,'i')
				);

				if(plain)attrs[name]=plain[1];
			});

			return attrs;
		}

		function buildInfoHTML(component,allowNested=true){
			const id=`sgml-info-${sgmlInfoIdCounter++}`;
			const attrs=parseComponentAttributes(component.open||'');
			const title=attrs.title||'Information';
			const bg=attrs.bg||'';
			const col=attrs.col||'';
			const rendered=renderEmbeddedSGML(
				component.content||'',
				{
					allowInfo:allowNested,
					allowRoot:true,
					allowLine:true
				}
			);

			getInfoStore()[id]={
				content:rendered,
				title,
				bg,
				col
			};

			return`
				<span class="sgml-info-wrap" data-info-id="${escapeHTMLAttribute(id)}">
					<button
						type="button"
						class="sgml-info-trigger"
						aria-label="${escapeHTMLAttribute(title)}"
						aria-expanded="false"
					>ⓘ</button>
				</span>`;
		}

		function closeInfoPanel(){
			if(!openInfoWrap)return;

			const button=openInfoWrap.querySelector('.sgml-info-trigger');
			const panel=openInfoWrap._sgmlInfoPanel;

			if(panel&&panel.parentNode)panel.parentNode.removeChild(panel);
			if(button)button.setAttribute('aria-expanded','false');

			openInfoWrap=null;
		}

		function positionInfoPanel(wrap,panel){
			const rect=wrap.getBoundingClientRect();
			const scrollX=window.scrollX||window.pageXOffset||0;
			const scrollY=window.scrollY||window.pageYOffset||0;
			const margin=8;
			const viewportWidth=window.innerWidth;
			const viewportHeight=window.innerHeight;
			const width=Math.min(340,Math.max(200,viewportWidth-20));

			panel.style.width=`${width}px`;
			panel.style.left=`${rect.left+scrollX}px`;
			panel.style.top=`${rect.bottom+scrollY+8}px`;

			requestAnimationFrame(()=>{
				const panelRect=panel.getBoundingClientRect();
				let left=rect.left+scrollX;
				let top=rect.bottom+scrollY+8;

				if(panelRect.right>viewportWidth-margin){
					left-=panelRect.right-(viewportWidth-margin);
				}

				if(left<margin)left=margin;

				if(panelRect.bottom>viewportHeight-margin&&rect.top>panelRect.height+margin){
					top=rect.top+scrollY-panelRect.height-8;
				}

				panel.style.left=`${left}px`;
				panel.style.top=`${top}px`;

				const arrowLeft=Math.max(
					8,
					Math.min(
						panelRect.width-20,
						rect.left+rect.width/2-left-4
					)
				);

				panel.style.setProperty('--sgml-info-arrow-left',`${arrowLeft}px`);
			});
		}

		function toggleInfoPanel(button){
			const wrap=button.closest('.sgml-info-wrap');
			if(!wrap)return;

			if(openInfoWrap===wrap){
				closeInfoPanel();
				return;
			}

			closeInfoPanel();

			const id=wrap.dataset.infoId;
			const stored=getInfoStore()[id];
			if(stored===undefined)return;

			const panel=document.createElement('div');
			panel.className='sgml-info-panel';
			panel.setAttribute('role','dialog');
			panel.setAttribute('aria-label',stored.title||'Information');

			if(stored.bg){
				panel.style.setProperty('--sgml-info-bg',stored.bg);
			}

			if(stored.col){
				panel.style.setProperty('--sgml-info-col',stored.col);
			}

			const header=document.createElement('div');
			header.className='sgml-info-header';
			header.textContent=stored.title||'Information';

			const body=document.createElement('div');
			body.className='sgml-info-body';
			body.innerHTML=stored.content||'';

			panel.appendChild(header);
			panel.appendChild(body);
			document.body.appendChild(panel);

			wrap._sgmlInfoPanel=panel;
			button.setAttribute('aria-expanded','true');
			openInfoWrap=wrap;

			positionInfoPanel(wrap,panel);

			if(window.MathJax&&window.MathJax.typesetPromise){
				window.MathJax.typesetClear&&window.MathJax.typesetClear([panel]);
				window.MathJax.typesetPromise([panel]).catch(error=>{
					console.error('Info panel LaTeX rendering failed:',error);
				});
			}
		}

		function setupInfoPanels(){
			document.querySelectorAll('.sgml-info-trigger').forEach(button=>{
				if(button.dataset.bound==='true')return;
				button.dataset.bound='true';

				button.addEventListener('click',event=>{
					event.preventDefault();
					event.stopPropagation();
					toggleInfoPanel(button);
				});
			});
		}

		document.addEventListener('click',event=>{
			if(openInfoWrap&&event.target.closest('.sgml-info-wrap')===openInfoWrap)return;
			if(openInfoWrap&&event.target.closest('.sgml-info-panel')===openInfoWrap._sgmlInfoPanel)return;
			closeInfoPanel();
		});

		document.addEventListener('keydown',event=>{
			if(event.key==='Escape')closeInfoPanel();
		});

		function renderEmbeddedSGML(source,{allowInfo=true,allowRoot=true,allowLine=true,allowEncircle=true}={}){
			let text=maskLiteralStrings(normalizeComponentSource(source));
			const extracted=extractCustomComponents(text);
			let rebuilt='';
			let cursor=0;
			const blockSlots=[];
			const inlineSlots=[];

			const allowedComponents=extracted.components.filter(component=>{
				if(component.type==='info')return allowInfo;
				if(component.type==='root')return allowRoot;
				if(component.type==='line')return allowLine;
				if(component.type==='encircle')return allowEncircle;
				if(component.type==='spoiler')return true;
				return false;
			});

			allowedComponents.forEach(component=>{
				rebuilt+=text.slice(cursor,component.index);

				if(component.type==='info'||component.type==='spoiler'||component.type==='encircle'){
					const id=inlineSlots.length;
					inlineSlots.push(component);
					rebuilt+=`\uE210SGMLINLINE${id}\uE211`;
				}else{
					const id=blockSlots.length;
					blockSlots.push(component);
					rebuilt+=`\n\n<div data-sgml-block-slot="${id}"></div>\n\n`;
				}
				cursor=component.end;
			});

			if(!allowedComponents.length)rebuilt=text;
			else rebuilt+=text.slice(cursor);

			const qResult=parseQuestionBlocks(rebuilt);
			let result=renderMarkdown(qResult.processedText);

			qResult.questions.forEach(q=>{
				result=result.replace(`%%QBLOCKTOKEN${q.id}%%`,buildQuestionUI(q));
			});

			inlineSlots.forEach((component,index)=>{
				let html='';
				if(component.type==='info')html=buildInfoHTML(component,false);
				else if(component.type==='spoiler')html=buildSpoilerHTML(component);
				else if(component.type==='encircle')html=buildEncircleHTML(component);
				result=result.replace(`\uE210SGMLINLINE${index}\uE211`,html);
			});

			blockSlots.forEach((component,index)=>{
				let html='';
				if(component.type==='root')html=buildTreeHTML({content:component.content});
				else if(component.type==='line')html=buildLineHTML({content:component.content});
				result=result.replace(`<div data-sgml-block-slot="${index}"></div>`,html);
			});

			return result;
		}

		function stripUnsafeSGML(str){
			if(!str)return'';

			return String(str)
				.replace(/<(iframe|object|embed|portal|frame|frameset|applet)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'')
				.replace(/<(iframe|object|embed|portal|frame|frameset|applet)\b[^>]*\/?>/gi,'')
				.replace(/<\/(iframe|object|embed|portal|frame|frameset|applet)\s*>/gi,'');
		}

		function parseTreeNodeContent(content){
			const extracted=extractChildren(content,'bh',true);
			const ownContent=removeSpans(
				content,
				extracted.spans
			);

			return{
				content:renderEmbeddedSGML(ownContent),
				children:extracted.children.map(branch=>
					parseTreeNodeContent(branch.content)
				)
			};
		}

		function renderTreeComponent(content){
			return parseTreeNodeContent(content);
		}

		function createTreeNode(nodeData){
			const node=document.createElement('div');
			node.className='sgml-tree-node';

			const card=document.createElement('div');
			card.className='sgml-tree-card';

			const cardContent=document.createElement('div');
			cardContent.className='sgml-tree-card-content';
			cardContent.innerHTML=nodeData.content||'<p>Empty node.</p>';

			card.appendChild(cardContent);
			node.appendChild(card);

			const childData=nodeData.children||[];

			if(childData.length){
				card.classList.add('has-children');

				const children=document.createElement('div');
				children.className='sgml-tree-children';

				childData.forEach(data=>{
					const child=document.createElement('div');
					child.className='sgml-tree-child';
					child.appendChild(createTreeNode(data));
					children.appendChild(child);
				});

				node.appendChild(children);

			}

			return node;
		}

		function resizeTreeToContent(tree){
			if(!tree)return;

			const layer=tree.querySelector('.sgml-tree-nodes');
			if(!layer)return;

			tree.style.width='max-content';
			tree.style.height='auto';

			const layerRect=layer.getBoundingClientRect();
			const treeRect=tree.getBoundingClientRect();
			const width=Math.max(680,Math.ceil(layerRect.width+60));
			const height=Math.max(190,Math.ceil(layerRect.height+60));

			tree.style.width=`${width}px`;
			tree.style.height=`${height}px`;
		}

		function updateTreeConnections(tree){
			if(!tree)return;

			const svg=tree.querySelector('.sgml-tree-svg');
			if(!svg)return;

			resizeTreeToContent(tree);
	
			const treeRect=tree.getBoundingClientRect();
			const width=Math.max(680,tree.clientWidth);
			const height=Math.max(190,tree.clientHeight);

			svg.setAttribute('width',width);
			svg.setAttribute('height',height);
			svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
			svg.innerHTML='';

			const makePath=d=>{
				const path=document.createElementNS(
					'http://www.w3.org/2000/svg',
					'path'
				);
				path.classList.add('sgml-tree-path');
				path.setAttribute('d',d);
				svg.appendChild(path);
			};

			tree.querySelectorAll('.sgml-tree-node.expanded').forEach(parent=>{
				const parentCard=parent.querySelector(':scope > .sgml-tree-card');
				const childrenWrap=parent.querySelector(':scope > .sgml-tree-children');

				if(!parentCard||!childrenWrap)return;

				const childNodes=[...childrenWrap.querySelectorAll(':scope > .sgml-tree-child > .sgml-tree-node')];
				if(!childNodes.length)return;

				const parentRect=parentCard.getBoundingClientRect();
				const parentX=parentRect.left+parentRect.width/2-treeRect.left;
				const parentY=parentRect.bottom-treeRect.top;

				const childPoints=childNodes.map(child=>{
					const card=child.querySelector(':scope > .sgml-tree-card');
					const rect=card.getBoundingClientRect();
					return{
						x:rect.left+rect.width/2-treeRect.left,
						y:rect.top-treeRect.top
					};
				});

				const childY=Math.min(...childPoints.map(point=>point.y));
				const minX=Math.min(...childPoints.map(point=>point.x));
				const maxX=Math.max(...childPoints.map(point=>point.x));
				const busY=parentY+Math.max(24,(childY-parentY)*0.42);

				makePath(`M ${parentX} ${parentY} C ${parentX} ${parentY+12}, ${parentX} ${busY-12}, ${parentX} ${busY}`);
				makePath(`M ${minX} ${busY} L ${maxX} ${busY}`);

				childPoints.forEach(point=>{
					makePath(`M ${point.x} ${busY} C ${point.x} ${busY+12}, ${point.x} ${point.y-12}, ${point.x} ${point.y}`);
				});
			});
		}

		function buildTreeHTML(block){
			const treeData=renderTreeComponent(block.content);

			const container=document.createElement('div');
			container.className='sgml-visual sgml-tree-visual';
			container.style.height='320px';
			container.dataset.resizeBound='false';

			const header=document.createElement('div');
			header.className='sgml-visual-header';
			header.textContent='Tree Graph';

			const visualContent=document.createElement('div');
			visualContent.className='sgml-visual-content sgml-tree-canvas';

			const tree=document.createElement('div');
			tree.className='sgml-tree';

			const svg=document.createElementNS(
				'http://www.w3.org/2000/svg',
				'svg'
			);
			svg.classList.add('sgml-tree-svg');

			const nodeLayer=document.createElement('div');
			nodeLayer.className='sgml-tree-nodes';
			nodeLayer.appendChild(createTreeNode(treeData));

			tree.appendChild(svg);
			tree.appendChild(nodeLayer);
			visualContent.appendChild(tree);

			const footer=document.createElement('div');
			footer.className='sgml-visual-footer';
			footer.title='Drag to resize';
			footer.setAttribute('aria-label','Resize tree');

			container.appendChild(header);
			container.appendChild(visualContent);
			container.appendChild(footer);

			return container.outerHTML;
		}


		function setupVisualResize(container,footer){
			if(!container||!footer||footer.dataset.bound==='true')return;
			footer.dataset.bound='true';

			let dragging=false;
			let startY=0;
			let startHeight=320;
			let pointerId=null;

			const onMove=event=>{
				if(!dragging)return;
				if(pointerId!==null&&event.pointerId!==pointerId)return;

				const delta=event.clientY-startY;
				const maxHeight=Math.max(180,window.innerHeight-32);
				const height=Math.max(180,Math.min(maxHeight,startHeight+delta));

				container.style.height=`${height}px`;
			};

			const end=event=>{
				if(pointerId!==null&&event.pointerId!==pointerId)return;

				dragging=false;
				footer.classList.remove('dragging');

				if(footer.releasePointerCapture&&pointerId!==null){
					try{
						if(footer.hasPointerCapture(pointerId)){
							footer.releasePointerCapture(pointerId);
						}
					}catch(_){}
				}

				pointerId=null;
				window.removeEventListener('pointermove',onMove);
				window.removeEventListener('pointerup',end);
				window.removeEventListener('pointercancel',end);

				document.querySelectorAll('.sgml-tree').forEach(updateTreeConnections);
			};

			footer.addEventListener('pointerdown',event=>{
				event.preventDefault();

				dragging=true;
				startY=event.clientY;
				startHeight=container.getBoundingClientRect().height;
				pointerId=event.pointerId;
				footer.classList.add('dragging');

				if(footer.setPointerCapture){
					try{footer.setPointerCapture(pointerId)}catch(_){}
				}

				window.addEventListener('pointermove',onMove);
				window.addEventListener('pointerup',end);
				window.addEventListener('pointercancel',end);
			});
		}

		function setupLineComponent(container){
			if(!container||container.dataset.lineBound==='true')return;
			container.dataset.lineBound='true';

			const nodes=[...container.querySelectorAll('.sgml-line-node')];
			const rail=container.querySelector('.sgml-line-rail');
			const line=container.querySelector('.sgml-line');
			const end=container.querySelector('.sgml-line-end');

			if(!nodes.length||!rail||!line)return;

			let visible=1;

			function refresh(){
				nodes.forEach((node,index)=>{
					const shown=index<visible;
					const current=shown&&index===visible-1&&index<nodes.length-1;

					node.classList.toggle('visible',shown);
					node.classList.toggle('current',current);
				});

				if(end){
					end.classList.toggle('visible',visible===nodes.length);
				}

				requestAnimationFrame(()=>{
					const last=nodes[visible-1];

					if(last){
						rail.style.bottom=`${Math.max(
							0,
							line.scrollHeight-last.offsetTop-last.offsetHeight+8
						)}px`;
					}
				});
			}

			nodes.forEach((node,index)=>{
				const title=node.querySelector('.sgml-line-title');
				if(!title)return;

				title.addEventListener('click',()=>{
					if(index>=visible)return;

					if(index===visible-1){
						if(visible<nodes.length)visible++;
					}else{
						visible=index+1;
					}

					refresh();
				});
			});

			refresh();
		}

		function setupTreeComponent(container){
			if(!container)return;

			const tree=container.querySelector('.sgml-tree');
			if(!tree)return;

			tree.querySelectorAll('.sgml-tree-node').forEach(node=>{
				const card=node.querySelector(':scope > .sgml-tree-card');
				const children=node.querySelector(':scope > .sgml-tree-children');

				if(!card||!children||card.dataset.bound==='true')return;

				card.dataset.bound='true';

				card.addEventListener('click',event=>{
					if(event.target.closest('button,a,input,textarea,select'))return;

					const expanding=!node.classList.contains('expanded');

					if(!expanding){
						children.querySelectorAll('.sgml-tree-node.expanded').forEach(descendant=>{
							descendant.classList.remove('expanded');
							const descendantCard=descendant.querySelector(':scope > .sgml-tree-card');
							if(descendantCard)descendantCard.classList.remove('expanded');
						});
					}

					node.classList.toggle('expanded',expanding);
					card.classList.toggle('expanded',expanding);

					requestAnimationFrame(()=>{
						resizeTreeToContent(tree);
						updateTreeConnections(tree);
					});
				});
			});

			requestAnimationFrame(()=>{
				resizeTreeToContent(tree);
				updateTreeConnections(tree);
			});
		}

		function setupVisualComponents(){
			document.querySelectorAll('.sgml-tree-visual,.sgml-line-visual').forEach(container=>{
				const footer=container.querySelector('.sgml-visual-footer');
				if(footer)setupVisualResize(container,footer);
			});

			document.querySelectorAll('.sgml-tree-visual').forEach(setupTreeComponent);
			document.querySelectorAll('.sgml-line-visual').forEach(setupLineComponent);
		}

		function parseLineNodes(content){
			const extracted=extractChildren(content,'node',false);

			return extracted.children.map(node=>{
				return{
					title:getAttributeFromTag(node.open,'title')||'Node',
					content:node.content
				};
			});
		}

		function getAttributeFromTag(tag,name){
			const double=tag.match(
				new RegExp(`${name}\\s*:\\s*"([^"]*)"`,`i`)
			);

			if(double)return double[1];

			const single=tag.match(
				new RegExp(`${name}\\s*:\\s*'([^']*)'`,`i`)
			);

			if(single)return single[1];

			const plain=tag.match(
				new RegExp(`${name}\\s*:\\s*([^\\s>]*)`,`i`)
			);

			return plain?plain[1]:'';
		}

		function buildLineHTML(block){
			const items=parseLineNodes(block.content);

			const container=document.createElement('div');
			container.className='sgml-visual sgml-line-visual';
			container.style.height='320px';
			container.dataset.resizeBound='false';

			const header=document.createElement('div');
			header.className='sgml-visual-header';
			header.textContent='Line Node';

			const visualContent=document.createElement('div');
			visualContent.className='sgml-visual-content sgml-line-canvas';

			const line=document.createElement('div');
			line.className='sgml-line';

			const rail=document.createElement('div');
			rail.className='sgml-line-rail';
			line.appendChild(rail);

			items.forEach((item,index)=>{
				const node=document.createElement('div');
				node.className='sgml-line-node';

				const title=document.createElement('button');
				title.type='button';
				title.className='sgml-line-title';
				title.textContent=item.title||`Node ${index+1}`;

				const content=document.createElement('div');
				content.className='sgml-line-content';
				content.innerHTML=renderEmbeddedSGML(item.content);

				node.appendChild(title);
				node.appendChild(content);
				line.appendChild(node);
			});

			const end=document.createElement('div');
			end.className='sgml-line-end';
			end.textContent='End';
			line.appendChild(end);

			visualContent.appendChild(line);

			const footer=document.createElement('div');
			footer.className='sgml-visual-footer';
			footer.title='Drag to resize';
			footer.setAttribute('aria-label','Resize line node');

			container.appendChild(header);
			container.appendChild(visualContent);
			container.appendChild(footer);

			return container.outerHTML;
		}


		function extractCustomComponents(text){
			const components=[];
			const spans=[];
			let cursor=0;

			while(cursor<text.length){
				const candidates=[];

				['info','root','line','spoiler','encircle'].forEach(tag=>{
					const found=findTagStart(text,tag,cursor);
					if(found)candidates.push({...found,tag});
				});

				if(!candidates.length)break;
				candidates.sort((a,b)=>a.index-b.index);
				const found=candidates[0];

				const matched=findMatchingTag(text,found.tag,found.end,false);
				if(!matched){
					cursor=found.end;
					continue;
				}

				components.push({
					type:found.tag,
					open:found.open,
					content:matched.content,
					index:found.index,
					end:matched.end
				});

				spans.push({start:found.index,end:matched.end});
				cursor=matched.end;
			}

			return{components,spans};
		}

		function renderTopLevelWithComponents(text){
			text=maskLiteralStrings(text);
			const extracted=extractCustomComponents(text);
			let rebuilt='';
			let cursor=0;
			const blocks=[];
			const inline=[];

			extracted.components.forEach(component=>{
				rebuilt+=text.slice(cursor,component.index);

				if(component.type==='info'||component.type==='spoiler'||component.type==='encircle'){
					const index=inline.length;
					inline.push(component);
					rebuilt+=`\uE210SGMLINLINE${index}\uE211`;
				}else{
					const index=blocks.length;
					blocks.push(component);
					rebuilt+=`\n\n<div data-sgml-block-slot="${index}"></div>\n\n`;
				}
				cursor=component.end;
			});

			rebuilt+=text.slice(cursor);

			const qResult=parseQuestionBlocks(rebuilt);
			let result=renderMarkdown(qResult.processedText);

			qResult.questions.forEach(q=>{
				result=result.replace(`%%QBLOCKTOKEN${q.id}%%`,buildQuestionUI(q));
			});

			inline.forEach((component,index)=>{
				let html='';
				if(component.type==='info')html=buildInfoHTML(component,false);
				else if(component.type==='spoiler')html=buildSpoilerHTML(component);
				else if(component.type==='encircle')html=buildEncircleHTML(component);
				result=result.replace(`\uE210SGMLINLINE${index}\uE211`,html);
			});

			blocks.forEach((component,index)=>{
				let html='';
				if(component.type==='root')html=buildTreeHTML({content:component.content});
				else if(component.type==='line')html=buildLineHTML({content:component.content});
				result=result.replace(`<div data-sgml-block-slot="${index}"></div>`,html);
			});

			return result;
		}

		function renderICBPlaceholders(str,blocks){
			if(!str||!blocks||!blocks.length)return str;

			return str.replace(
				/\uE100SGMLICB(\d+)\uE101/g,
				(_,index)=>{
					const i=Number(index);

					if(!blocks[i])return'';

					return`<div class="sgml-icb-slot" data-icb-index="${i}"></div>`;
				}
			);
		}

		function renderSGML(sgmlContent){
			parsedQuestions={};
			sgmlLiteralStore=[];
			sgmlEscapedStore=[];
			sgmlLiteralCounter=0;
			questionCounter=0;
			sgmlSpoilerIdCounter=0;
			infoCounter=0;
			sgmlInfoIdCounter=0;
			openInfoWrap=null;
			window.__sgmlInfoStore={};
			window.__sgmlICBBlocks=[];

			const icbResult=extractICBBlocks(sgmlContent);
			window.__sgmlICBBlocks=icbResult.blocks;

			const safeSGML=stripUnsafeSGML(icbResult.processedText);
			let renderedDoc=renderTopLevelWithComponents(safeSGML);

			renderedDoc=renderICBPlaceholders(
				renderedDoc,
				icbResult.blocks
			);

			const output=document.getElementById('sgml-output');
			output.innerHTML=renderedDoc;

			setupICB();
			setupVisualComponents();
			setupInfoPanels();
			setupConnectComponents();

			if(window.MathJax&&window.MathJax.typesetPromise){
				window.MathJax.typesetClear&&window.MathJax.typesetClear([output]);
				window.MathJax.typesetPromise([output]).catch(error=>{
					console.error('LaTeX rendering failed:',error);
				});
			}
		}

		function checkChoicesAnswer(qId){
			const q=parsedQuestions[qId];
			const selected=document.querySelector(
				`input[name="radio_${qId}"]:checked`
			);
			const fb=document.getElementById(`fb_${qId}`);

			if(!selected){
				fb.className='sgml-feedback incorrect';
				fb.textContent='Select an option.';
				return;
			}

			const selectedIdx=parseInt(selected.value,10);
			const userSelectedRaw=q.options[selectedIdx];
			const userTrueText=extractTrueText(userSelectedRaw);

			const isCorrect=q.correctAnswers.some(cRaw=>{
				const cTrueText=extractTrueText(cRaw);

				return q.props.case
					?userTrueText===cTrueText
					:userTrueText.toLowerCase()===cTrueText.toLowerCase();
			});

			setFeedback(fb,isCorrect);
		}

		function checkFillinAnswer(qId){
			const q=parsedQuestions[qId];
			const input=document.getElementById(`input_${qId}`);
			const fb=document.getElementById(`fb_${qId}`);
			const userTrueText=extractTrueText(input.value,{stripMarkup:false});

			const isCorrect=q.correctAnswers.some(cRaw=>{
				const cTrueText=extractTrueText(cRaw);

				return q.props.case
					?userTrueText===cTrueText
					:userTrueText.toLowerCase()===cTrueText.toLowerCase();
			});

			setFeedback(fb,isCorrect);
		}

		function checkEnumOrderAnswer(qId){
			const q=parsedQuestions[qId];
			const list=document.getElementById(`order_list_${qId}`);
			const fb=document.getElementById(`fb_${qId}`);
			const currentItems=[
				...list.querySelectorAll('.sgml-order-item')
			];

			const userTrueList=currentItems.map(
				li=>extractTrueText(
					decodeURIComponent(li.dataset.raw)
				)
			);

			const correctTrueList=q.correctAnswers.map(
				cRaw=>extractTrueText(cRaw)
			);

			let isCorrect=userTrueList.length===correctTrueList.length;

			if(isCorrect){
				for(let i=0;i<userTrueList.length;i++){
					const u=userTrueList[i];
					const c=correctTrueList[i];

					const match=q.props.case
						?u===c
						:u.toLowerCase()===c.toLowerCase();

					if(!match){
						isCorrect=false;
						break;
					}
				}
			}

			setFeedback(fb,isCorrect);
		}

		function checkEnumWrittenAnswer(qId){
			const q=parsedQuestions[qId];
			const inputs=[
				...document.querySelectorAll(`.input_${qId}`)
			];
			const fb=document.getElementById(`fb_${qId}`);

			const userTrueTexts=inputs
				.map(inp=>extractTrueText(inp.value,{stripMarkup:false}))
				.filter(t=>t.length>0);

			const correctTrueTexts=q.correctAnswers.map(
				cRaw=>extractTrueText(cRaw)
			);

			let isCorrect=true;

			if(userTrueTexts.length<q.count){
				isCorrect=false;
			}else if(q.props.inorder){
				for(let i=0;i<q.count;i++){
					const u=userTrueTexts[i]||'';
					const c=correctTrueTexts[i]||'';

					const match=q.props.case
						?u===c
						:u.toLowerCase()===c.toLowerCase();

					if(!match){
						isCorrect=false;
						break;
					}
				}
			}else{
				const availableCorrect=[...correctTrueTexts];

				for(const u of userTrueTexts){
					const matchIdx=availableCorrect.findIndex(
						c=>q.props.case
							?u===c
							:u.toLowerCase()===c.toLowerCase()
					);

					if(matchIdx!==-1)availableCorrect.splice(matchIdx,1);
					else{
						isCorrect=false;
						break;
					}
				}
			}

			setFeedback(fb,isCorrect);
		}

		function setFeedback(element,isCorrect){
			if(isCorrect){
				element.className='sgml-feedback correct';
				element.textContent='Correct!';
			}else{
				element.className='sgml-feedback incorrect';
				element.textContent='Incorrect!';
			}
		}

		function checkAllQuestions(){
			Object.keys(parsedQuestions).forEach(qId=>{
				const q=parsedQuestions[qId];

				if(q.type==='choices')checkChoicesAnswer(qId);
				else if(q.type==='fillin')checkFillinAnswer(qId);
				else if(q.type==='enum_order')checkEnumOrderAnswer(qId);
				else if(q.type==='enum_written')checkEnumWrittenAnswer(qId);
				else if(q.type==='connect')checkConnectAnswer(qId);
			});
		}

		function moveOrderItem(qId,btn,direction){
			const li=btn.closest('.sgml-order-item');
			const list=document.getElementById(`order_list_${qId}`);

			if(direction===-1&&li.previousElementSibling){
				list.insertBefore(li,li.previousElementSibling);
			}else if(direction===1&&li.nextElementSibling){
				list.insertBefore(li.nextElementSibling,li);
			}
		}

		function setupDragAndDrop(){
			document.querySelectorAll('.sgml-order-list').forEach(list=>{
				let draggedItem=null;

				list.addEventListener('dragstart',e=>{
					draggedItem=e.target.closest('.sgml-order-item');
					if(draggedItem)draggedItem.classList.add('dragging');
				});

				list.addEventListener('dragend',()=>{
					if(draggedItem)draggedItem.classList.remove('dragging');
					draggedItem=null;
				});

				list.addEventListener('dragover',e=>{
					e.preventDefault();

					const draggableElements=[
						...list.querySelectorAll('.sgml-order-item:not(.dragging)')
					];

					const afterElement=draggableElements.reduce(
						(closest,child)=>{
							const box=child.getBoundingClientRect();
							const offset=e.clientY-box.top-box.height/2;

							if(offset<0&&offset>closest.offset){
								return{offset,element:child};
							}

							return closest;
						},
						{offset:Number.NEGATIVE_INFINITY}
					).element;

					if(draggedItem){
						if(afterElement==null)list.appendChild(draggedItem);
						else list.insertBefore(draggedItem,afterElement);
					}
				});
			});
		}

