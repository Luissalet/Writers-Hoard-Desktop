/** Multilingual news-domain NER; suggestions require the author's confirmation. */
export const ENTITY_MODEL = { id: 'Xenova/bert-base-multilingual-cased-ner-hrl', revision: '263e82c06569c8c2ac46238a7ae5107598934234' };
export const ENTITY_MODEL_KEY = `mbert-ner-q8:${ENTITY_MODEL.revision}:wordpiece-source-v1`;
export const ENTITY_ASSETS = [
  { file: 'config.json', bytes: 1207, hash: '7aa891abae067f95a40f5e2005b3de44824a083f256802934a993d301ec25076' },
  { file: 'tokenizer.json', bytes: 2919362, hash: 'bf1b59b7b11c95f194f51708d918eea378e09d05f84c0e1656dc5180e8117088' },
  { file: 'tokenizer_config.json', bytes: 367, hash: 'e6f3b96db926a37d4039995fbf5ad17de158dfb8f6343d607e4dbaad18d75f5a' },
  { file: 'onnx/model_quantized.onnx', bytes: 178495423, hash: '5b65139844be260b624a2a13782b01d122e613d64ce16ed0ba4d82e0b816f1a9' },
];
