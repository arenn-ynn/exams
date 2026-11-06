import os,sys,json,subprocess
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from mint import *
from playwright.sync_api import sync_playwright
env={**os.environ,"PGUSER":os.environ.get("PGUSER","postgres"),"PGHOST":os.environ.get("PGHOST","localhost")}
def q(s): return subprocess.run(["psql","-At","-d","e2e","-c",s],capture_output=True,text=True,env=env).stdout.strip()
ok=lambda c,m: print(("PASS " if c else "FAIL ")+m)
asg=q("select a.id from assignments a join exams e on e.id=a.exam_id join classrooms c on c.id=a.classroom_id where e.title='Algebra basics' and c.name like 'Class 10A%'")
with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={"width":1280,"height":900},accept_downloads=True)
    ctx.add_init_script("localStorage.setItem('sb-localhost-auth-token',%s)"%json.dumps(json.dumps(session(*USERS['teacher']))))
    pg=ctx.new_page(); errs=[]; pg.on("pageerror",lambda e:errs.append(str(e)))
    pg.goto(f"http://127.0.0.1:{sys.argv[1] if len(sys.argv)>1 else 4174}/analytics/{asg}"); pg.wait_for_timeout(2000)
    for kind,magic in (("CSV",None),("PDF",b"%PDF")):
        btn=pg.get_by_role("button",name=kind)
        if btn.count()==0: print("   no",kind,"button; buttons:",pg.evaluate("[...document.querySelectorAll('main button')].map(b=>b.textContent.trim()).filter(Boolean)")); continue
        with pg.expect_download(timeout=20000) as d: btn.first.click()
        path=d.value.path(); data=open(path,'rb').read()
        ok(len(data)>200 and (magic is None or data.startswith(magic)),f"{kind} export downloaded ({d.value.suggested_filename}, {len(data)} bytes)")
    ok(not errs,f"no JS errors {errs[:2]}")
    b.close()
