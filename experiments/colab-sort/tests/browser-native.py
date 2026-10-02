"""Native five-context acceptance: real WebRTC, crypto and IndexedDB, no mocks.
Run outside restrictive browser policies. This does not establish physical LAN/NAT compatibility.
"""
import asyncio, json, os, pathlib
from playwright.async_api import async_playwright
from ui_helpers import ROOT, OUT, fixtures, wait_images, drag
URL = os.environ.get('COLAB_URL', (ROOT / 'CoLabSort.html').as_uri())
async def modal(p):
    if not await p.locator('#share-dialog').is_visible(): await p.locator('#share').click()
async def connect(host, guest):
    await modal(host); await host.locator('#make-offer').click()
    await host.wait_for_function("document.getElementById('offer-output').value.startsWith('COLAB2.')", timeout=25000)
    offer = await host.locator('#offer-output').input_value()
    await modal(guest); await guest.locator('#tab-join').click()
    await guest.locator('#offer-input').fill(offer); await guest.locator('#make-answer').click()
    await guest.wait_for_function("document.getElementById('answer-output').value.startsWith('COLAB2.')", timeout=25000)
    answer = await guest.locator('#answer-output').input_value()
    await host.locator('#answer-input').fill(answer); await host.locator('#accept-answer').click()
    await guest.wait_for_function('CoLabDemo.link?.ready===true', timeout=60000)
    await host.locator('#share-dialog .close-button').click(); await guest.locator('#share-dialog .close-button').click()
    return {'offerCharacters': len(offer), 'answerCharacters': len(answer)}
async def main():
    report = {'kind': 'native browser contexts: real RTCDataChannels and IndexedDB', 'status': 'running', 'url': URL}
    errors = []
    try:
        async with async_playwright() as pw:
            executable = os.environ.get('CHROMIUM_PATH')
            if not executable and pathlib.Path('/usr/bin/chromium').exists(): executable = '/usr/bin/chromium'
            options = {'headless': True, 'args': ['--no-sandbox', '--disable-dev-shm-usage']}
            if executable: options['executable_path'] = executable
            browser = await pw.chromium.launch(**options)
            contexts = [await browser.new_context(viewport={'width': 1440, 'height': 950}) for _ in range(5)]
            pages = [await c.new_page() for c in contexts]
            report['stage'] = 'load application'
            for n, p in enumerate(pages):
                p.on('pageerror', lambda e: errors.append(str(e)))
                await p.goto(URL, timeout=15000); await p.wait_for_function('!!window.CoLabDemo')
                await p.locator('#my-name').fill(['Daniel', 'Anna', 'Mira', 'Jonas', 'Lea'][n]); await p.locator('#my-name').blur()
            paths = fixtures(); await pages[0].locator('#image-input').set_input_files(paths); await wait_images(pages[0], len(paths))
            report['stage'] = 'manual signaling'; report['connections'] = []
            for guest in pages[1:]: report['connections'].append(await connect(pages[0], guest))
            for p in pages:
                await wait_images(p, len(paths)); await p.wait_for_function('CoLabDemo.link.people.size===5')
            report['participants'] = 5; report['stage'] = 'guest-to-guest drag'
            id = await pages[1].evaluate('[...CoLabDemo.model.items.keys()][4]')
            await drag(pages[1], id, 85, 55)
            x = await pages[1].evaluate('id=>CoLabDemo.model.items.get(id).x', id)
            for p in pages: await p.wait_for_function('({id,x})=>CoLabDemo.model.items.get(id).x===x', arg={'id': id, 'x': x})
            report['stage'] = 'competing claims'
            tokens = await asyncio.gather(*[p.evaluate('id=>CoLabDemo.link.claim(id)', id) for p in pages[1:]])
            assert sum(bool(t) for t in tokens) == 1
            for p, token in zip(pages[1:], tokens):
                if token: await p.evaluate('({id,token})=>CoLabDemo.link.release(id,token)', {'id': id, 'token': token})
            report['stage'] = 'reload and native persistence'
            await pages[4].reload(); await pages[4].wait_for_function('!!window.CoLabDemo'); await wait_images(pages[4], len(paths))
            await pages[0].wait_for_function('CoLabDemo.link.people.size===4', timeout=30000)
            report['reconnect'] = await connect(pages[0], pages[4]); await wait_images(pages[4], len(paths))
            await pages[4].wait_for_timeout(500)
            report['reconnectOriginalBytes'] = await pages[4].evaluate('CoLabDemo.link.receivedBytes')
            assert report['reconnectOriginalBytes'] == 0
            assert not errors, errors
            report['status'] = 'passed'; report['stage'] = 'complete'; await browser.close()
    except Exception as e:
        report['status'] = 'blocked_or_failed'; report['error'] = str(e); raise
    finally:
        report['jsErrors'] = errors
        (OUT / 'native-results.json').write_text(json.dumps(report, indent=2))
        print(json.dumps(report, indent=2))
asyncio.run(main())
