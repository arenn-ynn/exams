import os
import sys,json,subprocess
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from mint import *
from playwright.sync_api import sync_playwright
env={**os.environ,"PGUSER":os.environ.get("PGUSER","postgres"),"PGHOST":os.environ.get("PGHOST","localhost")}
def q(s): return subprocess.run(["psql","-At","-d","e2e","-c",s],capture_output=True,text=True,env=env).stdout.strip()
asg=q("select a.id from assignments a join exams e on e.id=a.exam_id where e.title='Big exam'")
uid=USERS['student1'][0]
ok=lambda c,m: print(("PASS " if c else "FAIL ")+m)
q("delete from attempts where user_id='%s'"%uid)
with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={"width":390,"height":760},has_touch=True,is_mobile=True)
    ctx.add_init_script("if(!localStorage.getItem('sb-localhost-auth-token'))localStorage.setItem('sb-localhost-auth-token',%s)"%json.dumps(json.dumps(session(*USERS['student1']))))
    pg=ctx.new_page(); errs=[]; pg.on("pageerror",lambda e:errs.append(str(e)))
    pg.goto(f"http://127.0.0.1:4174/take/{asg}"); pg.get_by_role("button",name="Start examination").click()
    pg.get_by_text("Question 1 of 30").wait_for(timeout=8000)
    ok(pg.evaluate("document.documentElement.scrollWidth<=390"),"no horizontal scroll while taking exam")
    ok(pg.locator("nav.fixed").count()==0 or not pg.locator("nav.fixed").first.is_visible(),"no bottom nav on exam screen (full-screen exam mode)")
    # answer Q1, wait for debounce, confirm DB has it BEFORE anything else happens
    pg.get_by_text("yes",exact=True).first.click(); pg.wait_for_timeout(1800)
    ok(q(f"select count(*) from student_answers sa join attempts a on a.id=sa.attempt_id where a.user_id='{uid}'")=="1","answer 1 saved to DB by debounced autosave")
    # reload mid-exam: resume with answer restored
    pg.reload(); pg.get_by_role("button",name="Resume examination").click(); pg.get_by_text("Question 1 of 30").wait_for(timeout=8000)
    ok(pg.locator("input:checked").count()==1,"answer restored after reload (resume)")
    # answer the rest
    for i in range(2,31):
        pg.get_by_role("button",name="Next").click() if pg.get_by_role("button",name="Next").count() else None
        pg.get_by_text(f"Question {i} of 30").wait_for(timeout=5000)
        pg.get_by_text("yes",exact=True).first.click()
    pg.wait_for_timeout(1500)
    n=q(f"select count(*) from student_answers sa join attempts a on a.id=sa.attempt_id where a.user_id='{uid}'")
    ok(n=="30",f"all 30 answers persisted (got {n})")
    pg.get_by_role("button",name="Submit",exact=True).click(); pg.get_by_role("button",name="Submit now").click()
    pg.wait_for_timeout(2500)
    st=q(f"select status||' score='||coalesce(score::text,'?')||'/'||coalesce(max_score::text,'?') from attempts where user_id='{uid}'")
    ok(st.startswith("submitted"),f"attempt submitted & graded server-side: {st}")
    ok(not errs,f"no uncaught JS errors {errs[:2]}")
    b.close()
