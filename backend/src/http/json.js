export class HttpError extends Error{
  constructor(status,message,code='request_error'){super(message);this.status=status;this.code=code}
}

export const readJson=(request,limit)=>new Promise((resolve,reject)=>{
  let size=0,source='';
  request.setEncoding('utf8');
  request.on('data',chunk=>{size+=Buffer.byteLength(chunk);if(size>limit){reject(new HttpError(413,'Request body is too large.','payload_too_large'));request.destroy();return}source+=chunk});
  request.on('end',()=>{try{resolve(source?JSON.parse(source):{})}catch{reject(new HttpError(400,'Request body must be valid JSON.','invalid_json'))}});
  request.on('error',reject);
});

export const sendJson=(response,status,value,headers={})=>{
  const body=JSON.stringify(value);
  response.writeHead(status,{'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(body),'cache-control':'no-store',...headers});
  response.end(body);
};
