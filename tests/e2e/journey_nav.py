import os
import sys,json,subprocess,time
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from mint import *
from playwright.sync_api import sync_playwright
ok=lambda c,m: print(("PASS " if c else "FAIL ")+m)
NAVJS="""()=>{const n=[...document.querySelectorAll('nav')].find(e=>getComputedStyle(e).position==='fixed'&&e.getBoundingClientRect().top>innerHeight/2);if(!n)return null;const r=n.getBoundingClientRect();return {pinned:Math.round(r.bottom)===innerHeight,w:Math.round(r.width),W:innerWidth,links:[...n.querySelectorAll('a,button')].length}}"""
with sync_playwright() as p:
    b=p.chromium.launch()
    def mk(role,w=375,h=700):
        ctx=b.new_context(viewport={"width":w,"height":h},has_touch=True,is_mobile=True)
        ctx.add_init_script("if(!localStorage.getItem('sb-localhost-auth-token')&&!sessionStorage.getItem('so'))localStorage.setItem('sb-localhost-auth-token',%s)"%json.dumps(json.dumps(session(*USERS[role]))))
        return ctx
    # ---- teacher: nav persists across navigation, with slow network
    ctx=mk('teacher'); pg=ctx.new_page(); errs=[]; pg.on("pageerror",lambda e:errs.append(str(e)))
    def slow(route): time.sleep(0.4); route.continue_()
    pg.route("**/rest/v1/**",slow)    # simulate slow API so pages sit in their loading state
    pg.goto("http://127.0.0.1:4174/"); pg.wait_for_timeout(300)
    n=pg.evaluate(NAVJS); ok(n and n["pinned"],"nav visible while first page is still LOADING")
    pg.wait_for_timeout(2500)
    allok=True
    for label in ["Exams","Classrooms","Dashboard"]:
        pg.locator("nav.fixed").get_by_role("link",name=label).first.click(); pg.wait_for_timeout(120)
        n=pg.evaluate(NAVJS)
        if not(n and n["pinned"] and n["w"]==n["W"]): allok=False; print("   nav problem after clicking",label,n)
        pg.wait_for_timeout(1500)
    ok(allok,"nav stays pinned & full-width while navigating between tabs (during loading too)")
    # scroll a long page: nav pinned continuously
    pg.unroute("**/rest/v1/**"); pg.goto("http://127.0.0.1:4174/examinations"); pg.wait_for_timeout(1500)
    states=[]
    for y in [0,200,600,1200,300,0]:
        pg.mouse.wheel(0,0); pg.evaluate(f"window.scrollTo(0,{y})"); pg.wait_for_timeout(120); states.append(pg.evaluate(NAVJS)["pinned"])
    ok(all(states),"nav pinned through down/up scroll sequence")
    # More menu & sign out
    pg.locator("nav.fixed").get_by_role("button",name="More").click(); pg.wait_for_timeout(300)
    ok(pg.get_by_role("button",name="Sign out").is_visible(),"More menu opens and shows Sign out")
    pg.get_by_role("button",name="Sign out").click(); pg.wait_for_timeout(1200)
    ok("/login" in pg.url,f"sign out redirects to login ({pg.url})")
    ok(pg.evaluate("localStorage.getItem('sb-localhost-auth-token')")is None,"session removed from storage on sign out")
    ctx.close()
    # ---- settings direct load: profile name present (was empty before fix)
    ctx=mk('teacher'); pg=ctx.new_page(); pg.goto("http://127.0.0.1:4174/settings"); pg.wait_for_timeout(2000)
    val=pg.locator("input:not([type=file])").first.input_value()   # (the first <input> on the page is the hidden avatar file picker)
    ok(val.startswith("Teresa"),f"Settings (direct load) pre-fills profile name: {val[:20]!r}")
    ctx.close()
    # ---- student: error toast visible ABOVE modal
    ctx=mk('student1'); pg=ctx.new_page(); pg.goto("http://127.0.0.1:4174/"); pg.wait_for_timeout(1500)
    pg.get_by_role("button",name="Join classroom").first.click(); pg.wait_for_timeout(300)
    pg.locator("dialog input").first.fill("ZZZZZZZZ"); pg.locator("dialog").get_by_role("button",name="Join").last.click(); pg.wait_for_timeout(1200)
    # Everything outside an open modal <dialog> is inert, so elementFromPoint() can't be used here; instead assert the toast
    # container is promoted to the top layer (Popover API) *after* the dialog, which is what paints it above the sheet.
    r=pg.evaluate("""()=>{const c=document.querySelector('[aria-live=polite]');const t=c&&c.firstElementChild;return {open:!!c&&c.matches(':popover-open'),dialog:!!document.querySelector('dialog[open]'),text:t?t.textContent:''}}""")
    ok(r['open'] and r['dialog'] and 'Invalid' in r['text'],f"error toast raised inside a modal is promoted above it (top layer): {r}")
    ctx.close(); b.close()
