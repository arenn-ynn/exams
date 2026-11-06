import os,sys,json
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from mint import *
from playwright.sync_api import sync_playwright
ok=lambda c,m: print(("PASS " if c else "FAIL ")+m)
with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={"width":390,"height":760})
    ctx.add_init_script("localStorage.setItem('sb-localhost-auth-token',%s)"%json.dumps(json.dumps(session(*USERS['teacher']))))
    pg=ctx.new_page(); pg.on("pageerror",lambda e:None); pg.on("console",lambda m:None)
    pg.goto(f"http://127.0.0.1:{sys.argv[1] if len(sys.argv)>1 else 4174}/"); pg.wait_for_timeout(1500)
    # force a render-time crash in the next route
    pg.evaluate("const c=document.createElement.bind(document); document.createElement=(t,o)=>{ if(String(t).toLowerCase()==='h2') throw new Error('forced test error'); return c(t,o) }")
    pg.locator("nav.fixed").get_by_role("link",name="Classrooms").click(); pg.wait_for_timeout(800)
    body=pg.inner_text("body")
    ok("Something went wrong" in body and "Unexpected Application Error" not in body,"render crash shows the app's own error page (not React Router's default)")
    ok(pg.get_by_role("button",name="Back to dashboard").is_visible() and pg.get_by_role("button",name="Reload page").is_visible(),"error page offers Reload + Back to dashboard")
    b.close()
