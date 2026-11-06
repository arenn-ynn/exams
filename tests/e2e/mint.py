import hmac,hashlib,base64,json,time,sys
SECRET=b"super-secret-jwt-token-with-at-least-32-characters-long"
def b(x): return base64.urlsafe_b64encode(x).rstrip(b'=').decode()
def jwt(sub,email,exp=4102444800):
    h=b(json.dumps({"alg":"HS256","typ":"JWT"}).encode())
    p=b(json.dumps({"sub":sub,"email":email,"role":"authenticated","aud":"authenticated","exp":exp,"iat":int(time.time())}).encode())
    s=b(hmac.new(SECRET,f"{h}.{p}".encode(),hashlib.sha256).digest())
    return f"{h}.{p}.{s}"
def session(sub,email):
    t=jwt(sub,email)
    return {"access_token":t,"refresh_token":"x","token_type":"bearer","expires_in":999999999,"expires_at":4102444800,
     "user":{"id":sub,"aud":"authenticated","role":"authenticated","email":email,"email_confirmed_at":"2026-01-01T00:00:00Z","app_metadata":{},"user_metadata":{},"created_at":"2026-01-01T00:00:00Z"}}
USERS={"teacher":("00000000-0000-0000-0000-0000000000a1","teacher@example.test"),
 "student1":("00000000-0000-0000-0000-0000000000b1","student1@example.test"),
 "student2":("00000000-0000-0000-0000-0000000000b2","student2@example.test"),
 "student3":("00000000-0000-0000-0000-0000000000b3","a.really.long.email.address.for.testing.layout@subdomain.example-university.test")}
