"""Shared browser-test helpers; PNG/JPEG fixtures are synthetic."""
import os, pathlib, random
from PIL import Image, ImageDraw
ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = pathlib.Path(os.environ.get('COLAB_TEST_OUT', str(ROOT / 'test-results')))
OUT.mkdir(parents=True, exist_ok=True)
def fixtures():
    paths = []
    for i in range(8):
        w,h=360+i*9,230+i*9
        im = Image.new('RGB',(w,h),((i*31+80)%256,(i*53+120)%256,(i*77+180)%256))
        d=ImageDraw.Draw(im)
        d.rounded_rectangle((25,30,w-25,h-30),radius=24,outline='white',width=3)
        d.text((45,55),f'Perspective {i+1:02d}',fill='white',font_size=23)
        d.ellipse((w-155,h-145,w-55,h-45),outline='white',width=3)
        p=OUT/f'Bild-{i}-Grün.png'; im.save(p);paths.append(str(p))
    im=Image.frombytes('RGB',(800,640),random.Random(4).randbytes(800*640*3))
    p=OUT/'large.jpg';im.save(p,quality=94);paths.append(str(p))
    return paths
async def wait_images(p,n):
    await p.wait_for_function('(n)=>window.CoLabDemo?.model.items.size===n&&!CoLabDemo.importing&&[...CoLabDemo.model.items.keys()].every(id=>CoLabDemo.available.has(id))',arg=n,timeout=90000)
async def drag(p,id,dx,dy):
    pos=await p.evaluate('''id=>{const a=CoLabDemo,i=a.model.items.get(id),r=a.view.canvas.getBoundingClientRect();const p=CoLab.screenPoint(i.x+60,i.y+45,a.view.camera);return {x:p.x+r.left,y:p.y+r.top};}''',id)
    await p.mouse.move(pos['x'],pos['y']);await p.mouse.down();await p.wait_for_timeout(180)
    await p.mouse.move(pos['x']+dx,pos['y']+dy,steps=12);await p.mouse.up();await p.wait_for_timeout(350)
