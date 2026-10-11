// The bridge's model-facing error, kept free of imports so pure helpers and
// their node tests can use it without loading the database or the DOM.

/** A failure the model should read and act on, not a crash. */
export class BridgeError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'BridgeError';
    this.code = code;
  }
}
