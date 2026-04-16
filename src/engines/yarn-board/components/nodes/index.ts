import SemanticNode from './SemanticNode';
import PostItNode from './PostItNode';
import ImageNode from './ImageNode';
import TextNode from './TextNode';
import GroupNode from './GroupNode';
import ShapeNode from './ShapeNode';

export const nodeTypes = {
  character: SemanticNode,
  event: SemanticNode,
  concept: SemanticNode,
  note: SemanticNode,
  postit: PostItNode,
  image: ImageNode,
  text: TextNode,
  group: GroupNode,
  shape: ShapeNode,
};

export {
  SemanticNode,
  PostItNode,
  ImageNode,
  TextNode,
  GroupNode,
  ShapeNode,
};
