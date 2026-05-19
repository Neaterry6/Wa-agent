import axios from 'axios';
const parseCount=(raw)=>{const n=Number.parseInt(raw,10); if(Number.isNaN(n)||n<1) return 1; return Math.min(n,5);};
const toOriginal=(url)=>url.replace(/\/(?:236x|474x|564x|736x|\d+x)\//,'/originals/');
export default {name:'pinterest',aliases:['pin'],category:'media',description:'Search HD Pinterest images',usage:'pinterest <keyword> [count]',cooldown:6,minArgs:1,
async execute({sock,message,from,args}){const count=parseCount(args[args.length-1]); const keyword=Number.isNaN(Number.parseInt(args[args.length-1],10))?args.join(' ').trim():args.slice(0,-1).join(' ').trim();
if(!keyword) return sock.sendMessage(from,{text:'❌ Usage: .pin <keyword> [count]\nExample: .pin cat 5'},{quoted:message});
await sock.sendMessage(from,{react:{text:'🔍',key:message.key}}); try{let images=[]; try{const {data}=await axios.get(`https://r.jina.ai/http://pinterest.com/search/pins/?q=${encodeURIComponent(keyword)}`,{timeout:15000,headers:{'User-Agent':'Mozilla/5.0','Accept':'application/json'}}); const text=typeof data==='string'?data:JSON.stringify(data); images.push(...[...text.matchAll(/https?:\/\/i\.pinimg\.com\/[^\s"')]+/g)].map(m=>toOriginal(m[0])));}catch{}
images=[...new Set(images.map(toOriginal))].slice(0,count); if(!images.length) return sock.sendMessage(from,{text:'❌ No images found. Try a different keyword.'},{quoted:message});
for(let i=0;i<images.length;i+=1){await sock.sendMessage(from,{image:{url:images[i]},caption:`📌 Pinterest: ${keyword}\nImage ${i+1}/${images.length}\n🖼️ HD`},{quoted:message});}
await sock.sendMessage(from,{react:{text:'✅',key:message.key}});}catch(error){await sock.sendMessage(from,{react:{text:'❌',key:message.key}}); return sock.sendMessage(from,{text:`❌ Pinterest fetch failed: ${error.message}`},{quoted:message});}}
};
