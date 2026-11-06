import os,sys,json,subprocess
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from mint import *
from playwright.sync_api import sync_playwright
env={**os.environ,"PGUSER":os.environ.get("PGUSER","postgres"),"PGHOST":os.environ.get("PGHOST","localhost")}
def q(s): return subprocess.run(["psql","-At","-d","e2e","-c",s],capture_output=True,text=True,env=env).stdout.strip()
ok=lambda c,m: print(("PASS " if c else "FAIL ")+m)
uid=USERS['student1'][0]
asg=q("select a.id from assignments a join exams e on e.id=a.exam_id where e.title='Big exam'")
q("delete from attempts where user_id='%s'"%uid)
# Simulates Chrome/Google auto-translate: every text node gets wrapped in <font> elements (including nodes added later)
TRANSLATOR="""(()=>{const wrap=(n)=>{if(n.nodeType!==3||!n.nodeValue.trim()||n.parentNode.tagName==='FONT'||/SCRIPT|STYLE|TEXTAREA/.test(n.parentNode.tagName))return;
 const f=document.createElement('font');const g=document.createElement('font');g.textContent=n.nodeValue;f.appendChild(g);n.parentNode.replaceChild(f,n)};
 const walk=(r)=>{const w=document.createTreeWalker(r,NodeFilter.SHOW_TEXT);const a=[];while(w.nextNode())a.push(w.currentNode);a.forEach(wrap)};
 const mo=new MutationObserver(ms=>{mo.disconnect();ms.forEach(m=>{m.addedNodes.forEach(x=>{x.nodeType===3?wrap(x):x.nodeType===1&&walk(x)});if(m.type==='characterData')wrap(m.target)});mo.observe(document.body,{childList:true,subtree:true,characterData:true})});
 walk(document.body);mo.observe(document.body,{childList:true,subtree:true,characterData:true})})()"""
with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={"width":390,"height":760},has_touch=True,is_mobile=True)
    ctx.add_init_script("if(!localStorage.getItem('sb-localhost-auth-token'))localStorage.setItem('sb-localhost-auth-token',%s)"%json.dumps(json.dumps(session(*USERS['student1']))))
    pg=ctx.new_page(); pg.on("pageerror",lambda e:None)
    pg.goto(f"http://127.0.0.1:{sys.argv[1] if len(sys.argv)>1 else 4174}/take/{asg}"); pg.wait_for_timeout(1200)
    pg.evaluate(TRANSLATOR)                       # translation kicks in while the student reads the briefing
    try:
      pg.get_by_role("button",name="Start examination",).click(timeout=5000); pg.wait_for_timeout(1500)
      for i in range(1,30):
        pg.get_by_text("yes",exact=True).first.click(timeout=5000); pg.wait_for_timeout(60)
        pg.get_by_role("button",name="Next").click(timeout=5000); pg.wait_for_timeout(60)
      pg.get_by_text("yes",exact=True).first.click(timeout=5000); pg.wait_for_timeout(1500)
      pg.get_by_role("button",name="Submit",exact=True).click(timeout=5000); pg.wait_for_timeout(500)
      pg.get_by_role("button",name="Submit now").click(timeout=5000); pg.wait_for_timeout(3000)
    except Exception as e: print('   step failed at:',str(e).splitlines()[0][:120])
    body=pg.inner_text("body")
    crashed="Unexpected Application Error" in body or "Something went wrong" in body
    ok(not crashed,"exam completes under simulated browser auto-translation (no crash screen)")
    if crashed: print("   crash screen text:",body[:160].replace("\n"," | "))
    print("   attempt in DB:",q(f"select status from attempts where user_id='{uid}'"))
    b.close()
