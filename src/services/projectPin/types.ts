export function validateProjectPin(value:unknown):asserts value is boolean|undefined{if(value!==undefined&&typeof value!=='boolean')throw Error('project_pin_invalid');}
