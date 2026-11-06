import os
import sys,json,subprocess
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from mint import *
from playwright.sync_api import sync_playwright
env={**os.environ,"PGUSER":os.environ.get("PGUSER","postgres"),"PGHOST":os.environ.get("PGHOST","localhost")}
def q(s): return subprocess.run(["psql","-At","-d","e2e","-c",s],capture_output=True,text=True,env=env).stdout.strip()
ok=lambda c,m: print(("PASS " if c else "FAIL ")+m)
asg=q("select a.id from assignments a join exams e on e.id=a.exam_id join classrooms c on c.id=a.classroom_id where e.title like 'Thisis%'")
cls=q("select id from classrooms where name like 'Class 10A%'")
q("delete from attempts where user_id='00000000-0000-0000-0000-0000000000b1' and assignment_id='%s'"%asg)
FIT="""()=>{const W=%d;const d=document.querySelector('dialog[open]');if(!d)return 'no dialog';const r=d.getBoundingClientRect();return {fits:r.left>=-1&&r.right<=W+1&&r.top>=-1&&r.bottom<=innerHeight+1,sw:document.documentElement.scrollWidth<=W}}"""
with sync_playwright() as p:
    b=p.chromium.launch(); W=320
    def mk(role):
        c=b.new_context(viewport={"width":W,"height":640},has_touch=True,is_mobile=True)
        c.add_init_script("if(!localStorage.getItem('sb-localhost-auth-token'))localStorage.setItem('sb-localhost-auth-token',%s)"%json.dumps(json.dumps(session(*USERS[role]))));return c
    ctx=mk('teacher'); pg=ctx.new_page()
    pg.goto("http://127.0.0.1:4174/"); pg.wait_for_timeout(1200)
    pg.locator("nav.fixed").get_by_role("button",name="More").click(); pg.wait_for_timeout(300); r=pg.evaluate(FIT%W); ok(r!='no dialog' and r['fits'] and r['sw'],f"More menu inside 320px viewport {r}")
    pg.keyboard.press("Escape")
    pg.goto(f"http://127.0.0.1:4174/classrooms/{cls}"); pg.wait_for_timeout(1500)
    for label in ["Reschedule","Assign examination","Post announcement"]:
        bt=pg.get_by_role("button",name=label)
        if bt.count()==0: print("   (no button",label,")"); continue
        bt.first.click(); pg.wait_for_timeout(400); r=pg.evaluate(FIT%W); ok(r!='no dialog' and r['fits'] and r['sw'],f"'{label}' modal inside viewport {r}"); pg.keyboard.press("Escape"); pg.wait_for_timeout(200)
    ctx.close()
    ctx=mk('student1'); pg=ctx.new_page()
    pg.goto("http://127.0.0.1:4174/"); pg.wait_for_timeout(1200)
    pg.get_by_role("button",name="Join classroom").first.click(); pg.wait_for_timeout(400); r=pg.evaluate(FIT%W); ok(r!='no dialog' and r['fits'] and r['sw'],f"Join modal inside viewport {r}"); pg.keyboard.press("Escape")
    pg.goto(f"http://127.0.0.1:4174/take/{asg}"); pg.wait_for_timeout(1200)
    pg.get_by_role("button",name="Start examination").click(); pg.wait_for_timeout(1800)
    sw=pg.evaluate("document.documentElement.scrollWidth"); ok(sw<=W,f"in-exam screen with unbreakable question/option text: scrollWidth={sw} <= {W}")
    pg.get_by_role("button",name="Submit",exact=True).click(); pg.wait_for_timeout(400); r=pg.evaluate(FIT%W); ok(r!='no dialog' and r['fits'] and r['sw'],f"submit-confirm modal inside viewport {r}")
    pg.screenshot(path="/tmp/exam320.png")
    b.close()
q("delete from attempts where user_id='00000000-0000-0000-0000-0000000000b1' and assignment_id='%s'"%asg)
