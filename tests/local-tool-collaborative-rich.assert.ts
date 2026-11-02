/** Test-only strict comparisons for the primitive/plain values used by these four controls.
 * Object.is accepts identical references. Comparing distinct unsupported object kinds
 * or traversing cycles throws instead of weakening an assertion. */
interface RichTestAssert {
 (value:unknown,message?:string):asserts value;
 equal(actual:unknown,expected:unknown,message?:string):void;
 deepStrictEqual(actual:unknown,expected:unknown,message?:string):void;
 rejects(task:Promise<unknown>|(()=>Promise<unknown>),message?:string):Promise<void>;
}
function truth(value:unknown,message='Assertion failed'):asserts value {if(!value)throw Error(message);}
function same(a:unknown,b:unknown,left:Set<object>,right:Set<object>):boolean {
 if(Object.is(a,b))return true;
 if(!a||!b||typeof a!=='object'||typeof b!=='object')return false;
 const prototype=Object.getPrototypeOf(a);if(prototype!==Object.getPrototypeOf(b))return false;
 if(Array.isArray(a)!==Array.isArray(b))return false;
 if(!Array.isArray(a)&&prototype!==Object.prototype&&prototype!==null)throw Error('Unsupported non-plain assertion value');
 if(Array.isArray(a)&&a.length!==(b as unknown[]).length)return false;
 if(left.has(a)||right.has(b))throw Error('Unsupported cyclic assertion value');
 const keys=(value:object)=>Reflect.ownKeys(value).filter(key=>Object.prototype.propertyIsEnumerable.call(value,key)),ak=keys(a),bk=keys(b);
 if(ak.length!==bk.length)return false;left.add(a);right.add(b);
 try{return ak.every(key=>Object.prototype.propertyIsEnumerable.call(b,key)&&same(Reflect.get(a,key),Reflect.get(b,key),left,right));}finally{left.delete(a);right.delete(b);}
}
const assert:RichTestAssert=Object.assign(truth,{
 equal(actual:unknown,expected:unknown,message?:string){truth(Object.is(actual,expected),message);},
 deepStrictEqual(actual:unknown,expected:unknown,message?:string){truth(same(actual,expected,new Set(),new Set()),message);},
 async rejects(task:Promise<unknown>|(()=>Promise<unknown>),message?:string){let rejected=false;try{await(typeof task==='function'?task():task);}catch{rejected=true;}truth(rejected,message??'Expected promise rejection');},
});
export default assert;
