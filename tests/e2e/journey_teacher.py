import os
import sys,json,subprocess
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from mint import *
from playwright.sync_api import sync_playwright
env={**os.environ,"PGUSER":os.environ.get("PGUSER","postgres"),"PGHOST":os.environ.get("PGHOST","localhost")}
def q(s): return subprocess.run(["psql","-At","-d","e2e","-c",s],capture_output=True,text=True,env=env).stdout.strip()
ok=lambda c,m: print(("PASS " if c else "FAIL ")+m)
ex=q("select id from exams where title like 'Algebra basics%' order by created_at limit 1")
# a classroom owned by someone else that the teacher has merely JOINED
q("""select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}',false)""")
sql="""select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}',false);
select create_classroom('Someone elses class','x') where not exists(select 1 from classrooms where name='Someone elses class');
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}',false);
select join_classroom(join_code) from classrooms where name='Someone elses class' and not exists(select 1 from classroom_members m where m.classroom_id=classrooms.id and m.user_id='00000000-0000-0000-0000-0000000000a1');"""
subprocess.run(["psql","-q","-d","e2e","-c",sql],capture_output=True,env=env)
q("update exams set title='Algebra basics' where id='%s'"%ex)
with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={"width":375,"height":700},has_touch=True,is_mobile=True)
    ctx.add_init_script("if(!localStorage.getItem('sb-localhost-auth-token'))localStorage.setItem('sb-localhost-auth-token',%s)"%json.dumps(json.dumps(session(*USERS['teacher']))))
    pg=ctx.new_page(); errs=[]; pg.on("pageerror",lambda e:errs.append(str(e)))
    # --- unsaved-changes guard
    pg.goto(f"http://127.0.0.1:4174/examinations/{ex}"); pg.wait_for_timeout(1500)
    title=pg.locator("#title").first; title.fill("Algebra basics EDITED"); pg.wait_for_timeout(200)
    pg.locator("nav.fixed").get_by_role("link",name="Classrooms").click(); pg.wait_for_timeout(500)
    ok(pg.get_by_text("Discard unsaved changes?").is_visible(),"leaving editor with unsaved edits asks for confirmation")
    pg.get_by_role("button",name="Cancel").click(); pg.wait_for_timeout(400)
    ok("/examinations/" in pg.url and title.input_value().endswith("EDITED"),"Cancel keeps you on the editor with edits intact")
    # --- save then navigate freely
    pg.get_by_role("button",name="Save",exact=True).click(); pg.wait_for_timeout(1200)
    ok(q(f"select title from exams where id='{ex}'")=="Algebra basics EDITED","Save persisted title to the database")
    pg.locator("nav.fixed").get_by_role("link",name="Classrooms").click(); pg.wait_for_timeout(700)
    ok(pg.url.endswith("/classrooms") and not pg.get_by_text("Discard unsaved changes?").is_visible(),"after saving, navigation is NOT blocked")
    # --- discard path
    pg.goto(f"http://127.0.0.1:4174/examinations/{ex}"); pg.wait_for_timeout(1500)
    pg.locator("#title").first.fill("Throwaway"); pg.locator("nav.fixed").get_by_role("link",name="Exams").click(); pg.wait_for_timeout(400)
    pg.get_by_role("button",name="Discard changes").click(); pg.wait_for_timeout(800)
    ok(pg.url.endswith("/examinations") and q(f"select title from exams where id='{ex}'")=="Algebra basics EDITED","Discard leaves without saving")
    # --- assign modal only offers OWNED classrooms
    pg.goto(f"http://127.0.0.1:4174/examinations/{ex}"); pg.wait_for_timeout(1500)
    pg.get_by_role("button",name="Assign to classroom").click(); pg.wait_for_timeout(1000)
    opts=pg.evaluate("[...document.querySelectorAll('dialog option')].map(o=>o.textContent)")
    ok(not any("Someone elses" in o for o in opts) and any("Class 10B" in o for o in opts),f"assign dialog lists only owned classrooms ({len(opts)} options)")
    pg.keyboard.press("Escape")
    # --- new exam end to end
    pg.goto("http://127.0.0.1:4174/examinations/blank"); pg.wait_for_timeout(1200)
    pg.locator("#title").first.fill("E2E created exam"); 
    pg.get_by_role("button",name="Add question").first.click() if pg.get_by_role("button",name="Add question").count() else None
    pg.wait_for_timeout(300)
    print("   (editor buttons:",pg.evaluate("[...document.querySelectorAll('main button')].map(b=>b.textContent.trim()).filter(Boolean).slice(0,10)"),")")
    pg.get_by_role("button",name="Save",exact=True).click(); pg.wait_for_timeout(1500)
    print("   toast/url:",pg.url.split('4174')[1], "| db:",q("select count(*) from exams where title='E2E created exam'"))
    ok(not errs,f"no uncaught JS errors {errs[:2]}")
    b.close()
