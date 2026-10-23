// The compendium's data files are plain JSON loaded on demand; their shape is
// declared where they are read (srd.ts), so the type checker does not have to
// infer a type for a megabyte of literals.
declare module '*.json' {
  const value: unknown;
  export default value;
}
