"""Real Chromium DOM/canvas/pointers; explicitly simulated storage and peer records.
Not a native IndexedDB or WebRTC connectivity test. Nothing here ships in the demo.
"""
import asyncio,hashlib,json,os,re
from playwright.async_api import async_playwright
from ui_helpers import ROOT,OUT,fixtures,wait_images,drag
async def main():
    errors=[];result={};paths=fixtures()
    async with async_playwright() as pw:
        browser=await pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
        p=await browser.new_page(viewport={'width':1440,'height':950})
        p.on('pageerror',lambda e:errors.append(str(e)))
        await p.expose_function('testDigest',lambda data:list(hashlib.sha256(bytes(data)).digest()))
        html=(ROOT/'CoLabSort.html').read_text()
        html=re.sub(r'<script[^>]*>.*?</script>','',html,flags=re.S)
        html=re.sub(r'<link[^>]*>','',html)
        await p.set_content(html);await p.add_style_tag(content=(ROOT/'style.css').read_text())
        for name in ['core.js','store.js','peer.js','room.js','board.js']:
            await p.add_script_tag(content=(ROOT/name).read_text())
        await p.add_script_tag(content=(ROOT/'tests/browser-harness.js').read_text())
        await p.add_script_tag(content=(ROOT/'app.js').read_text())
        await p.wait_for_function('!!window.CoLabDemo')
        await p.screenshot(path=str(OUT/'01-empty.png'))
        await p.locator('#my-name').fill('Daniel');await p.locator('#my-name').blur()
        assert await p.locator('#my-dot').text_content()=='D'
        await p.locator('#image-input').set_input_files(paths);await wait_images(p,len(paths))
        result['imported']=await p.evaluate('CoLabDemo.model.items.size')
        id=await p.evaluate('[...CoLabDemo.model.items.keys()][4]')
        before=await p.evaluate('id=>CoLabDemo.model.items.get(id).x',id)
        await drag(p,id,90,40)
        after=await p.evaluate('id=>CoLabDemo.model.items.get(id).x',id);assert before!=after
        result['pointer_drag']=True
        await p.locator('#board').focus();await p.keyboard.press('ArrowRight');await p.wait_for_timeout(80)
        assert await p.evaluate('id=>CoLabDemo.model.items.get(id).x',id)>after
        result['keyboard_move']=True
        z=await p.evaluate('CoLabDemo.view.camera.scale');await p.locator('#zoom-out').click()
        await p.wait_for_function('(z)=>CoLabDemo.view.camera.scale<z',arg=z)
        await p.locator('#fit').click();result['zoom_fit']=True
        await p.evaluate('CoLabDemo.preview([...CoLabDemo.model.items.keys()][0])')
        await p.wait_for_function("document.getElementById('preview-image').naturalWidth>0")
        await p.locator('#preview-dialog .close-button').click();result['original_preview']=True
        await p.locator('#image-input').set_input_files(paths[:2]);await wait_images(p,len(paths))
        result['dedup']=True
        # Deliberately synthetic peers. Exercise real Room/App/Canvas wiring without claiming RTC.
        await p.evaluate('''()=>{
          const a=CoLabDemo,r=a.newRoom('host');
          const names=['Anna','Mira','Jonas','Lea'],colors=['#b5654d','#6264ae','#287bb5','#a37120'];
          for(let k=0;k<4;k++){
            const l=r.addLink();l.ready=true;l.remote={id:'preview-'+k,name:names[k],color:colors[k]};
            l.control=Object.assign(new EventTarget(),{readyState:'open',bufferedAmount:0,send(){}});
            l.pc={close(){}};
          }
          r.broadcastRoster();
          const c=a.view.camera;
          for(let k=0;k<4;k++)a.view.presence({t:'cursor',from:'preview-'+k,x:c.x-240+k*155,y:c.y-100+k*90});
          r.locks.set([...a.model.items.keys()][2],{owner:'preview-1',token:'preview-lock',until:Date.now()+10000});a.view.paint();
        }''')
        await p.wait_for_timeout(200)
        assert await p.locator('.peer-cursor:visible').count()==4
        assert await p.locator('#remote-people button').count()==4
        assert '5 / 5' in await p.locator('#share').text_content()
        result['four_named_cursors']=True
        await p.screenshot(path=str(OUT/'02-five-people.png'))
        await p.locator('#remote-people button').nth(1).click()
        expected=await p.evaluate("CoLabDemo.view.remoteCursors.get('preview-1').x")
        assert await p.evaluate('CoLabDemo.view.camera.x')==expected
        result['jump_to_each_cursor']=True
        await p.locator('#share').click();await p.wait_for_timeout(100)
        assert await p.locator('#participant-list .participant-row').count()==5
        assert await p.locator('#make-offer').is_disabled()
        await p.screenshot(path=str(OUT/'03-roster-full.png'))
        await p.get_by_role('button',name='Lea trennen',exact=True).click()
        await p.wait_for_timeout(200)
        assert await p.locator('#make-offer').is_enabled()
        assert await p.locator('#participant-list .participant-row').count()==4
        result['remove_one_guest_preserves_session']=True
        # Signaling output adapter only, not a mocked successful connection.
        await p.evaluate('''()=>{
          window.__originalRoom=CoLabDemo.link;
          CoLab.PeerLink.prototype.offer=async function(){this.session=crypto.randomUUID();this.pc={close(){}};return CoLab.encodeSignal({session:this.session,type:'offer',sdp:'v=0\\r\\n'});};
        }''')
        await p.locator('#make-offer').click();await p.wait_for_function("document.getElementById('offer-output').value.startsWith('COLAB2.')")
        assert await p.evaluate('CoLabDemo.link===__originalRoom&&CoLabDemo.link.people.size===4')
        result['inviting_keeps_existing_peers']=True
        await p.locator('#answer-input').fill('not-valid');await p.locator('#accept-answer').click()
        await p.wait_for_timeout(150)
        assert 'vollständigen' in await p.locator('#signal-status').text_content()
        assert await p.evaluate('CoLabDemo.link===__originalRoom&&CoLabDemo.link.people.size===4')
        result['bad_answer_does_not_end_session']=True
        await p.locator('#cancel-invite').click();await p.wait_for_timeout(100)
        assert await p.evaluate('CoLabDemo.link.links.size')==3
        await p.locator('#share-dialog .close-button').click()
        await p.set_viewport_size({'width':430,'height':880});await p.wait_for_timeout(150)
        await p.screenshot(path=str(OUT/'04-mobile.png'))
        result['horizontal_overflow']=await p.evaluate('document.documentElement.scrollWidth>innerWidth')
        assert not result['horizontal_overflow']
        await p.locator('#share').click();await p.locator('#disconnect').click();await p.wait_for_timeout(150)
        assert await p.locator('.peer-cursor').count()==0
        assert await p.evaluate('CoLabDemo.model.items.size')==len(paths)
        result['session_cleanup_keeps_local_board']=True
        result['js_errors']=errors;assert not errors,errors
        result['storage']='in-memory UI adapter; NOT native IndexedDB'
        result['network']='synthetic peer records/signaling adapter; no actual WebRTC connection'
        await browser.close()
    (OUT/'ui-results.json').write_text(json.dumps(result,indent=2))
    print(json.dumps(result,indent=2))
asyncio.run(main())
