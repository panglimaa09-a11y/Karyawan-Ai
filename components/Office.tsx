"use client";

import {Canvas,useFrame} from "@react-three/fiber";
import {OrbitControls,PerspectiveCamera,Text} from "@react-three/drei";
import {useMemo,useState} from "react";
import * as THREE from "three";

type Agent={id:string;name:string;role:string;emoji:string;status:"idle"|"working"|"review";progress:number;task:string;position:[number,number,number]};

const initialAgents:Agent[]=[
{id:"manager",name:"Raka",role:"Project Manager",emoji:"👨‍💼",status:"idle",progress:0,task:"Menunggu proyek",position:[-3.7,.45,-1.9]},
{id:"designer",name:"Sinta",role:"Designer",emoji:"🎨",status:"idle",progress:0,task:"Menunggu task",position:[-1.2,.45,-1.9]},
{id:"developer",name:"Andi",role:"Developer",emoji:"👨‍💻",status:"idle",progress:0,task:"Menunggu task",position:[1.2,.45,-1.9]},
{id:"writer",name:"Dina",role:"Writer",emoji:"✍️",status:"idle",progress:0,task:"Menunggu task",position:[-1.2,.45,1.1]},
{id:"qa",name:"Bima",role:"QA",emoji:"🔍",status:"idle",progress:0,task:"Menunggu task",position:[1.2,.45,1.1]}
];

function Employee({agent,selected,onClick}:{agent:Agent;selected:boolean;onClick:()=>void}){
 const ref=useMemo(()=>new THREE.Group(),[]);
 useFrame(({clock})=>{if(agent.status==="working")ref.position.y=agent.position[1]+Math.sin(clock.elapsedTime*3)*.025});
 return <group ref={ref} position={agent.position} onClick={e=>{e.stopPropagation();onClick()}}>
  <mesh><boxGeometry args={[1.35,.14,.75]}/><meshStandardMaterial color={selected?"#7ba7ff":"#273243"}/></mesh>
  <mesh position={[0,.75,-.08]}><boxGeometry args={[.62,.75,.12]}/><meshStandardMaterial color="#121a25"/></mesh>
  <mesh position={[0,.75,.18]}><boxGeometry args={[.52,.52,.06]}/><meshStandardMaterial color={agent.status==="working"?"#64d6a1":"#435066"} emissive={agent.status==="working"?"#143f2e":"#000000"}/></mesh>
  <Text position={[0,1.45,0]} fontSize={.18} color="white" anchorX="center">{agent.emoji} {agent.name}</Text>
  <Text position={[0,1.22,0]} fontSize={.105} color="#9aa7b8" anchorX="center">{agent.role}</Text>
 </group>
}

function OfficeScene({agents,selected,setSelected}:{agents:Agent[];selected:string;setSelected:(id:string)=>void}){
 return <>
  <PerspectiveCamera makeDefault position={[9,10,11]} fov={48}/>
  <OrbitControls enablePan={false} minDistance={7} maxDistance={20} target={[0,0,0]}/>
  <ambientLight intensity={2.2}/><directionalLight position={[4,9,4]} intensity={3}/>
  <mesh rotation={[-Math.PI/2,0,0]} position={[0,-.05,0]}><planeGeometry args={[11,8]}/><meshStandardMaterial color="#b99572"/></mesh>
  <mesh position={[0,2.2,-4]}><boxGeometry args={[11,4.5,.12]}/><meshStandardMaterial color="#e7e3dc"/></mesh>
  <mesh position={[-5.45,2.2,0]}><boxGeometry args={[.12,4.5,8]}/><meshStandardMaterial color="#e7e3dc"/></mesh>
  <mesh position={[5.45,2.2,0]}><boxGeometry args={[.12,4.5,8]}/><meshStandardMaterial color="#e7e3dc"/></mesh>
  <mesh position={[0,.8,3]}><boxGeometry args={[3.2,.16,1.1]}/><meshStandardMaterial color="#563f32"/></mesh>
  <Text position={[0,.95,3]} rotation={[-Math.PI/2,0,0]} fontSize={.24} color="#ded0c2" anchorX="center">MEETING</Text>
  {agents.map(a=><Employee key={a.id} agent={a} selected={selected===a.id} onClick={()=>setSelected(a.id)}/>)}
 </>
}

