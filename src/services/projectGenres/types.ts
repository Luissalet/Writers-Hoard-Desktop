/** Portable labels. Suggested genres never restrict the writer's vocabulary. */
export const PROJECT_GENRE_PRESETS=[
 ['Fantasy','Fantasía'],['Grimdark','Grimdark'],['Dark Fantasy','Fantasía oscura'],
 ['Sci-Fi','Ciencia ficción'],['Modern','Contemporáneo'],['Horror','Terror'],
 ['Historical','Histórico'],['Mythology','Mitología'],['Alternate History','Historia alternativa'],
 ['Dystopian','Distopía'],['Post-Apocalyptic','Posapocalíptico'],['Survival','Supervivencia'],
 ['Western','Wéstern'],['Cyberpunk','Cyberpunk'],['Solarpunk','Solarpunk'],['Steampunk','Steampunk'],
 ['Cozy','Cozy'],['Dark Academia','Academia oscura'],['Gaslamp','Gaslamp'],
] as const;
export function normalizeProjectGenres(value:unknown):string[]{
 if(value===undefined)return[];
 if(!Array.isArray(value)||value.some(item=>typeof item!=='string'||!item.trim()))throw Error('project_genres_invalid');
 const result=new Map<string,string>();
 for(const item of value as string[]){const label=item.trim(),key=label.toLocaleLowerCase('en');if(!result.has(key))result.set(key,PROJECT_GENRE_PRESETS.find(([name])=>name.toLocaleLowerCase('en')===key)?.[0]??label);}
 return[...result.values()];
}
