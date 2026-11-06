const http=require('http');
http.createServer((req,res)=>{
  const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*','access-control-expose-headers':'*'};
  if(req.method==='OPTIONS'){res.writeHead(204,cors);return res.end();}
  if(req.url.startsWith('/rest/v1/')){
    const p=http.request({host:'127.0.0.1',port:3000,path:req.url.replace('/rest/v1',''),method:req.method,headers:{...req.headers,host:'127.0.0.1:3000'}},r=>{res.writeHead(r.statusCode,{...r.headers,...cors});r.pipe(res);});
    p.on('error',e=>{res.writeHead(502,cors);res.end(String(e));});req.pipe(p);return;}
  res.writeHead(404,{...cors,'content-type':'application/json'});res.end('{"msg":"not available in test harness"}');
}).listen(54321,()=>console.log('proxy up'));