export default function Office(){
 const [agents,setAgents]=useState(initialAgents);
 const [selected,setSelected]=useState("manager");
 const [prompt,setPrompt]=useState("");
 const [running,setRunning]=useState(false);
 const [artifact,setArtifact]=useState("");

 const runProject=async()=>{
  if(!prompt.trim()||running)return;
  setRunning(true);setArtifact("");
  setAgents(a=>a.map(x=>({...x,status:x.id==="manager"?"working":"idle",progress:x.id==="manager"?15:0,task:x.id==="manager"?"Memecah proyek menjadi task...":"Menunggu Manager"})));
  const seq:Record<string,{task:string;progress:number}>={manager:{task:"Membagi pekerjaan ke tim",progress:100},designer:{task:"Menyusun struktur UI",progress:78},writer:{task:"Membuat copywriting",progress:88},developer:{task:"Membangun komponen website",progress:62},qa:{task:"Menyiapkan pengujian",progress:25}};
  for(const id of ["manager","designer","writer","developer","qa"]){
   await new Promise(r=>setTimeout(r,650));
   setAgents(cur=>cur.map(x=>({...x,status:x.id===id?(id==="qa"?"review":"working"):x.status,progress:x.id===id?seq[id].progress:x.progress,task:x.id===id?seq[id].task:x.task})));
  }
  await new Promise(r=>setTimeout(r,500));
  setArtifact(`PROJECT: ${prompt.trim()}

STATUS: READY FOR REVIEW

Generated artifacts:
- project-brief.md
- ui-spec.md
- content-draft.md
- implementation-plan.md
- qa-report.md

Next step: connect an LLM + GitHub adapter to turn these artifacts into real files and commits.`);
  setAgents(cur=>cur.map(x=>({...x,status:x.id==="qa"?"review":"idle"})));setRunning(false);
 };
 const selectedAgent=agents.find(a=>a.id===selected)!;
 return <main className="office-shell">
  <section className="scene"><div className="hud"><div className="brand">AI OFFICE / SIMULATOR</div><div className="live"><i/> LIVE SIMULATION</div></div><div className="canvas-wrap"><Canvas><color attach="background" args={["#0b1017"]}/><OfficeScene agents={agents} selected={selected} setSelected={setSelected}/></Canvas></div></section>
  <aside className="panel"><h1>AI Office</h1><div className="muted">Berikan proyek. Manager akan membagi pekerjaan ke karyawan AI.</div>
   <div className="project"><div style={{fontWeight:700,fontSize:13}}>New project</div><textarea value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder="Contoh: Buat landing page Nexora Design untuk UMKM Indonesia..."/><button className="primary" onClick={runProject} disabled={!prompt.trim()||running}>{running?"AI TEAM SEDANG BEKERJA...":"START PROJECT"}</button></div>
   <div className="agent-list">{agents.map(a=><div className="agent" key={a.id} onClick={()=>setSelected(a.id)}><div className="agent-top"><div className="agent-name">{a.emoji} {a.name} · {a.role}</div><div className="badge">{a.status}</div></div><div className="task">{a.task}</div><div className="progress"><span style={{width:`${a.progress}%`}}/></div></div>)}</div>
   <div className="artifact"><div style={{fontWeight:700,fontSize:13}}>Selected agent</div><div className="muted" style={{marginTop:6}}>{selectedAgent.name} · {selectedAgent.role} · {selectedAgent.task}</div></div>
   {artifact&&<div className="artifact"><div style={{fontWeight:700,fontSize:13}}>📦 Artifact preview</div><pre>{artifact}</pre></div>}
  </aside>
 </main>
}