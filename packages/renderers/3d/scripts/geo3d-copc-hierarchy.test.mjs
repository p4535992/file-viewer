import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadCopcHierarchy, groupCopcHierarchyPages, adaptPointSource } from './build-geo3d-point-adapters.mjs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
const require=createRequire(import.meta.url)
const giroRequire=createRequire(require.resolve('@giro3d/giro3d/core/Instance.js'))
const {Copc}=giroRequire('copc')
const page=id=>({pageOffset:id*1024,pageLength:32})

test('nonadjacent reads retain the eight-request concurrency bound and all nodes',async()=>{
  let live=0,peak=0;const seen=[],nodes=new Map()
  await loadCopcHierarchy(async(_,p)=>{
    const id=p.pageOffset/1024;live++;peak=Math.max(peak,live);seen.push(id)
    await new Promise(resolve=>setTimeout(resolve,2));live--
    const children=id===0?Array.from({length:20},(_,i)=>i+1):id===1?[21,22]:[]
    return{nodes:{[id]:{pointCount:id+1}},pages:Object.fromEntries(children.map(id=>[id,page(id)]))}
  },null,page(0),nodes)
  assert.equal(peak,8);assert.equal(live,0);assert.equal(nodes.size,23);assert.equal(new Set(seen).size,23);assert.equal(nodes.get('22').pointCount,23)
})

test('real COPC hierarchy parser receives exact coalesced slices without reading gaps',async()=>{
  const bytes=new Uint8Array(12000),dv=new DataView(bytes.buffer)
  const put=(at,key,offset,length,count)=>{key.forEach((n,i)=>dv.setInt32(at+i*4,n,true));dv.setBigUint64(at+16,BigInt(offset),true);dv.setInt32(at+24,length,true);dv.setInt32(at+28,count,true)}
  put(4096,[0,0,0,0],500,30,1);put(4128,[1,0,0,0],10000,32,-1);put(4160,[1,1,0,0],10032,32,-1)
  put(10000,[1,0,0,0],600,30,2);put(10032,[1,1,0,0],700,30,3)
  const reads=[],nodes=new Map()
  await loadCopcHierarchy(Copc.loadHierarchyPage,async(a,b)=>{reads.push([a,b]);return bytes.slice(a,b)},{pageOffset:4096,pageLength:96},nodes)
  assert.deepEqual(reads,[[4096,4192],[10000,10064]])
  assert.equal(nodes.size,3);assert.equal(nodes.get('1-1-0-0').pointCount,3)
})

test('grouping preserves gaps and caps merged reads at 512 KiB',()=>{
  const groups=groupCopcHierarchyPages([{pageOffset:32,pageLength:262144},{pageOffset:262176,pageLength:262144},{pageOffset:524320,pageLength:32},{pageOffset:524384,pageLength:32}])
  assert.equal(groups.length,3);assert.equal(groups[0].end-groups[0].begin,512*1024)
  assert.equal(groups[1].begin,524320);assert.equal(groups[2].begin,524384)
})

test('invalid page ranges fail before any getter is called',async()=>{
  for(const p of [{pageOffset:-1,pageLength:32},{pageOffset:0,pageLength:31},{pageOffset:Number.MAX_SAFE_INTEGER,pageLength:32}]){
    await assert.rejects(loadCopcHierarchy(()=>assert.fail('loader reached'),()=>assert.fail('getter reached'),p,new Map()),/Invalid/)
  }
})

test('a truncated coalesced response cannot become a parser success',async()=>{
  await assert.rejects(loadCopcHierarchy(async(_,p)=>p.pageOffset===0?{nodes:{},pages:{a:{pageOffset:64,pageLength:32},b:{pageOffset:96,pageLength:32}}}:assert.fail('truncated group parsed'),async()=>new Uint8Array(63),page(0),new Map()),/Truncated/)
})

test('cancellation rejects with the original getter reason and schedules no descendants',async()=>{
  const reason=new Error('range aborted'),controller=new AbortController();let requests=0
  const getter=()=>new Promise((_,reject)=>{requests++;controller.signal.addEventListener('abort',()=>reject(controller.signal.reason),{once:true})})
  const pending=loadCopcHierarchy(async(read,p)=>p.pageOffset===0?{nodes:{},pages:{a:{pageOffset:64,pageLength:32},b:{pageOffset:96,pageLength:32}}}:read(p.pageOffset,p.pageOffset+p.pageLength),getter,page(0),new Map())
  await new Promise(resolve=>setTimeout(resolve,0));controller.abort(reason)
  await assert.rejects(pending,error=>error===reason);assert.equal(requests,1)
})

test('repeated or cyclic page references do not repeat network I/O',async()=>{
  let calls=0;const nodes=new Map()
  await loadCopcHierarchy(async()=>{calls++;return{nodes:{root:{pointCount:1}},pages:{cycle:page(0)}}},null,page(0),nodes)
  assert.equal(calls,1);assert.equal(nodes.get('root').pointCount,1)
})

test('decoder failures remain handled, including malformed page processing',async()=>{
  const reason=new Error('metadata parser failed')
  await assert.rejects(loadCopcHierarchy(async()=>{throw reason},null,page(0),new Map()),error=>error===reason)
  await assert.rejects(loadCopcHierarchy(async()=>({nodes:null,pages:{}}),null,page(0),new Map()),TypeError)
})

test('coalescing remains guarded by the reviewed engine source hash',async()=>{
  const source=await readFile(require.resolve('@giro3d/giro3d/sources/COPCSource.js'),'utf8')
  assert.match(adaptPointSource('COPCSource',source),/groupCopcHierarchyPages/)
  assert.throws(()=>adaptPointSource('COPCSource',source+'\n'),/Unreviewed/)
})
