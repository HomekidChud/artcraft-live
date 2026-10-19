import {makeStarter} from "./engine.js";

export const LOCAL_SKILLS = [
  {id:"craft-guide",name:"Craft guide",description:"Look up curated start/export guidance from the local Craft catalog."},
  {id:"starter-file",name:"Starter file",description:"Create a deterministic, labelled starter asset locally; it does not edit an open project."},
  {id:"local-file-check",name:"Local file checks",description:"Inspect supported attached files in this browser; attachments are not sent to online chat."},
  {id:"web-search",name:"Web search",description:"Optionally search current public web information through the connected model provider and show citations."}
];

export function localToolDefinitions(catalog) {
  const craftIds = catalog.crafts.map(craft => craft.id);
  return [
    {
      type:"function",
      name:"get_craft_guidance",
      description:"Read the local ArtCraft catalog's curated start or export guidance for one Craft.",
      strict:true,
      parameters:{
        type:"object",
        properties:{
          craft_id:{type:"string",enum:craftIds},
          topic:{type:"string",enum:["start","export"]}
        },
        required:["craft_id","topic"],
        additionalProperties:false
      }
    },
    {
      type:"function",
      name:"make_starter",
      description:"Create one safe fixed starter template locally for a named Craft. This does not open, import into, or modify the editor.",
      strict:true,
      parameters:{
        type:"object",
        properties:{
          craft_id:{type:"string",enum:craftIds},
          brief:{type:"string"}
        },
        required:["craft_id","brief"],
        additionalProperties:false
      }
    }
  ];
}

export function executeLocalSkill(name,args,{catalog}) {
  if(!args||typeof args!=="object"||Array.isArray(args))return {output:"Invalid skill arguments; no local action was performed."};
  const craft = catalog.crafts.find(item => item.id === args.craft_id);
  if(name === "get_craft_guidance") {
    if(!craft) return {output:"Unknown Craft. Ask the user to choose one of the supported Crafts."};
    if(!["start","export"].includes(args.topic))return {output:"Unsupported guidance topic; choose start or export."};
    const topic = args.topic;
    const content = topic === "export" ? craft.export : craft.guide;
    return {
      output:JSON.stringify({craft:craft.name,topic,guidance:content}),
      action:{command:`get_craft_guidance(${craft.id}, ${topic})`,summary:`Read curated ${topic} guidance locally; the text is included in the next OpenAI request to continue the answer.`}
    };
  }
  if(name === "make_starter") {
    if(!craft) return {output:"Unknown Craft. Ask the user to choose one of the supported Crafts."};
    const brief = typeof args.brief === "string" ? args.brief.trim().slice(0,200) : "";
    if(!brief) return {output:"A short starter description is required."};
    const artifact = makeStarter(craft,brief);
    return {
      output:JSON.stringify({created:true,filename:artifact.filename,note:artifact.note,craft:craft.name}),
      artifact,
      action:{command:`makeStarter(${craft.id}, brief)`,summary:`Prepared ${artifact.filename} as a local fixed template; the editor project was not changed.`}
    };
  }
  return {output:"This skill is not available."};
}
