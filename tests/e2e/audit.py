import sys, json, subprocess, os
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from mint import session, USERS
from playwright.sync_api import sync_playwright
BASE=sys.argv[1]; ONLY=(sys.argv[2] if len(sys.argv)>2 else '') or None
ROLES=(sys.argv[3] if len(sys.argv)>3 else 'teacher,student1').split(',')
WSEL=[int(x) for x in sys.argv[4].split(',')] if len(sys.argv)>4 else None
env={**os.environ,"PGUSER":os.environ.get("PGUSER","postgres"),"PGHOST":os.environ.get("PGHOST","localhost")}
def q(s): return subprocess.run(["psql","-At","-d","e2e","-c",s],capture_output=True,text=True,env=env).stdout.strip()
cls=q("select id from classrooms where name like 'Class 10A%'")
cls2=q("select id from classrooms where name like 'Superc%'")
ex=q("select id from exams where title='Algebra basics'")
exl=q("select id from exams where title like 'Thisis%'")
asg=q("select id from assignments where classroom_id='%s' and exam_id='%s'"%(cls,ex))
asgbig=q("select a.id from assignments a join exams e on e.id=a.exam_id where e.title='Big exam'")
T=[("/","Dashboard"),("/examinations","Exams"),("/examinations/new","NewExam"),("/examinations/new/ai","AI"),("/examinations/import","Import"),
   ("/examinations/blank","Blank editor"),(f"/examinations/{ex}","Editor"),(f"/examinations/{exl}","Editor long"),
   ("/classrooms","Classrooms"),(f"/classrooms/{cls}","Classroom"),(f"/classrooms/{cls2}","Classroom long"),(f"/classrooms/{cls}/join-display","JoinDisplay"),
   ("/analytics","Analytics"),(f"/analytics/{asg}","Results"),("/notifications","Notifs"),("/settings","Settings"),("/history","History")]
S=[("/","Dashboard S"),("/examinations","Exams S"),("/results","MyResults"),(f"/results/{asg}","ResultDetail"),("/history","History S"),("/notifications","Notifs S"),("/settings","Settings S"),("/classrooms","Classrooms S"),(f"/classrooms/{cls}","Classroom S"),(f"/take/{asgbig}","Take")]
WIDTHS=[320,360,375,390,430,768,1024,1280,1440,1920]
JS_OVER="""(W)=>{const bad=[];
 const clipped=(el)=>{for(let p=el.parentElement;p&&p!==document.body;p=p.parentElement){const o=getComputedStyle(p).overflowX;if(o!=='visible'){const r=p.getBoundingClientRect();if(r.right<=W+1&&r.left>=-1)return true;}}return false};
 for(const el of document.querySelectorAll('body *')){const cs=getComputedStyle(el);if(cs.display==='none'||cs.position==='fixed'&&false)continue;const r=el.getBoundingClientRect();if(r.width===0)continue;
  if((r.right>W+1||r.left<-1)&&!clipped(el)){bad.push((el.tagName+'.'+(el.className||'').toString().split(' ').slice(0,3).join('.')+' "'+(el.textContent||'').trim().slice(0,25)+'" R='+Math.round(r.right)));if(bad.length>=4)break}}
 return {sw:document.documentElement.scrollWidth,W,bad}}"""
JS_NAV="""()=>{const n=[...document.querySelectorAll('nav')].find(e=>getComputedStyle(e).position==='fixed'&&e.getBoundingClientRect().width>0&&e.getBoundingClientRect().top>innerHeight/2);
 if(!n)return null;const r=n.getBoundingClientRect();return {top:Math.round(r.top),bottom:Math.round(r.bottom),H:innerHeight,vis:getComputedStyle(n).visibility,op:getComputedStyle(n).opacity,left:Math.round(r.left),right:Math.round(r.right),W:innerWidth}}"""
JS_LAST="""()=>{const m=document.querySelector('main')||document.body;const all=[...m.querySelectorAll('*')].filter(e=>{const r=e.getBoundingClientRect();const leaf=e.children.length===0||['BUTTON','A','INPUT','SELECT','TEXTAREA','LABEL'].includes(e.tagName);return r.height>0&&leaf&&!e.closest('[class*=fixed],.sr-only')&&!(e.closest('details:not([open])')&&!e.closest('summary'))&&!['fixed','absolute'].includes(getComputedStyle(e).position)});
 let maxB=0;for(const e of all){const r=e.getBoundingClientRect();if(r.bottom>maxB)maxB=r.bottom}return Math.round(maxB)}"""
res=[];fails=0
with sync_playwright() as p:
    b=p.chromium.launch()
    for role,routes in [r for r in (("teacher",T),("student1",S)) if r[0] in ROLES]:
        sess=session(*USERS[role])
        for w in (WSEL or WIDTHS):
            mobile=w<768
            ctx=b.new_context(viewport={"width":w,"height":700 if mobile else 900},has_touch=mobile,is_mobile=mobile,device_scale_factor=1)
            ctx.add_init_script("localStorage.setItem('sb-localhost-auth-token',%s)"%json.dumps(json.dumps(sess)))
            pg=ctx.new_page(); errs=[]
            pg.on("console",lambda m:errs.append(m.text[:140]) if m.type=="error" else None)
            pg.on("pageerror",lambda e:errs.append("PAGEERR "+str(e)[:140]))
            for path,name in routes:
                if ONLY and ONLY not in name: continue
                errs.clear()
                pg.goto(BASE+path,wait_until="domcontentloaded"); pg.wait_for_timeout(900)
                o=pg.evaluate(JS_OVER,w); issues=[]
                if o["sw"]>o["W"]: issues.append(f"H-SCROLL sw={o['sw']}>W={o['W']}")
                if o["bad"]: issues.append("overflow: "+" | ".join(o["bad"]))
                if mobile and name not in("Take","JoinDisplay"):
                    n0=pg.evaluate(JS_NAV)
                    if not n0: issues.append("NO FIXED NAV")
                    else:
                        for label,y in (("down","document.documentElement.scrollHeight"),("up","0")):
                            pg.evaluate(f"window.scrollTo(0,{y})"); pg.wait_for_timeout(300)
                            n=pg.evaluate(JS_NAV)
                            if not n or n["bottom"]!=n["H"] or n["vis"]!="visible" or n["op"]!="1": issues.append(f"NAV not pinned after scroll {label}: {n}")
                        pg.evaluate("window.scrollTo(0,document.documentElement.scrollHeight)"); pg.wait_for_timeout(300)
                        n=pg.evaluate(JS_NAV); mb=pg.evaluate(JS_LAST)
                        if n and mb>n["top"]+1: issues.append(f"LAST ELEMENT hidden behind nav (content bottom {mb} > nav top {n['top']})")
                errs[:]=[e for e in errs if "WebSocket" not in e and "realtime" not in e]
                if errs: issues.append("console: "+"; ".join(set(errs))[:200])
                res.append((role,w,name,issues))
                if issues: fails+=1; print(f"[{role} {w}px] {name}: "+" || ".join(issues)); sys.stdout.flush()
            ctx.close()
    b.close()
print(f"\nTOTAL page×width checks: {len(res)}  with issues: {fails}")
